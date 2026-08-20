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
function signalExactGroup(groupId, signal) {
  try { process.kill(-groupId, signal) }
  catch (error) { if (error?.code !== 'ESRCH') throw error }
}
function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

export async function spawnOwnedProcess(command, args, options = {}) {
  if (process.platform !== 'linux') throw new Error('anchored process cleanup requires Linux /proc')
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
  }
  const supervisorExit = new Promise(resolve => supervisor.once('exit', (code, signal) => resolve({ code, signal })))
  owned.exited = supervisorExit
  supervisor.once('spawn', async () => {
    try {
      const stat = await readIdentity(supervisor.pid)
      if (!stat || stat.pgrp !== supervisor.pid) throw new Error('supervisor did not become its own process-group leader')
      owned.groupId = supervisor.pid
      owned.anchor = { pid: supervisor.pid, starttime: stat.starttime }
    } catch (error) { startup.reject(error) }
  })
  supervisor.on('message', message => {
    if (message?.type === 'child-spawn') {
      owned.pid = message.pid
      startup.resolve(owned)
    } else if (message?.type === 'child-error') {
      const error = new Error(`owned child spawn/error: ${message.message}`)
      if (owned.pid == null) startup.reject(error)
      if (!owned.cleaning) failed.reject(error)
    } else if (message?.type === 'child-exit' && !owned.cleaning) {
      failed.reject(new Error(`owned child exited unexpectedly (code ${message.code}, signal ${message.signal})`))
    }
  })
  supervisor.once('error', error => { startup.reject(error); if (!owned.cleaning) failed.reject(error) })
  supervisorExit.then(({ code, signal }) => {
    const error = new Error(`owned supervisor exited unexpectedly (code ${code}, signal ${signal})`)
    startup.reject(error)
    if (!owned.cleaning) failed.reject(error)
  })
  try {
    return await startup.promise
  } catch (error) {
    owned.cleaning = true
    if (owned.anchor) await terminateOwnedProcess(owned).catch(() => {})
    else { try { supervisor.kill('SIGKILL') } catch {} }
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
  signalExactGroup(owned.groupId, 'SIGTERM')
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
  signalExactGroup(owned.groupId, 'SIGKILL')
  const gone = await waitUntil(async () => (await groupMembers(owned.groupId)).length === 0, sigkillTimeoutMs, pollIntervalMs)
  if (!gone) throw new Error(`process group ${owned.groupId} survived SIGKILL cleanup`)
  await owned.exited
  return { escalated: true }
}
