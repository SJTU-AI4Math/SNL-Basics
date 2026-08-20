import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { spawnOwnedProcess, terminateOwnedProcess } from './process-group-cleanup.mjs'

const ownedProcesses = new Set()
const looseProcesses = new Set()
const profiles = new Set()
const alive = pid => { try { process.kill(pid, 0); return true } catch (error) { if (error?.code === 'ESRCH') return false; throw error } }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
function deferred() {
  let resolve
  const promise = new Promise(res => { resolve = res })
  return { promise, resolve }
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
async function eventually(check, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) { if (check()) return; await wait(10) }
  throw new Error('condition did not converge')
}

afterEach(async () => {
  for (const owned of ownedProcesses) await terminateOwnedProcess(owned, { sigtermTimeoutMs: 50 }).catch(() => {})
  for (const child of looseProcesses) { try { child.kill('SIGKILL') } catch {} }
  for (const profile of profiles) rmSync(profile, { recursive: true, force: true })
  ownedProcesses.clear(); looseProcesses.clear(); profiles.clear()
})

describe('anchored owned process-group cleanup', () => {
  it('waits for verified anchor identity when child-spawn IPC arrives first', async () => {
    const anchorGate = deferred()
    const anchorVerified = deferred()
    const childSpawnReceived = deferred()
    const profile = mkdtempSync(join(tmpdir(), 'snl-owned-startup-profile-'))
    profiles.add(profile)
    let returned = false
    const spawning = spawnOwnedProcess(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      { cwd: profile },
      {
        readIdentity: async pid => {
          await anchorGate.promise
          return readProcessIdentity(pid)
        },
        onStartupEvent: event => {
          if (event === 'anchor-verified') anchorVerified.resolve()
          if (event === 'child-spawn-received') childSpawnReceived.resolve()
        },
      },
    ).then(value => { returned = true; return value })

    await childSpawnReceived.promise
    await new Promise(resolve => setImmediate(resolve))
    const returnedBeforeAnchor = returned
    anchorGate.resolve()
    await anchorVerified.promise

    const owned = await spawning
    ownedProcesses.add(owned)
    expect(returnedBeforeAnchor).toBe(false)
    expect(owned.groupId).toBe(owned.anchor.pid)
    expect(owned.anchor.starttime).toMatch(/^\d+$/)
    await terminateOwnedProcess(owned)
    ownedProcesses.delete(owned)
    rmSync(profile, { recursive: true, force: true })
    profiles.delete(profile)
    expect(alive(owned.anchor.pid)).toBe(false)
    expect(existsSync(profile)).toBe(false)
  })
  it('waits for child-spawn IPC acceptance when anchor verification finishes first', async () => {
    const childGate = deferred()
    const anchorVerified = deferred()
    const childSpawnReceived = deferred()
    const profile = mkdtempSync(join(tmpdir(), 'snl-owned-startup-profile-'))
    profiles.add(profile)
    let returned = false
    const spawning = spawnOwnedProcess(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      { cwd: profile },
      {
        beforeChildSpawn: () => childGate.promise,
        onStartupEvent: event => {
          if (event === 'anchor-verified') anchorVerified.resolve()
          if (event === 'child-spawn-received') childSpawnReceived.resolve()
        },
      },
    ).then(value => { returned = true; return value })

    await Promise.all([anchorVerified.promise, childSpawnReceived.promise])
    await new Promise(resolve => setImmediate(resolve))
    const returnedBeforeChildSpawn = returned
    childGate.resolve()

    const owned = await spawning
    ownedProcesses.add(owned)
    expect(returnedBeforeChildSpawn).toBe(false)
    expect(owned.groupId).toBe(owned.anchor.pid)
    expect(owned.pid).toBeGreaterThan(0)
    await terminateOwnedProcess(owned)
    ownedProcesses.delete(owned)
    rmSync(profile, { recursive: true, force: true })
    profiles.delete(profile)
    expect(alive(owned.anchor.pid)).toBe(false)
    expect(existsSync(profile)).toBe(false)
  })

  it('rejects an anchor read failure and removes the unreturned process group', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'snl-owned-startup-profile-'))
    profiles.add(profile)
    let groupId
    await expect(spawnOwnedProcess(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      { cwd: profile },
      { readIdentity: async pid => { groupId = pid; throw new Error('anchor probe failed') } },
    )).rejects.toThrow(/anchor probe failed/)

    await eventually(() => !alive(groupId))
    rmSync(profile, { recursive: true, force: true })
    profiles.delete(profile)
    expect(existsSync(profile)).toBe(false)
  })

  it('rejects and cleans up when the child exits before delayed IPC acceptance', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'snl-owned-startup-profile-'))
    profiles.add(profile)
    let groupId
    await expect(spawnOwnedProcess(
      process.execPath,
      ['-e', 'process.exit(9)'],
      { cwd: profile },
      {
        readIdentity: async pid => { groupId = pid; return readProcessIdentity(pid) },
        beforeChildSpawn: () => new Promise(() => {}),
      },
    )).rejects.toThrow(/child exited unexpectedly.*9/i)

    await eventually(() => !alive(groupId))
    rmSync(profile, { recursive: true, force: true })
    profiles.delete(profile)
    expect(existsSync(profile)).toBe(false)
  })

  it('retains a verified supervisor anchor after the Chromium child exits', async () => {
    const owned = await spawnOwnedProcess(process.execPath, ['-e', 'process.exit(7)'], { stdio: 'ignore' })
    ownedProcesses.add(owned)
    await expect(owned.failure).rejects.toThrow(/exited.*7/i)
    expect(alive(owned.anchor.pid)).toBe(true)
    expect(owned.anchor.starttime).toMatch(/^\d+$/)
    await terminateOwnedProcess(owned)
    ownedProcesses.delete(owned)
    expect(alive(owned.anchor.pid)).toBe(false)
  })

  it('kills a stubborn grandchild in the exact group while an unrelated sentinel survives', async () => {
    const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    looseProcesses.add(sentinel)
    await new Promise(resolve => sentinel.once('spawn', resolve))
    const source = `
      const { spawn } = require('node:child_process');
      const grandchild = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{}); setInterval(()=>{},1000)'], { stdio: 'ignore' });
      console.log(grandchild.pid);
      process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);
    `
    const owned = await spawnOwnedProcess(process.execPath, ['-e', source], { stdio: 'ignore' })
    ownedProcesses.add(owned)
    const grandchildPid = Number(await readFirstLine(owned.child.stdout))
    expect(alive(grandchildPid)).toBe(true)
    const result = await terminateOwnedProcess(owned, { sigtermTimeoutMs: 50, sigkillTimeoutMs: 2_000 })
    ownedProcesses.delete(owned)
    expect(result.escalated).toBe(true)
    await eventually(() => !alive(owned.anchor.pid))
    expect(alive(sentinel.pid)).toBe(true)
  })

  it('never signals a leaderless stale group after the verified anchor dies', async () => {
    const owned = await spawnOwnedProcess(process.execPath, ['-e', 'process.on("SIGTERM",()=>{}); setInterval(()=>{},1000)'], { stdio: 'ignore' })
    process.kill(owned.anchor.pid, 'SIGKILL')
    await owned.exited
    expect(alive(owned.pid)).toBe(true)
    await expect(terminateOwnedProcess(owned, { sigtermTimeoutMs: 20 })).rejects.toThrow(/identity/i)
    expect(alive(owned.pid)).toBe(true)
    process.kill(owned.pid, 'SIGKILL')
    await eventually(() => !alive(owned.pid))
  })

  it('refuses to signal when the anchor starttime no longer matches', async () => {
    const owned = await spawnOwnedProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    ownedProcesses.add(owned)
    const forged = { ...owned, anchor: { ...owned.anchor, starttime: `${BigInt(owned.anchor.starttime) + 1n}` } }
    await expect(terminateOwnedProcess(forged, { sigtermTimeoutMs: 20 })).rejects.toThrow(/identity/i)
    expect(alive(owned.anchor.pid)).toBe(true)
  })

  it('keeps verifier cleanup awaited, ordered, and free of parent-only kills', () => {
    const source = readFileSync(new URL('./verify-parameterized-svg.mjs', import.meta.url), 'utf8')
    const close = source.indexOf('await cdp?.close()')
    const browser = source.indexOf('await terminateOwnedProcess(browser)')
    const vite = source.indexOf('await closeOwnedVite(vite)')
    const profile = source.indexOf('rmSync(profile')
    expect(close).toBeGreaterThan(-1)
    expect(browser).toBeGreaterThan(close)
    expect(vite).toBeGreaterThan(browser)
    expect(profile).toBeGreaterThan(browser)
    expect(source).not.toMatch(/(?:browser|vite)(?:\.child)?\.kill\s*\(/)
  })
})
