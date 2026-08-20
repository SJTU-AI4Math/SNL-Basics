import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const defaultSupervisorPath = new URL('./owned-process-supervisor.mjs', import.meta.url).pathname
const defaultSubreaperWrapperPath = new URL('./linux-subreaper-exec.py', import.meta.url).pathname
const emergencyHelperPath = new URL('./owned_process_emergency.py', import.meta.url).pathname
const RESULT_FRAME = 'SNL_OWNED_PROCESS_EMERGENCY_RESULT\t'

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
function cleanupFailure(primaryError, cleanupError) {
  const combined = new AggregateError(
    [primaryError, cleanupError],
    `${primaryError.message}; infrastructure cleanup failed: ${cleanupError.message}`,
  )
  combined.cleanupIncomplete = true
  return combined
}
function incomplete(error) {
  error.cleanupIncomplete = true
  return error
}

async function request(supervisor, responseType, message, timeoutMs, supervisorExit, { acceptExit = false } = {}) {
  if (!supervisor.connected || typeof supervisor.send !== 'function') {
    throw incomplete(new Error('owned supervisor IPC capability is unavailable'))
  }
  const requestId = randomUUID()
  const completion = deferred()
  const onMessage = response => {
    if (response?.type === responseType && response?.requestId === requestId) completion.resolve(response)
  }
  supervisor.on('message', onMessage)
  try {
    supervisor.send({ ...message, requestId }, error => { if (error) completion.reject(error) })
    const racers = [
      completion.promise,
      delay(timeoutMs).then(() => { throw new Error(`owned supervisor ${supervisor.pid} timed out waiting for ${responseType}`) }),
    ]
    if (acceptExit) racers.push(supervisorExit.then(() => ({ exited: true, ok: true })))
    const result = await Promise.race(racers)
    if (!result.ok) throw incomplete(new Error(`owned supervisor ${responseType} failed: ${result.message ?? 'unknown failure'}`))
    return result
  } catch (error) {
    throw incomplete(error)
  } finally { supervisor.off('message', onMessage) }
}

async function runExternalEmergency(owned, timeoutMs = 6_000) {
  if (!owned.anchor?.starttime || !Number.isSafeInteger(owned.anchor.ppid)) {
    throw incomplete(new Error('verified supervisor identity is unavailable for pidfd emergency cleanup'))
  }
  const helper = spawn(process.env.PYTHON ?? 'python3', [
    emergencyHelperPath,
    String(owned.anchor.pid),
    owned.anchor.starttime,
    String(owned.anchor.ppid),
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
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`external pidfd emergency helper timed out after ${timeoutMs}ms`)), timeoutMs) }),
    ])
    const frames = stdout.split(/\r?\n/).filter(line => line.startsWith(RESULT_FRAME))
    if (frames.length !== 1) throw new Error(`external pidfd emergency helper returned ${frames.length} framed results (exit ${status.code}, signal ${status.signal}): ${stderr.trim()}`)
    const result = JSON.parse(frames[0].slice(RESULT_FRAME.length))
    if (status.code !== 0 || result.ok !== true) throw new Error(`external pidfd emergency helper failed: ${result.message ?? stderr.trim() ?? `exit ${status.code}`}`)
    const supervisorGone = await Promise.race([owned.exited.then(() => true), delay(timeoutMs).then(() => false)])
    if (!supervisorGone) throw new Error('supervisor did not exit after external pidfd emergency cleanup')
    return result
  } catch (error) {
    helper.kill('SIGKILL')
    await Promise.race([exited, delay(500)])
    throw incomplete(error)
  } finally { clearTimeout(timer) }
}

