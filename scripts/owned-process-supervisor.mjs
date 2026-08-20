import { spawn } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

const [encoded] = process.argv.slice(2)
if (!encoded || !process.send) throw new Error('owned-process supervisor requires encoded configuration and IPC')
const { command, args, cwd, env, activationToken } = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
const emergencyHelperPath = new URL('./owned_process_emergency.py', import.meta.url).pathname
const RESULT_FRAME = 'SNL_OWNED_PROCESS_EMERGENCY_RESULT\t'

// Group SIGTERM is deliberately deferred: this process is the live ownership
// capability and group leader until an explicit release or self-group SIGKILL.
process.on('SIGTERM', () => {})
process.on('disconnect', abortStartup)

function send(message, callback) {
  try {
    if (process.connected) process.send(message, callback)
    else callback?.(new Error('owned supervisor IPC disconnected'))
  } catch (error) { callback?.(error) }
}

function parseStat(text, pid) {
  const end = text.lastIndexOf(')')
  if (end < 0) throw new Error(`malformed process identity for PID ${pid}`)
  const fields = text.slice(end + 2).trim().split(/\s+/)
  if (fields.length < 20) throw new Error(`malformed process identity fields for PID ${pid}`)
  return { state: fields[0], ppid: Number(fields[1]), pgrp: Number(fields[2]), starttime: fields[19] }
}
async function readIdentity(pid) {
  try { return parseStat(await readFile(`/proc/${pid}/stat`, 'utf8'), pid) }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error }
}
async function ownIdentity() {
  const identity = await readIdentity(process.pid)
  if (!identity || identity.pgrp !== process.pid) throw new Error('supervisor is not its own live process-group leader')
  return identity
}
async function groupHasOtherLiveMembers() {
  for (const entry of await readdir('/proc', { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue
    const pid = Number(entry.name)
    if (pid === process.pid) continue
    const identity = await readIdentity(pid)
    if (identity?.pgrp === process.pid && identity.state !== 'Z') return true
  }
  return false
}
async function waitForGroupConvergence(timeoutMs, pollIntervalMs = 10) {
  const deadline = Date.now() + timeoutMs
  while (true) {
    if (!(await groupHasOtherLiveMembers())) return true
    if (Date.now() >= deadline) return false
    await delay(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())))
  }
}

let child
let childPid
let commandChain = Promise.resolve()
let readyDelivered = false
let pendingLaunch
let launchStarted = false
let launchAccepted = false
let startupAborted = false

function abortStartup() {
  if (startupAborted) return
  startupAborted = true
  if (!launchStarted) {
    setImmediate(() => process.exit(1))
    return
  }
  try { child?.kill('SIGKILL') } catch {}
  // Stay a bounded live anchor long enough for the owner to perform exact
  // pidfd/subreaper emergency cleanup after losing IPC.
  setTimeout(() => process.exit(1), 5_000)
}

async function runDescendantShutdown(timeoutMs = 6_000) {
  const identity = await ownIdentity()
  const helper = spawn(process.env.PYTHON ?? 'python3', [
    emergencyHelperPath,
    String(process.pid),
    identity.starttime,
    String(identity.ppid),
    '--descendants-only',
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  helper.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
  helper.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
  const exited = new Promise((resolve, reject) => {
    helper.once('error', reject)
    helper.once('exit', (code, signal) => resolve({ code, signal }))
  })
  let timer
  try {
    const status = await Promise.race([
      exited,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`pidfd descendant helper timed out after ${timeoutMs}ms`)), timeoutMs) }),
    ])
    const frames = stdout.split(/\r?\n/).filter(line => line.startsWith(RESULT_FRAME))
    if (frames.length !== 1) throw new Error(`pidfd descendant helper returned ${frames.length} framed results (exit ${status.code}, signal ${status.signal}): ${stderr.trim()}`)
    let result
    try { result = JSON.parse(frames[0].slice(RESULT_FRAME.length)) }
    catch (error) { throw new Error('pidfd descendant helper returned malformed framed JSON', { cause: error }) }
    if (status.code !== 0 || result.ok !== true) throw new Error(`pidfd descendant helper failed: ${result.message ?? stderr.trim() ?? `exit ${status.code}`}`)
    return result
  } catch (error) {
    helper.kill('SIGKILL')
    await Promise.race([exited, delay(500)])
    throw error
  } finally { clearTimeout(timer) }
}

async function signalOwnGroupTerm(timeoutMs) {
  process.kill(0, 'SIGTERM')
  return waitForGroupConvergence(timeoutMs)
}

