import { spawn } from 'node:child_process'
import { freezeKillProcessTree } from './owned-process-emergency.mjs'

const [encoded] = process.argv.slice(2)
if (!encoded || !process.send) throw new Error('owned-process supervisor requires encoded configuration and IPC')
const { command, args, cwd, env } = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))

// The supervisor is the durable process-group anchor. Group SIGTERM reaches it,
// but it deliberately stays alive until the owner verifies group convergence.
process.on('SIGTERM', () => {})
process.on('disconnect', () => {})

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
  if (!child) throw new Error('owned direct child was unavailable for emergency containment')
  await freezeKillProcessTree(child, childExit)
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