export async function spawnOwnedProcess(command, args, options = {}, dependencies = {}) {
  if (process.platform !== 'linux') throw new Error('owned process containment requires Linux pidfd/prctl support')
  const onStartupEvent = dependencies.onStartupEvent ?? (() => {})
  const afterChildSpawn = dependencies.afterChildSpawn ?? (() => {})
  const supervisorPath = dependencies.supervisorPath ?? defaultSupervisorPath
  const subreaperWrapperPath = dependencies.subreaperWrapperPath ?? defaultSubreaperWrapperPath
  const startupTimeoutMs = dependencies.startupTimeoutMs ?? 5_000
  if (!Number.isFinite(startupTimeoutMs) || startupTimeoutMs <= 0) throw new Error('startupTimeoutMs must be positive')
  const activationToken = randomUUID()
  const config = Buffer.from(JSON.stringify({ command, args, cwd: options.cwd, env: options.env, activationToken })).toString('base64url')
  const python = options.env?.PYTHON ?? process.env.PYTHON ?? 'python3'
  const supervisor = spawn(python, [subreaperWrapperPath, process.execPath, supervisorPath, config, activationToken], {
    detached: true,
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  // Subscribe synchronously after spawn so no startup terminal event can race
  // past ownership establishment.
  const supervisorDisconnect = new Promise(resolve => supervisor.once('disconnect', resolve))
  const supervisorError = new Promise(resolve => supervisor.once('error', resolve))
  const supervisorExit = new Promise(resolve => supervisor.once('exit', (code, signal) => resolve({ code, signal })))
  const startup = deferred()
  const failed = deferred()
  failed.promise.catch(() => {})
  let stderr = ''
  supervisor.stderr?.setEncoding('utf8').on('data', chunk => { stderr += chunk })
  const owned = {
    child: supervisor,
    pid: undefined,
    groupId: undefined,
    anchor: undefined,
    failure: failed.promise,
    cleaning: false,
    exited: supervisorExit,
  }
  const state = { subreaperReady: false, launchAccepted: false, childReady: false, settled: false, lifecycleFailed: false }
  let startupTimer
  const settleStartup = (settler, value) => {
    if (state.settled) return false
    state.settled = true
    clearTimeout(startupTimer)
    settler(value)
    return true
  }
  const resolveStartup = () => {
    if (!state.subreaperReady || !state.launchAccepted || !state.childReady) return
    settleStartup(startup.resolve, owned)
  }
  const rejectStartup = error => settleStartup(startup.reject, error)
  const rejectLifecycle = error => {
    if (owned.cleaning || state.lifecycleFailed) return false
    state.lifecycleFailed = true
    failed.reject(error)
    return true
  }
  startupTimer = setTimeout(() => rejectStartup(new Error(`owned supervisor startup timed out after ${startupTimeoutMs}ms`)), startupTimeoutMs)
  startupTimer.unref?.()
  supervisorDisconnect.then(() => {
    const phase = state.settled ? 'after startup' : 'during startup'
    const error = new Error(`owned supervisor IPC disconnected `)
    rejectStartup(error)
    rejectLifecycle(error)
  })


  supervisor.on('message', async message => {
    if (message?.type === 'subreaper-ready') {
      if (state.subreaperReady || message.activationToken !== activationToken || message.pid !== supervisor.pid || message.pgrp !== supervisor.pid || !/^\d+$/.test(message.starttime ?? '')) {
        rejectStartup(new Error('invalid verified Linux subreaper handshake'))
        return
      }
      owned.groupId = supervisor.pid
      owned.anchor = { pid: supervisor.pid, ppid: message.ppid, starttime: message.starttime }
      state.subreaperReady = true
      onStartupEvent('subreaper-verified')
      if (!supervisor.connected) {
        rejectStartup(new Error('owned supervisor IPC disconnected before launch command'))
        return
      }
      supervisor.send({ type: 'launch-child', activationToken }, error => {
        if (error) rejectStartup(new Error(`owned supervisor launch command failed: ${error.message}`))
      })
      return
    }
    if (message?.type === 'launch-accepted') {
      if (!state.subreaperReady || message.activationToken !== activationToken || state.launchAccepted) {
        rejectStartup(new Error('invalid owned supervisor launch acknowledgement'))
        return
      }
      state.launchAccepted = true
      onStartupEvent('launch-accepted')
      resolveStartup()
      return
    }
    if (message?.type === 'child-spawn') {
      if (!state.subreaperReady || !state.launchAccepted) {
        rejectStartup(new Error('owned child launched before verified launch acknowledgement'))
        return
      }
      if (!Number.isSafeInteger(message.pid) || message.pid <= 0 || !/^\d+$/.test(message.starttime ?? '')) {
        rejectStartup(new Error(`owned child reported invalid identity for PID ${message.pid}`))
        return
      }
      owned.pid = message.pid
      try { await afterChildSpawn(owned) }
      catch (error) {
        rejectStartup(error)
        rejectLifecycle(error)
        return
      }
      if (state.settled) return
      state.childReady = true
      onStartupEvent('child-spawn-accepted')
      resolveStartup()
      return
    }
    if (message?.type === 'child-error' || message?.type === 'supervisor-startup-error') {
      const error = new Error(`owned ${message.type}: ${message.message}`)
      rejectStartup(error)
      rejectLifecycle(error)
      return
    }
    if (message?.type === 'child-exit') {
      const error = new Error(`owned child exited unexpectedly (code ${message.code}, signal ${message.signal})`)
      rejectStartup(error)
      rejectLifecycle(error)
    }
  })
  supervisorError.then(error => { rejectStartup(error); rejectLifecycle(error) })
  supervisorExit.then(({ code, signal }) => {
    const detail = stderr.trim() ? `: ${stderr.trim()}` : ''
    const error = new Error(`owned supervisor exited unexpectedly (code ${code}, signal ${signal})${detail}`)
    rejectStartup(error)
    rejectLifecycle(error)
  })

  try { return await startup.promise }
  catch (error) {
    owned.cleaning = true
    let cleanupError
    const startupError = stderr.trim() && !error.message.includes(stderr.trim())
      ? new Error(`${error.message}: ${stderr.trim()}`, { cause: error })
      : error
    if (owned.anchor) {
      try { await terminateOwnedProcess(owned) }
      catch (normalError) {
        try { await runExternalEmergency(owned) }
        catch (emergencyError) { cleanupError = new AggregateError([normalError, emergencyError], 'IPC cleanup and pidfd emergency cleanup both failed') }
      }
    } else {
      // Before the authenticated subreaper handshake the wrapper cannot have
      // launched the configured child. A positive ChildProcess capability is safe.
      try {
        if ((await Promise.race([supervisorExit.then(() => false), delay(20).then(() => true)]))) supervisor.kill('SIGKILL')
        const exited = await Promise.race([supervisorExit.then(() => true), delay(2_000).then(() => false)])
        if (!exited) throw new Error('subreaper wrapper did not exit after direct ChildProcess cleanup')
      } catch (directError) { cleanupError = directError }
    }
    if (cleanupError) throw cleanupFailure(startupError, cleanupError)
    throw startupError
  }
}

export function raceOwnedProcess(owned, promise) {
  return Promise.race([Promise.resolve(promise), owned.failure])
}

export async function terminateOwnedProcess(owned, {
  sigtermTimeoutMs = 2_000,
  sigkillTimeoutMs = 2_000,
} = {}) {
  if (!owned) return { escalated: false }
  if (!owned.anchor || owned.anchor.pid !== owned.child.pid) throw new Error('refusing to terminate without an authenticated supervisor capability')
  owned.cleaning = true
  let term
  try {
    term = await request(owned.child, 'group-term-complete', { type: 'group-term', timeoutMs: sigtermTimeoutMs }, sigtermTimeoutMs + 1_000, owned.exited)
    await request(owned.child, 'descendant-shutdown-complete', { type: 'descendant-shutdown', timeoutMs: sigkillTimeoutMs + 2_000 }, sigkillTimeoutMs + 3_000, owned.exited)
  } catch (ipcError) {
    try {
      await runExternalEmergency(owned, sigkillTimeoutMs + 4_000)
      return { escalated: true, emergency: true }
    } catch (emergencyError) {
      throw cleanupFailure(ipcError, emergencyError)
    }
  }

  if (term.onlySupervisor) {
    await request(owned.child, 'release-accepted', { type: 'release' }, sigkillTimeoutMs, owned.exited, { acceptExit: true })
    const exited = await Promise.race([owned.exited.then(() => true), delay(sigkillTimeoutMs).then(() => false)])
    if (!exited) throw incomplete(new Error(`owned supervisor ${owned.anchor.pid} did not exit after release`))
    return { escalated: false }
  }

  await request(owned.child, 'group-kill-accepted', { type: 'group-kill' }, sigkillTimeoutMs, owned.exited, { acceptExit: true })
  const exited = await Promise.race([owned.exited.then(() => true), delay(sigkillTimeoutMs).then(() => false)])
  if (!exited) throw incomplete(new Error(`owned supervisor ${owned.anchor.pid} survived self-group SIGKILL`))
  return { escalated: true }
}
