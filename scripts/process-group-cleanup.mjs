import { spawn } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

const supervisorPath = new URL('./owned-process-supervisor.mjs', import.meta.url).pathname

function parseStat(text) {
  const end = text.lastIndexOf(')')
  if (end < 0) throw new Error('malformed /proc stat')
  const fields = text.slice(end + 2).trim().split(/\s+/)
  return { state: fields[0], pgrp: Number(fields[2]), starttime: fields[19] }
}
async function readIdentity(pid) {
  try { return parseStat(await readFile(`/proc/${pid}/stat`, 'utf8')) }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error }
}
async function assertAnchorIdentity(owned) {
  const actual = await readIdentity(owned.anchor.pid)
  if (!actual || actual.starttime !== owned.anchor.starttime || actual.pgrp !== owned.groupId) {
    throw new Error(`owned process-group anchor identity mismatch for PID ${owned.anchor.pid}`)
  }
  return actual
}
async function groupMembers(groupId) {
  const members = []
  for (const entry of await readdir('/proc', { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue
    const pid = Number(entry.name)
    const stat = await readIdentity(pid)
    if (stat?.pgrp === groupId) members.push({ pid, ...stat })
  }
  return members
}
function signalExactGroup(groupId, signal, signalProcess = process.kill.bind(process)) {
  try { signalProcess(-groupId, signal) }
  catch (error) { if (error?.code !== 'ESRCH') throw error }
}
function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

async function requestEmergencyShutdown(supervisor, supervisorExit, onCleanupEvent, timeoutMs = 6_000) {
  if (!supervisor.connected || typeof supervisor.send !== 'function') {
    throw new Error('owned supervisor IPC capability is unavailable')
  }
  const completion = deferred()
  const onMessage = message => {
    if (message?.type !== 'emergency-shutdown-complete') return
    completion.resolve(message)
  }
  supervisor.on('message', onMessage)
  onCleanupEvent('emergency-shutdown-requested')
  try {
    supervisor.send({ type: 'emergency-shutdown' }, error => { if (error) completion.reject(error) })
    const result = await Promise.race([
      completion.promise,
      delay(timeoutMs).then(() => { throw new Error(`owned supervisor ${supervisor.pid} timed out during emergency shutdown`) }),
    ])
    if (!result.ok) throw new Error(`owned supervisor emergency shutdown failed: ${result.message}`)
    const exited = await Promise.race([
      supervisorExit.then(() => true),
      delay(timeoutMs).then(() => false),
    ])
    if (!exited) throw new Error(`owned supervisor ${supervisor.pid} did not exit after emergency shutdown`)
    onCleanupEvent('emergency-shutdown-complete')
  } finally {
    supervisor.off('message', onMessage)
  }
}

function cleanupFailure(startupError, cleanupError) {
  const combined = new AggregateError(
    [startupError, cleanupError],
    `${startupError.message}; infrastructure cleanup failed: ${cleanupError.message}`,
  )
  combined.cleanupIncomplete = true
  return combined
}

export async function spawnOwnedProcess(command, args, options = {}, dependencies = {}) {
  if (process.platform !== 'linux') throw new Error('anchored process cleanup requires Linux /proc')
  const readAnchorIdentity = dependencies.readIdentity ?? readIdentity
  const beforeChildSpawn = dependencies.beforeChildSpawn ?? (() => {})
  const onStartupEvent = dependencies.onStartupEvent ?? (() => {})
  const onCleanupEvent = dependencies.onCleanupEvent ?? (() => {})
  const signalProcess = dependencies.signalProcess ?? process.kill.bind(process)
  const emergencyShutdown = dependencies.emergencyShutdown ?? requestEmergencyShutdown
  const config = Buffer.from(JSON.stringify({ command, args, cwd: options.cwd, env: options.env })).toString('base64url')
  const supervisor = spawn(process.execPath, [supervisorPath, config], {
    detached: true,
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  const startup = deferred()
  const failed = deferred()
  // A permanently attached observer prevents a late child failure from becoming
  // an unhandled rejection after a caller has moved into cleanup.
  failed.promise.catch(() => {})
  const owned = {
    child: supervisor,
    pid: undefined,
    groupId: undefined,
    anchor: undefined,
    failure: failed.promise,
    cleaning: false,
    signalProcess,
  }
  const startupState = { anchorReady: false, childReady: false, settled: false }
  const resolveStartupIfReady = () => {
    if (startupState.settled || !startupState.anchorReady || !startupState.childReady) return
    startupState.settled = true
    startup.resolve(owned)
  }
  const rejectStartup = error => {
    if (startupState.settled) return false
    startupState.settled = true
    startup.reject(error)
    return true
  }
  const supervisorExit = new Promise(resolve => supervisor.once('exit', (code, signal) => resolve({ code, signal })))
  owned.exited = supervisorExit
  let supervisorSpawned = false
  let anchorCheck
  supervisor.once('spawn', () => {
    supervisorSpawned = true
    anchorCheck = (async () => {
      try {
        const stat = await readAnchorIdentity(supervisor.pid)
        if (!stat || stat.pgrp !== supervisor.pid) throw new Error('supervisor did not become its own process-group leader')
        owned.groupId = supervisor.pid
        owned.anchor = { pid: supervisor.pid, starttime: stat.starttime }
        startupState.anchorReady = true
        onStartupEvent('anchor-verified')
        resolveStartupIfReady()
      } catch (error) { rejectStartup(error) }
    })()
    anchorCheck.catch(() => {})
  })
  supervisor.on('message', async message => {
    if (message?.type === 'child-spawn') {
      onStartupEvent('child-spawn-received')
      try { await beforeChildSpawn() }
      catch (error) {
        rejectStartup(error)
        if (!owned.cleaning) failed.reject(error)
        return
      }
      if (startupState.settled) return
      if (!Number.isSafeInteger(message.pid) || message.pid <= 0) {
        rejectStartup(new Error(`owned child reported invalid PID ${message.pid}`))
        return
      }
      if (owned.pid != null && owned.pid !== message.pid) {
        const error = new Error(`owned child reported conflicting PIDs ${owned.pid} and ${message.pid}`)
        if (!rejectStartup(error) && !owned.cleaning) failed.reject(error)
        return
      }
      owned.pid = message.pid
      startupState.childReady = true
      onStartupEvent('child-spawn-accepted')
      resolveStartupIfReady()
    } else if (message?.type === 'child-error') {
      const error = new Error(`owned child spawn/error: ${message.message}`)
      rejectStartup(error)
      if (!owned.cleaning) failed.reject(error)
    } else if (message?.type === 'child-exit') {
      const error = new Error(`owned child exited unexpectedly (code ${message.code}, signal ${message.signal})`)
      rejectStartup(error)
      if (!owned.cleaning) failed.reject(error)
    }
  })
  supervisor.once('error', error => { rejectStartup(error); if (!owned.cleaning) failed.reject(error) })
  supervisorExit.then(({ code, signal }) => {
    const error = new Error(`owned supervisor exited unexpectedly (code ${code}, signal ${signal})`)
    rejectStartup(error)
    if (!owned.cleaning) failed.reject(error)
  })
  try {
    return await startup.promise
  } catch (error) {
    owned.cleaning = true
    await anchorCheck?.catch(() => {})
    let cleanupError
    if (owned.anchor) {
      try { await terminateOwnedProcess(owned) }
      catch (anchorCleanupError) {
        try { await emergencyShutdown(supervisor, supervisorExit, onCleanupEvent) }
        catch (emergencyError) {
          cleanupError = new AggregateError(
            [anchorCleanupError, emergencyError],
            'verified-group cleanup and capability-scoped emergency shutdown both failed',
          )
        }
      }
    } else if (supervisorSpawned) {
      try { await emergencyShutdown(supervisor, supervisorExit, onCleanupEvent) }
      catch (emergencyError) { cleanupError = emergencyError }
    } else {
      try {
        supervisor.kill('SIGKILL')
        const exited = await Promise.race([
          supervisorExit.then(() => true),
          delay(2_000).then(() => false),
        ])
        if (!exited) throw new Error('unspawned owned supervisor did not exit after direct ChildProcess kill')
      } catch (directError) { cleanupError = directError }
    }
    if (cleanupError) throw cleanupFailure(error, cleanupError)
    throw error
  }
}

async function waitUntil(check, timeoutMs, pollIntervalMs) {
  const deadline = Date.now() + timeoutMs
  while (true) {
    if (await check()) return true
    if (Date.now() >= deadline) return false
    await delay(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())))
  }
}

export function raceOwnedProcess(owned, promise) {
  return Promise.race([Promise.resolve(promise), owned.failure])
}

export async function terminateOwnedProcess(owned, {
  sigtermTimeoutMs = 2_000,
  sigkillTimeoutMs = 2_000,
  pollIntervalMs = 25,
} = {}) {
  if (!owned) return { escalated: false }
  if (!owned.anchor || !Number.isSafeInteger(owned.groupId) || owned.groupId <= 0) {
    throw new Error('refusing to terminate an unanchored process group')
  }
  owned.cleaning = true
  await assertAnchorIdentity(owned)
  signalExactGroup(owned.groupId, 'SIGTERM', owned.signalProcess)
  const onlyAnchor = await waitUntil(async () => {
    const members = await groupMembers(owned.groupId)
    return members.every(member => member.pid === owned.anchor.pid)
  }, sigtermTimeoutMs, pollIntervalMs)
  if (onlyAnchor) {
    await assertAnchorIdentity(owned)
    owned.child.send?.({ type: 'release' })
    const exited = await Promise.race([
      owned.exited.then(() => true),
      delay(sigkillTimeoutMs).then(() => false),
    ])
    if (!exited) throw new Error(`owned supervisor ${owned.anchor.pid} did not exit after release`)
    const gone = await waitUntil(async () => (await groupMembers(owned.groupId)).length === 0, sigkillTimeoutMs, pollIntervalMs)
    if (!gone) throw new Error(`process group ${owned.groupId} remained after supervisor release`)
    return { escalated: false }
  }
  // Identity is checked immediately before the destructive exact-group signal;
  // a dead/reused anchor therefore fails closed instead of touching a stale PGID.
  await assertAnchorIdentity(owned)
  signalExactGroup(owned.groupId, 'SIGKILL', owned.signalProcess)
  const gone = await waitUntil(async () => (await groupMembers(owned.groupId)).length === 0, sigkillTimeoutMs, pollIntervalMs)
  if (!gone) throw new Error(`process group ${owned.groupId} survived SIGKILL cleanup`)
  await owned.exited
  return { escalated: true }
}
