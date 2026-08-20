import { readFile, readdir } from 'node:fs/promises'
import { setTimeout as nodeDelay } from 'node:timers/promises'

function parseStat(text) {
  const end = text.lastIndexOf(')')
  if (end < 0) throw new Error('malformed /proc stat')
  const fields = text.slice(end + 2).trim().split(/\s+/)
  if (fields.length < 20) throw new Error('malformed /proc stat fields')
  return {
    state: fields[0],
    ppid: Number(fields[1]),
    starttime: fields[19],
  }
}

export async function readProcessIdentity(pid) {
  try { return { pid, ...parseStat(await readFile(`/proc/${pid}/stat`, 'utf8')) } }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error }
}

async function listProcessIds() {
  return (await readdir('/proc', { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map(entry => Number(entry.name))
}

function isStopped(identity) {
  return identity != null && /^[Tt]$/.test(identity.state)
}

async function defaultSnapshotDescendants(rootPid, dependencies) {
  const processes = []
  for (const pid of await dependencies.listProcessIds()) {
    const identity = await dependencies.readIdentity(pid)
    if (identity) processes.push({ pid, ...identity })
  }

  const descendants = []
  const seen = new Set([rootPid])
  const pending = [{ pid: rootPid, depth: 0 }]
  while (pending.length > 0) {
    const parent = pending.shift()
    for (const process of processes) {
      if (process.ppid !== parent.pid || seen.has(process.pid)) continue
      const descendant = { ...process, depth: parent.depth + 1 }
      descendants.push(descendant)
      seen.add(process.pid)
      pending.push(descendant)
    }
  }
  return descendants
}

async function waitUntil(check, timeoutMs, delay) {
  const deadline = Date.now() + timeoutMs
  while (true) {
    if (await check()) return true
    if (Date.now() >= deadline) return false
    await delay(Math.min(10, Math.max(1, deadline - Date.now())))
  }
}

async function requireMatching(identity, readIdentity) {
  const actual = await readIdentity(identity.pid)
  if (!actual || actual.starttime !== identity.starttime) {
    throw new Error(`owned process identity changed while containing PID ${identity.pid}`)
  }
  return actual
}

async function signalExact(identity, signal, dependencies) {
  await requireMatching(identity, dependencies.readIdentity)
  try { dependencies.signalProcess(identity.pid, signal) }
  catch (error) {
    if (error?.code === 'ESRCH') {
      throw new Error(`owned process identity disappeared before ${signal} for PID ${identity.pid}`, { cause: error })
    }
    throw error
  }
}

async function cleanupPartialFreeze(child, directIdentity, frozen, childExit, dependencies) {
  const errors = []
  for (const identity of [...frozen.values()].sort((left, right) => right.depth - left.depth)) {
    try {
      const actual = await dependencies.readIdentity(identity.pid)
      if (actual?.starttime === identity.starttime) dependencies.signalProcess(identity.pid, 'SIGKILL')
    } catch (error) { errors.push(error) }
  }
  try { child.kill('SIGKILL') } catch (error) { errors.push(error) }

  await Promise.race([childExit.catch(() => {}), dependencies.delay(dependencies.cleanupTimeoutMs)])

  for (const identity of frozen.values()) {
    try {
      const actual = await dependencies.readIdentity(identity.pid)
      if (actual?.starttime === identity.starttime && isStopped(actual)) dependencies.signalProcess(identity.pid, 'SIGCONT')
    } catch (error) { errors.push(error) }
  }
  if (directIdentity) {
    try {
      const actual = await dependencies.readIdentity(directIdentity.pid)
      if (actual?.starttime === directIdentity.starttime && isStopped(actual)) child.kill('SIGCONT')
    } catch (error) { errors.push(error) }
  }
  return errors
}

/**
 * Capability-scoped emergency shutdown for an unverified process-group anchor.
 * The owned direct ChildProcess is stopped first. Descendants are then frozen
 * by rechecked PID+starttime identities until a stopped-tree fixed point is
 * observed; only positive exact-identity SIGKILLs are used afterward.
 */
export async function freezeKillProcessTree(child, childExit, options = {}) {
  if (!child?.pid || !Number.isSafeInteger(child.pid) || child.pid <= 0) {
    throw new Error('owned direct child has no valid PID for emergency containment')
  }
  const dependencies = {
    listProcessIds,
    readIdentity: readProcessIdentity,
    signalProcess: process.kill.bind(process),
    delay: nodeDelay,
    maxFreezeIterations: 32,
    stopTimeoutMs: 500,
    exitTimeoutMs: 2_000,
    cleanupTimeoutMs: 250,
    ...options,
  }
  const frozen = new Map()
  let directIdentity

  try {
    if (!child.kill('SIGSTOP')) throw new Error('owned direct child could not be stopped')
    const direct = await dependencies.readIdentity(child.pid)
    if (!direct) throw new Error('owned direct child disappeared after SIGSTOP')
    directIdentity = { pid: child.pid, starttime: direct.starttime, depth: 0 }
    const directStopped = await waitUntil(async () => {
      const actual = await requireMatching(directIdentity, dependencies.readIdentity)
      return isStopped(actual)
    }, dependencies.stopTimeoutMs, dependencies.delay)
    if (!directStopped) throw new Error('owned direct child did not stop during emergency containment')

    let converged = false
    for (let iteration = 0; iteration < dependencies.maxFreezeIterations; iteration += 1) {
      const directActual = await requireMatching(directIdentity, dependencies.readIdentity)
      if (!isStopped(directActual)) throw new Error('owned direct child resumed during emergency containment')
      for (const identity of frozen.values()) {
        const actual = await requireMatching(identity, dependencies.readIdentity)
        if (!isStopped(actual)) throw new Error(`owned descendant PID ${identity.pid} resumed during emergency containment`)
      }

      const snapshot = await defaultSnapshotDescendants(child.pid, dependencies)
      const newlyDiscovered = snapshot
        .filter(identity => !frozen.has(identity.pid))
        .sort((left, right) => left.depth - right.depth)
      if (newlyDiscovered.length === 0) {
        converged = true
        break
      }

      for (const identity of newlyDiscovered) {
        await signalExact(identity, 'SIGSTOP', dependencies)
        frozen.set(identity.pid, identity)
        const stopped = await waitUntil(async () => {
          const actual = await requireMatching(identity, dependencies.readIdentity)
          return isStopped(actual)
        }, dependencies.stopTimeoutMs, dependencies.delay)
        if (!stopped) throw new Error(`owned descendant PID ${identity.pid} did not stop`)
      }
    }
    if (!converged) throw new Error(`owned process tree did not converge after ${dependencies.maxFreezeIterations} freeze iterations`)

    for (const identity of [...frozen.values()].sort((left, right) => right.depth - left.depth)) {
      await signalExact(identity, 'SIGKILL', dependencies)
    }
    const directBeforeKill = await requireMatching(directIdentity, dependencies.readIdentity)
    if (!isStopped(directBeforeKill)) throw new Error('owned direct child resumed before emergency kill')
    if (!child.kill('SIGKILL')) throw new Error('owned direct child could not be killed')

    const directExited = await Promise.race([
      childExit.then(() => true),
      dependencies.delay(dependencies.exitTimeoutMs).then(() => false),
    ])
    if (!directExited) throw new Error('owned direct child did not exit during emergency shutdown')

    const identities = [directIdentity, ...frozen.values()]
    const allGone = await waitUntil(async () => {
      for (const identity of identities) {
        const actual = await dependencies.readIdentity(identity.pid)
        if (actual?.starttime === identity.starttime) return false
        if (actual && actual.starttime !== identity.starttime) {
          throw new Error(`owned process PID ${identity.pid} was reused before shutdown verification`)
        }
      }
      return (await defaultSnapshotDescendants(child.pid, dependencies)).length === 0
    }, dependencies.exitTimeoutMs, dependencies.delay)
    if (!allGone) throw new Error('verified owned descendants remained after emergency shutdown')
  } catch (error) {
    const cleanupErrors = await cleanupPartialFreeze(child, directIdentity, frozen, childExit, dependencies)
    if (cleanupErrors.length > 0) {
      throw new AggregateError([error, ...cleanupErrors], `${error.message}; partial freeze cleanup also failed`)
    }
    throw error
  }
}
