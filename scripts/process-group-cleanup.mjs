import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

function processGroupIsAlive(groupId) {
  try {
    process.kill(-groupId, 0)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    throw error
  }
}

function signalProcessGroup(groupId, signal) {
  try {
    process.kill(-groupId, signal)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    throw error
  }
}

function observeExit(child) {
  const state = { settled: false, result: undefined, error: undefined }
  state.promise = new Promise((resolve) => {
    const settle = (result) => {
      if (state.settled) return
      state.settled = true
      state.result = result
      resolve(result)
    }
    child.once('exit', (code, signal) => settle({ code, signal }))
    child.on('error', (error) => {
      state.error ??= error
      if (child.pid == null) settle({ error })
    })
  })
  return state
}

export async function spawnOwnedProcess(command, args, options = {}) {
  if (process.platform !== 'linux') {
    throw new Error('owned process-group cleanup currently requires Linux')
  }
  const child = spawn(command, args, { ...options, detached: true })
  const exitState = observeExit(child)

  await new Promise((resolve, reject) => {
    const onSpawn = () => {
      child.off('error', onStartupError)
      resolve()
    }
    const onStartupError = (error) => {
      child.off('spawn', onSpawn)
      reject(error)
    }
    child.once('spawn', onSpawn)
    child.once('error', onStartupError)
  })

  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) {
    throw new Error('owned child emitted spawn without a valid PID')
  }

  return {
    child,
    pid: child.pid,
    groupId: child.pid,
    exited: exitState.promise,
    exitState,
  }
}

async function waitForGroupConvergence(owned, timeoutMs, pollIntervalMs) {
  const deadline = Date.now() + timeoutMs
  while (true) {
    const groupGone = !processGroupIsAlive(owned.groupId)
    if (groupGone && owned.exitState.settled) return true
    if (Date.now() >= deadline) return false
    await Promise.race([
      owned.exited,
      delay(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now()))),
    ])
  }
}

export async function terminateOwnedProcess(owned, {
  sigtermTimeoutMs = 2_000,
  sigkillTimeoutMs = 2_000,
  pollIntervalMs = 25,
} = {}) {
  if (!owned) return { escalated: false }
  if (!Number.isSafeInteger(owned.groupId) || owned.groupId <= 0) {
    throw new Error('refusing to terminate an invalid process group')
  }

  signalProcessGroup(owned.groupId, 'SIGTERM')
  if (await waitForGroupConvergence(owned, sigtermTimeoutMs, pollIntervalMs)) {
    return { escalated: false }
  }

  signalProcessGroup(owned.groupId, 'SIGKILL')
  if (await waitForGroupConvergence(owned, sigkillTimeoutMs, pollIntervalMs)) {
    return { escalated: true }
  }

  throw new Error(`process group ${owned.groupId} survived SIGKILL cleanup`)
}
