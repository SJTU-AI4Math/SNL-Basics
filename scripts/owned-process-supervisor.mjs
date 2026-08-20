import { spawn } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

const [encoded] = process.argv.slice(2)
if (!encoded || !process.send) throw new Error('owned-process supervisor requires encoded configuration and IPC')
const { command, args, cwd, env } = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))

// The supervisor is the durable process-group anchor. Group SIGTERM reaches it,
// but it deliberately stays alive until the owner verifies group convergence.
process.on('SIGTERM', () => {})
process.on('disconnect', () => {})

function parseStat(text) {
  const end = text.lastIndexOf(')')
  if (end < 0) throw new Error('malformed /proc stat')
  const fields = text.slice(end + 2).trim().split(/\s+/)
  return { ppid: Number(fields[1]), starttime: fields[19] }
}
async function readIdentity(pid) {
  try { return parseStat(await readFile(`/proc/${pid}/stat`, 'utf8')) }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error }
}
async function snapshotDescendants(rootPid) {
  const processes = []
  for (const entry of await readdir('/proc', { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue
    const pid = Number(entry.name)
    const identity = await readIdentity(pid)
    if (identity) processes.push({ pid, ...identity })
  }
  const descendants = []
  const pending = [{ pid: rootPid, depth: 0 }]
  while (pending.length > 0) {
    const parent = pending.shift()
    for (const process of processes) {
      if (process.ppid !== parent.pid || descendants.some(item => item.pid === process.pid)) continue
      const descendant = { pid: process.pid, starttime: process.starttime, depth: parent.depth + 1 }
      descendants.push(descendant)
      pending.push(descendant)
    }
  }
  return descendants
}
async function identityStillMatches(identity) {
  const actual = await readIdentity(identity.pid)
  return actual?.starttime === identity.starttime
}
async function signalCaptured(identity, signal) {
  if (!await identityStillMatches(identity)) return
  try { process.kill(identity.pid, signal) }
  catch (error) { if (error?.code !== 'ESRCH') throw error }
}
async function waitCapturedGone(identities, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (true) {
    const alive = await Promise.all(identities.map(identityStillMatches))
    if (alive.every(value => !value)) return true
    if (Date.now() >= deadline) return false
    await delay(Math.min(25, Math.max(1, deadline - Date.now())))
  }
}
function send(message) {
  try { process.send?.(message) } catch {}
}

let child
let childExit = Promise.resolve()
try {
  child = spawn(command, args, {
    cwd,
    env,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  childExit = new Promise(resolve => child.once('exit', resolve))
  child.stdout?.pipe(process.stdout)
  child.stderr?.pipe(process.stderr)
  child.once('spawn', () => send({ type: 'child-spawn', pid: child.pid }))
  child.on('error', error => send({ type: 'child-error', message: error.message, code: error.code }))
  child.once('exit', (code, signal) => send({ type: 'child-exit', code, signal }))
} catch (error) {
  send({ type: 'child-error', message: error.message, code: error.code })
}

let emergencyShutdown
async function runEmergencyShutdown() {
  const captured = child?.pid ? await snapshotDescendants(child.pid) : []
  const directIdentity = child?.pid ? { pid: child.pid, starttime: (await readIdentity(child.pid))?.starttime } : undefined
  const descendants = captured.filter(identity => identity.pid !== child?.pid).sort((left, right) => right.depth - left.depth)

  if (directIdentity?.starttime && await identityStillMatches(directIdentity)) child.kill('SIGTERM')
  for (const identity of descendants) await signalCaptured(identity, 'SIGTERM')
  const identities = [...descendants, ...(directIdentity?.starttime ? [directIdentity] : [])]
  if (!await waitCapturedGone(identities, 1_000)) {
    // Recheck every captured PID+starttime immediately before escalation. The
    // direct child is still signalled through its owned ChildProcess handle.
    if (directIdentity?.starttime && await identityStillMatches(directIdentity)) child.kill('SIGKILL')
    for (const identity of descendants) await signalCaptured(identity, 'SIGKILL')
    if (!await waitCapturedGone(identities, 2_000)) {
      throw new Error('owned child descendants survived capability-scoped emergency shutdown')
    }
  }
  await Promise.race([
    childExit,
    delay(2_000).then(() => { throw new Error('owned direct child did not exit during emergency shutdown') }),
  ])
}

process.on('message', message => {
  if (message?.type === 'release') process.exit(0)
  if (message?.type !== 'emergency-shutdown') return
  emergencyShutdown ??= runEmergencyShutdown()
  emergencyShutdown.then(
    () => { send({ type: 'emergency-shutdown-complete', ok: true }); setImmediate(() => process.exit(0)) },
    error => { send({ type: 'emergency-shutdown-complete', ok: false, message: error.message }); setImmediate(() => process.exit(1)) },
  )
})
setInterval(() => {}, 60_000).unref()
