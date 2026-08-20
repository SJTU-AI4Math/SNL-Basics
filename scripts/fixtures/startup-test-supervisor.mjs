import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const [encoded] = process.argv.slice(2)
const { command, args, cwd, env, activationToken } = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
const mode = process.env.SNL_TEST_STARTUP_MODE
const identity = async () => {
  const text = await readFile(`/proc/${process.pid}/stat`, 'utf8')
  const fields = text.slice(text.lastIndexOf(')') + 2).trim().split(/\s+/)
  return { ppid: Number(fields[1]), pgrp: Number(fields[2]), starttime: fields[19] }
}
if (mode === 'disconnect-before-ready') {
  process.disconnect()
} else if (mode === 'silent') {
  setInterval(() => {}, 60_000)
} else {
  const own = await identity()
  process.send({ type: 'subreaper-ready', pid: process.pid, pgrp: own.pgrp, ppid: own.ppid, starttime: own.starttime, activationToken }, error => {
    if (error) process.exit(2)
  })
  process.on('message', message => {
    if (message?.type !== 'launch-child') return
    const child = spawn(command, args, { cwd, env, stdio: 'ignore' })
    child.once('spawn', () => {
      if (mode === 'disconnect-after-launch') process.disconnect()
    })
  })
  setInterval(() => {}, 60_000)
}
