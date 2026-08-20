import { spawn } from 'node:child_process'

const [encoded] = process.argv.slice(2)
if (!encoded || !process.send) throw new Error('owned-process supervisor requires encoded configuration and IPC')
const { command, args, cwd, env } = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))

// The supervisor is the durable process-group anchor. Group SIGTERM reaches it,
// but it deliberately stays alive until the owner verifies group convergence.
process.on('SIGTERM', () => {})
process.on('disconnect', () => {})

let child
try {
  child = spawn(command, args, {
    cwd,
    env,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.pipe(process.stdout)
  child.stderr?.pipe(process.stderr)
  child.once('spawn', () => process.send?.({ type: 'child-spawn', pid: child.pid }))
  child.on('error', error => process.send?.({ type: 'child-error', message: error.message, code: error.code }))
  child.once('exit', (code, signal) => process.send?.({ type: 'child-exit', code, signal }))
} catch (error) {
  process.send?.({ type: 'child-error', message: error.message, code: error.code })
}

process.on('message', message => {
  if (message?.type === 'release') process.exit(0)
})
setInterval(() => {}, 60_000).unref()
