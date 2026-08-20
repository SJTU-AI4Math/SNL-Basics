import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const [encoded] = process.argv.slice(2)
if (!encoded || !process.send) throw new Error('owned-process supervisor requires encoded configuration and IPC')
const { command, args, cwd, env } = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
const emergencyHelperPath = new URL('./owned_process_emergency.py', import.meta.url).pathname
const RESULT_FRAME = 'SNL_OWNED_PROCESS_EMERGENCY_RESULT\t'

// The supervisor is the durable process-group anchor. Group SIGTERM reaches it,
// but it deliberately stays alive until the owner verifies group convergence.
process.on('SIGTERM', () => {})
process.on('disconnect', () => {})

function send(message) {
  try { process.send?.(message) } catch {}
}

function parseStat(text, pid) {
  const end = text.lastIndexOf(')')
  if (end < 0) throw new Error(`malformed direct-child identity for PID ${pid}`)
  const fields = text.slice(end + 2).trim().split(/\s+/)
  if (fields.length < 20) throw new Error(`malformed direct-child identity fields for PID ${pid}`)
  return { ppid: Number(fields[1]), starttime: fields[19] }
}

async function readDirectChildIdentity(pid) {
  const identity = parseStat(await readFile(`/proc/${pid}/stat`, 'utf8'), pid)
  if (identity.ppid !== process.pid) throw new Error(`owned direct-child ancestry mismatch for PID ${pid}`)
  return identity
}

let child
let directChildIdentity
let resolveDirectChildIdentity
let rejectDirectChildIdentity
const directChildIdentityReady = new Promise((resolve, reject) => {
  resolveDirectChildIdentity = resolve
  rejectDirectChildIdentity = reject
})
directChildIdentityReady.catch(() => {})
try {
  child = spawn(command, args, {
    cwd,
    env,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.pipe(process.stdout)
  child.stderr?.pipe(process.stderr)
  child.once('spawn', async () => {
    try {
      directChildIdentity = await readDirectChildIdentity(child.pid)
      resolveDirectChildIdentity(directChildIdentity)
      send({ type: 'child-spawn', pid: child.pid })
    } catch (error) {
      rejectDirectChildIdentity(error)
      send({ type: 'child-error', message: error.message, code: error.code })
    }
  })
  child.on('error', error => send({ type: 'child-error', message: error.message, code: error.code }))
  child.once('exit', (code, signal) => send({ type: 'child-exit', code, signal }))
} catch (error) {
  rejectDirectChildIdentity(error)
  send({ type: 'child-error', message: error.message, code: error.code })
}

async function runEmergencyShutdown(timeoutMs = 6_000) {
  if (process.platform !== 'linux') throw new Error('pidfd emergency cleanup requires Linux')
  if (!child?.pid) throw new Error('owned direct child was unavailable for pidfd containment')
  directChildIdentity = await directChildIdentityReady

  const helper = spawn(process.env.PYTHON ?? 'python3', [
    emergencyHelperPath,
    String(child.pid),
    directChildIdentity.starttime,
    String(process.pid),
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
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`pidfd emergency helper timed out after ${timeoutMs}ms`)), timeoutMs)
  })

  let status
  try {
    status = await Promise.race([exited, timeout])
  } catch (error) {
    helper.kill('SIGKILL')
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 500))])
    throw error
  } finally {
    clearTimeout(timer)
  }

  const frames = stdout.split(/\r?\n/).filter(line => line.startsWith(RESULT_FRAME))
  if (frames.length !== 1) throw new Error(`pidfd emergency helper returned ${frames.length} framed results (expected exactly one; exit ${status.code}, signal ${status.signal}): ${stderr.trim()}`)
  let result
  try { result = JSON.parse(frames[0].slice(RESULT_FRAME.length)) }
  catch (error) { throw new Error('pidfd emergency helper returned malformed framed JSON', { cause: error }) }
  if (status.code !== 0 || result.ok !== true) {
    const failure = new Error(`pidfd emergency helper failed: ${result.message ?? stderr.trim() ?? `exit ${status.code}`}`)
    failure.cleanupIncomplete = true
    throw failure
  }
  return result
}

let emergencyShutdown
process.on('message', message => {
  if (message?.type === 'release') process.exit(0)
  if (message?.type !== 'emergency-shutdown') return
  emergencyShutdown ??= runEmergencyShutdown()
  emergencyShutdown.then(
    result => { send({ type: 'emergency-shutdown-complete', ...result }); setImmediate(() => process.exit(0)) },
    error => {
      send({ type: 'emergency-shutdown-complete', ok: false, cleanupIncomplete: true, message: error.message })
      setImmediate(() => process.exit(1))
    },
  )
})
setInterval(() => {}, 60_000).unref()