function reportFailure(type, requestId, error) {
  send({ type, requestId, ok: false, cleanupIncomplete: true, message: error.message })
}

function acceptLaunch(message) {
  if (!readyDelivered) { pendingLaunch = message; return }
  if (startupAborted || launchAccepted || message?.activationToken !== activationToken || !process.connected) {
    abortStartup()
    return
  }
  launchAccepted = true
  send({ type: 'launch-accepted', activationToken }, error => {
    if (error || !process.connected || startupAborted) { launchAccepted = false; abortStartup(); return }
    launchStarted = true
    const childEnv = { ...(env ?? process.env) }
    delete childEnv.SNL_OWNED_SUBREAPER_TOKEN
    child = spawn(command, args, { cwd, env: childEnv, detached: false, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout?.pipe(process.stdout)
    child.stderr?.pipe(process.stderr)
    child.once('spawn', async () => {
      childPid = child.pid
      const direct = await readIdentity(child.pid)
      if (!direct || direct.ppid !== process.pid) {
        send({ type: 'child-error', message: `owned direct-child ancestry mismatch for PID ${child.pid}` })
        return
      }
      send({ type: 'child-spawn', pid: child.pid, starttime: direct.starttime }, sendError => {
        if (sendError) abortStartup()
      })
    })
    child.on('error', error => send({ type: 'child-error', message: error.message, code: error.code }))
    child.once('exit', (code, signal) => send({ type: 'child-exit', pid: childPid, code, signal }))
  })
}

process.on('message', message => {
  if (message?.type === 'launch-child') { acceptLaunch(message); return }
  commandChain = commandChain.then(async () => {
    const requestId = message?.requestId
    if (message?.type === 'group-term') {
      const onlySupervisor = await signalOwnGroupTerm(message.timeoutMs ?? 2_000)
      send({ type: 'group-term-complete', requestId, ok: true, onlySupervisor })
      return
    }
    if (message?.type === 'descendant-shutdown') {
      const result = await runDescendantShutdown(message.timeoutMs)
      send({ type: 'descendant-shutdown-complete', requestId, ...result })
      return
    }
    if (message?.type === 'emergency-shutdown') {
      await signalOwnGroupTerm(message.timeoutMs ?? 500)
      const result = await runDescendantShutdown(message.timeoutMs)
      send({ type: 'emergency-shutdown-complete', requestId, ...result }, () => setImmediate(() => process.exit(0)))
      return
    }
    if (message?.type === 'release') {
      send({ type: 'release-accepted', requestId, ok: true }, () => setImmediate(() => process.exit(0)))
      return
    }
    if (message?.type === 'group-kill') {
      // Flush acceptance before the atomic self-group kill. The owner also
      // accepts observed supervisor exit, so ack-vs-SIGKILL ordering is bounded.
      send({ type: 'group-kill-accepted', requestId, ok: true }, error => {
        if (error) process.exit(1)
        else setImmediate(() => process.kill(0, 'SIGKILL'))
      })
    }
  }).catch(error => {
    const type = message?.type === 'group-term' ? 'group-term-complete'
      : message?.type === 'descendant-shutdown' ? 'descendant-shutdown-complete'
        : message?.type === 'emergency-shutdown' ? 'emergency-shutdown-complete'
          : `${message?.type ?? 'unknown'}-failed`
    reportFailure(type, message?.requestId, error)
    if (message?.type === 'emergency-shutdown') setImmediate(() => process.exit(1))
  })
  commandChain.catch(() => {})
})

async function start() {
  if (!activationToken || process.env.SNL_OWNED_SUBREAPER_TOKEN !== activationToken) {
    throw new Error('verified Linux subreaper activation token is missing')
  }
  const identity = await ownIdentity()
  if (process.env.SNL_TEST_READY_SEND_FAILURE === '1') process.disconnect()
  await new Promise((resolve, reject) => send({
    type: 'subreaper-ready',
    pid: process.pid,
    pgrp: identity.pgrp,
    ppid: identity.ppid,
    starttime: identity.starttime,
    activationToken,
  }, error => error ? reject(error) : resolve()))
  if (!process.connected || startupAborted) throw new Error('owned supervisor IPC disconnected before launch')
  readyDelivered = true
  if (pendingLaunch) { const launch = pendingLaunch; pendingLaunch = undefined; acceptLaunch(launch) }
}

start().catch(error => {
  send({ type: 'supervisor-startup-error', message: error.message })
  setImmediate(() => process.exit(1))
})
setInterval(() => {}, 60_000).unref()
