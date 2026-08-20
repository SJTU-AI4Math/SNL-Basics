import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { spawnOwnedProcess, terminateOwnedProcess } from './process-group-cleanup.mjs'

const ownedProcesses = new Set()
const looseProcesses = new Set()
const loosePids = new Set()
const profiles = new Set()
const alive = pid => { try { process.kill(pid, 0); return true } catch (error) { if (error?.code === 'ESRCH') return false; throw error } }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const testSupervisorPath = new URL('./fixtures/startup-test-supervisor.mjs', import.meta.url).pathname
async function eventually(check, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) { if (await check()) return; await wait(10) }
  throw new Error('condition did not converge')
}
async function readProcessIdentity(pid) {
  const text = await readFile(`/proc/${pid}/stat`, 'utf8')
  const fields = text.slice(text.lastIndexOf(')') + 2).trim().split(/\s+/)
  return { state: fields[0], pgrp: Number(fields[2]), starttime: fields[19] }
}
async function readFirstLine(stream) {
  let text = ''
  for await (const chunk of stream) {
    text += chunk
    const newline = text.indexOf('\n')
    if (newline >= 0) return text.slice(0, newline)
  }
  throw new Error('child exited before reporting readiness')
}

afterEach(async () => {
  for (const owned of ownedProcesses) await terminateOwnedProcess(owned, { sigtermTimeoutMs: 50 }).catch(() => {})
  for (const child of looseProcesses) { try { child.kill('SIGKILL') } catch {} }
  for (const pid of loosePids) { try { process.kill(pid, 'SIGKILL') } catch {} }
  for (const profile of profiles) rmSync(profile, { recursive: true, force: true })
  ownedProcesses.clear(); looseProcesses.clear(); loosePids.clear(); profiles.clear()
})

function daemonizingTermSource(pidFile, readyFile) {
  return `
import os, signal, time
pid_file=${JSON.stringify(pidFile)}
ready_file=${JSON.stringify(readyFile)}
def term(_sig, _frame):
    first=os.fork()
    if first == 0:
        os.setsid()
        second=os.fork()
        if second > 0: os._exit(0)
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        open(pid_file, 'w').write(str(os.getpid()))
        while True: time.sleep(1)
    os._exit(0)
signal.signal(signal.SIGTERM, term)
open(ready_file, 'w').write('ready')
while True: time.sleep(1)
`
}

