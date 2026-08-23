import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer as createTcpServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createServer } from 'vite'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const fixture = join(root, 'test-fixtures/semantic-highlight-geometry')
const chrome = process.env.CHROMIUM_PATH || [
  join(process.env.HOME || '', '.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell'),
  join(process.env.HOME || '', '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
].find((candidate) => candidate && existsSync(candidate))
if (!chrome) throw new Error('Chromium not found; set CHROMIUM_PATH')

function reservePort() {
  return new Promise((resolve, reject) => {
    const reservation = createTcpServer()
    reservation.once('error', reject)
    reservation.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      const address = reservation.address()
      if (!address || typeof address === 'string') {
        reservation.close(() => reject(new Error('Could not reserve a TCP port')))
        return
      }
      reservation.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

const port = await reservePort()
const server = await createServer({
  root: fixture,
  configFile: false,
  logLevel: 'silent',
  server: { host: '127.0.0.1', port, strictPort: true },
})
const profile = mkdtempSync(join(tmpdir(), 'snl-highlight-chrome-'))
let browser

try {
  await server.listen()
  const output = await new Promise((resolve, reject) => {
    browser = spawn(chrome, [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      `--user-data-dir=${profile}`,
      '--virtual-time-budget=5000',
      '--dump-dom',
      `http://127.0.0.1:${port}/index.html`,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    browser.stdout.on('data', (chunk) => { stdout += chunk })
    browser.stderr.on('data', (chunk) => { stderr += chunk })
    const timer = setTimeout(() => {
      browser.kill('SIGTERM')
      reject(new Error('Owned Chromium verification timed out'))
    }, 20_000)
    browser.once('error', (error) => { clearTimeout(timer); reject(error) })
    browser.once('exit', (code, signal) => {
      clearTimeout(timer)
      browser = undefined
      if (code !== 0) reject(new Error(`Chromium exited ${code ?? signal}: ${stderr}`))
      else resolve(stdout)
    })
  })

  const match = output.match(/<pre id="result" data-status="([^"]+)">([^<]*)<\/pre>/)
  if (!match) throw new Error(`Chromium did not return a fixture result: ${output.slice(-1000)}`)
  const decoded = match[2]
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
  if (match[1] !== 'pass') throw new Error(`Semantic highlight fixture failed: ${decoded}`)
  const payload = JSON.parse(decoded)
  console.log(JSON.stringify(payload))
} finally {
  if (browser && browser.exitCode === null) browser.kill('SIGTERM')
  await server.close()
  rmSync(profile, { recursive: true, force: true })
}