describe('Linux subreaper owned-process cleanup', () => {
  it('reports a verified subreaper handshake before launching the child', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'snl-subreaper-startup-'))
    profiles.add(profile)
    const marker = join(profile, 'child')
    const events = []
    const owned = await spawnOwnedProcess(process.execPath, ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'yes'); setInterval(()=>{},1000)`], { cwd: profile }, {
      onStartupEvent: event => events.push(event),
    })
    ownedProcesses.add(owned)
    expect(events.indexOf('subreaper-verified')).toBeGreaterThanOrEqual(0)
    expect(events.indexOf('child-spawn-accepted')).toBeGreaterThan(events.indexOf('subreaper-verified'))
    expect(owned.anchor.pid).toBe(owned.child.pid)
    expect(owned.anchor.starttime).toMatch(/^\d+$/)
    await eventually(() => existsSync(marker))
  })

  it('rejects a supervisor disconnect before ready without launching a child', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'snl-subreaper-disconnect-before-ready-'))
    profiles.add(profile)
    const marker = join(profile, 'child')
    await expect(spawnOwnedProcess(process.execPath, ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'launched')`], {
      cwd: profile,
      env: { ...process.env, SNL_TEST_STARTUP_MODE: 'disconnect-before-ready' },
    }, { supervisorPath: testSupervisorPath, startupTimeoutMs: 500 })).rejects.toThrow(/disconnect/i)
    expect(existsSync(marker)).toBe(false)
  })

  it('exits without launching a child when the ready send callback fails', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'snl-subreaper-ready-send-failure-'))
    profiles.add(profile)
    const marker = join(profile, 'child')
    await expect(spawnOwnedProcess(process.execPath, ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'launched')`], {
      cwd: profile,
      env: { ...process.env, SNL_TEST_READY_SEND_FAILURE: '1' },
    }, { startupTimeoutMs: 500 })).rejects.toThrow(/disconnect|exited|IPC/i)
    expect(existsSync(marker)).toBe(false)
  })

  it('cleans a child tree when IPC disconnects after launch before child-spawn confirmation', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'snl-subreaper-disconnect-after-launch-'))
    profiles.add(profile)
    const pidFile = join(profile, 'child-pid')
    await expect(spawnOwnedProcess(process.execPath, ['-e', `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(()=>{},1000)`], {
      cwd: profile,
      env: { ...process.env, SNL_TEST_STARTUP_MODE: 'disconnect-after-launch' },
    }, { supervisorPath: testSupervisorPath, startupTimeoutMs: 1_000 })).rejects.toThrow(/disconnect/i)
    await eventually(() => existsSync(pidFile))
    const childPid = Number(readFileSync(pidFile, 'utf8'))
    await eventually(() => !alive(childPid))
  })

  it('times out a silent startup wrapper within the configured bound', async () => {
    const started = Date.now()
    await expect(spawnOwnedProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      env: { ...process.env, SNL_TEST_STARTUP_MODE: 'silent' },
    }, { supervisorPath: testSupervisorPath, startupTimeoutMs: 120 })).rejects.toThrow(/startup timed out.*120ms/i)
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('fails closed on prctl failure and never launches the configured child', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'snl-subreaper-fail-'))
    profiles.add(profile)
    const marker = join(profile, 'child')
    await expect(spawnOwnedProcess(process.execPath, ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'launched')`], {
      cwd: profile,
      env: { ...process.env, SNL_TEST_SUBREAPER_PRCTL_FAILURE: '1' },
    })).rejects.toThrow(/subreaper|prctl/i)
    expect(existsSync(marker)).toBe(false)
  })

  it('keeps the supervisor anchor alive after the Chromium child exits until cleanup', async () => {
    const owned = await spawnOwnedProcess(process.execPath, ['-e', 'setTimeout(()=>process.exit(7),20)'])
    ownedProcesses.add(owned)
    await expect(owned.failure).rejects.toThrow(/exited.*7/i)
    expect(alive(owned.anchor.pid)).toBe(true)
    await terminateOwnedProcess(owned)
    ownedProcesses.delete(owned)
    expect(alive(owned.anchor.pid)).toBe(false)
  })

  it('contains a TERM-triggered setsid double-fork daemon during normal self-group cleanup', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'snl-subreaper-normal-'))
    profiles.add(profile)
    const ready = join(profile, 'ready')
    const pidFile = join(profile, 'daemon-pid')
    const owned = await spawnOwnedProcess('python3', ['-c', daemonizingTermSource(pidFile, ready)], { cwd: profile })
    ownedProcesses.add(owned)
    await eventually(() => existsSync(ready))
    const result = await terminateOwnedProcess(owned, { sigtermTimeoutMs: 500, sigkillTimeoutMs: 2_000 })
    ownedProcesses.delete(owned)
    expect(result.escalated).toBe(false)
    expect(existsSync(pidFile)).toBe(true)
    const daemonPid = Number(readFileSync(pidFile, 'utf8'))
    loosePids.add(daemonPid)
    await eventually(() => !alive(daemonPid))
    loosePids.delete(daemonPid)
  })

  it('contains a setsid double-fork daemon after IPC loss via pidfd/subreaper emergency', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'snl-subreaper-emergency-'))
    profiles.add(profile)
    const ready = join(profile, 'ready')
    const pidFile = join(profile, 'daemon-pid')
    const owned = await spawnOwnedProcess('python3', ['-c', daemonizingTermSource(pidFile, ready)], { cwd: profile })
    ownedProcesses.add(owned)
    await eventually(() => existsSync(ready))

    const requestId = 'adversarial-term-before-ipc-loss'
    const termComplete = new Promise(resolve => {
      const listener = message => {
        if (message?.type === 'group-term-complete' && message.requestId === requestId) {
          owned.child.off('message', listener)
          resolve(message)
        }
      }
      owned.child.on('message', listener)
    })
    owned.child.send({ type: 'group-term', requestId, timeoutMs: 500 })
    await termComplete
    await eventually(() => existsSync(pidFile))
    owned.child.disconnect()

    const result = await terminateOwnedProcess(owned, { sigkillTimeoutMs: 2_000 })
    ownedProcesses.delete(owned)
    expect(result.emergency).toBe(true)
    const daemonPid = Number(readFileSync(pidFile, 'utf8'))
    loosePids.add(daemonPid)
    await eventually(() => !alive(daemonPid))
    loosePids.delete(daemonPid)
  })

  it('escalates stubborn descendants via bounded IPC group-kill without unhandled rejection', async () => {
    const unhandled = []
    const listener = reason => unhandled.push(reason)
    process.on('unhandledRejection', listener)
    try {
      const source = 'process.on("SIGTERM",()=>{}); console.log(process.pid); setInterval(()=>{},1000)'
      const owned = await spawnOwnedProcess(process.execPath, ['-e', source])
      ownedProcesses.add(owned)
      await readFirstLine(owned.child.stdout)
      const result = await terminateOwnedProcess(owned, { sigtermTimeoutMs: 30, sigkillTimeoutMs: 2_000 })
      ownedProcesses.delete(owned)
      expect(result.escalated).toBe(true)
      await wait(20)
      expect(unhandled).toEqual([])
    } finally { process.off('unhandledRejection', listener) }
  })

  it('leaves an unrelated sentinel alive', async () => {
    const sentinel = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' })
    looseProcesses.add(sentinel)
    await new Promise(resolve => sentinel.once('spawn', resolve))
    const owned = await spawnOwnedProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'])
    ownedProcesses.add(owned)
    await terminateOwnedProcess(owned)
    ownedProcesses.delete(owned)
    expect(alive(sentinel.pid)).toBe(true)
  })

  it('contains the parent implementation to capability IPC with no negative numeric signals', () => {
    const parent = readFileSync(new URL('./process-group-cleanup.mjs', import.meta.url), 'utf8')
    const supervisor = readFileSync(new URL('./owned-process-supervisor.mjs', import.meta.url), 'utf8')
    expect(parent).not.toMatch(/process\.kill\s*\(\s*-/)
    expect(parent).not.toMatch(/signalProcess\s*\(\s*-/)
    expect(parent).not.toMatch(/\.kill\s*\(\s*-\s*(?:owned|supervisor|group)/)
    expect(supervisor).toContain("process.kill(0, 'SIGTERM')")
    expect(supervisor).toContain("process.kill(0, 'SIGKILL')")
    expect(parent).toContain("supervisor.once('disconnect', resolve)")
    expect(parent).toContain('startupTimeoutMs')
    expect(parent).toMatch(/startupTimer = setTimeout\([^\n]+startupTimeoutMs/)
    expect(parent).toContain('clearTimeout(startupTimer)')
    expect(parent).toContain("type: 'launch-child'")
    expect(supervisor).toContain("message?.type === 'launch-child'")
    expect(supervisor).toMatch(/message\?\.type === 'launch-child'[^\n]+acceptLaunch/)
    expect(supervisor.indexOf('if (startupAborted || launchAccepted')).toBeLessThan(supervisor.lastIndexOf('child = spawn(command'))
  })

  it('keeps verifier cleanup awaited and ordered', () => {
    const source = readFileSync(new URL('./verify-parameterized-svg.mjs', import.meta.url), 'utf8')
    const close = source.indexOf('await cdp?.close()')
    const browser = source.indexOf('await terminateOwnedProcess(browser)')
    const vite = source.indexOf('await closeOwnedVite(vite)')
    const profile = source.indexOf('rmSync(profile')
    expect(close).toBeGreaterThan(-1)
    expect(browser).toBeGreaterThan(close)
    expect(vite).toBeGreaterThan(browser)
    expect(profile).toBeGreaterThan(browser)
    expect(source).toContain('verificationError?.cleanupIncomplete !== true')
    expect(source).not.toMatch(/(?:browser|vite)(?:\.child)?\.kill\s*\(/)
  })

  it('retains exact pidfd signaling in the emergency helper', () => {
    const emergency = readFileSync(new URL('./owned_process_emergency.py', import.meta.url), 'utf8')
    expect(emergency).not.toMatch(/\bos\.kill\s*\(/)
    expect(emergency).toContain('signal.pidfd_send_signal')
    expect(emergency).toContain('signal.SIGSTOP')
    expect(emergency).toMatch(/max_freeze_iterations[\s\S]*for iteration in range/)
  })
})
