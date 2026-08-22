import { mkdtempSync, rmSync } from 'node:fs'
import { createConnection, createServer as createTcpServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'vite'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const fixture = join(root, 'test-fixtures/root-text-typography')
const chrome = process.env.CHROMIUM_PATH || [
  join(process.env.HOME || '', '.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell'),
  join(process.env.HOME || '', '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
].find((path) => { try { return Boolean(path) && process.getBuiltinModule('fs').existsSync(path) } catch { return false } })
if (!chrome) throw new Error('Chromium not found; set CHROMIUM_PATH')

const nonce = randomBytes(24).toString('hex')

function reserveEphemeralPort() {
  return new Promise((resolve, reject) => {
    const reservation = createTcpServer()
    reservation.once('error', reject)
    reservation.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      const reservedAddress = reservation.address()
      if (!reservedAddress || typeof reservedAddress === 'string') {
        reservation.close(() => reject(new Error('Could not reserve an ephemeral TCP port')))
        return
      }
      reservation.close((error) => error ? reject(error) : resolve(reservedAddress.port))
    })
  })
}

const requestedPort = await reserveEphemeralPort()
const server = await createServer({
  root: fixture,
  configFile: join(fixture, 'vite.config.ts'),
  logLevel: 'silent',
  define: {
    __SNL_TYPOGRAPHY_VERIFY_NONCE__: JSON.stringify(nonce),
  },
  server: {
    host: '127.0.0.1',
    port: requestedPort,
    strictPort: true,
  },
})
await server.listen()
const address = server.httpServer?.address()
if (!address || typeof address === 'string') {
  await server.close()
  throw new Error('Vite did not expose an owned TCP address')
}
const port = address.port
let closingServer = false
let rejectServerFailure
const serverFailure = new Promise((_, reject) => { rejectServerFailure = reject })
serverFailure.catch(() => {})
server.httpServer.once('close', () => {
  if (!closingServer) rejectServerFailure(new Error('Owned Vite server closed unexpectedly'))
})
server.httpServer.once('error', (error) => {
  if (!closingServer) rejectServerFailure(error)
})

const profile = mkdtempSync(join(tmpdir(), 'snl-root-text-chrome-'))
const activeBrowsers = new Set()

function runBrowser(mode) {
  const browserProfile = `${profile}-${mode}`
  const browser = spawn(chrome, [
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    `--user-data-dir=${browserProfile}`,
    '--virtual-time-budget=5000',
    '--dump-dom',
    `http://127.0.0.1:${port}/${mode}.html`,
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  activeBrowsers.add(browser)
  let stdout = ''
  let stderr = ''
  browser.stdout.on('data', (chunk) => { stdout += chunk })
  browser.stderr.on('data', (chunk) => { stderr += chunk })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      browser.kill('SIGKILL')
      reject(new Error(`${mode}: Chromium timed out`))
    }, 20_000)
    browser.once('error', (error) => {
      clearTimeout(timeout)
      activeBrowsers.delete(browser)
      reject(error)
    })
    browser.once('close', (code) => {
      clearTimeout(timeout)
      activeBrowsers.delete(browser)
      resolve({ code, stdout, stderr })
    })
  })
}

function canConnect(portToCheck) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port: portToCheck })
    const finish = (value) => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(500, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

try {
  for (const mode of ['standalone', 'entry']) {
    const { code, stdout, stderr } = await Promise.race([
      runBrowser(mode),
      serverFailure,
    ])
    const match = stdout.match(/<pre id="result" data-status="(pass|fail)">([^<]*)<\/pre>/)
    if (code !== 0 || !match) {
      throw new Error(`${mode}: Chromium fixture failed (${code})\n${stderr}\n${stdout.slice(-2000)}`)
    }
    const payloadText = match[2].replaceAll('&quot;', '"').replaceAll('&amp;', '&')
    let payload
    try {
      payload = JSON.parse(payloadText)
    } catch {
      throw new Error(`${mode}: fixture returned invalid JSON: ${payloadText}`)
    }
    if (payload.nonce !== nonce) {
      throw new Error(`${mode}: result did not originate from the launched fixture`)
    }
    console.log(`${mode}: ${payloadText}`)
    if (match[1] !== 'pass') {
      throw new Error(`${mode}: typography assertions failed: ${JSON.stringify(payload.failed ?? [])}`)
    }
  }
} finally {
  for (const browser of activeBrowsers) browser.kill('SIGKILL')
  await Promise.all([...activeBrowsers].map((browser) => new Promise((resolve) => {
    if (browser.exitCode !== null || browser.signalCode !== null) resolve()
    else browser.once('close', resolve)
  })))
  closingServer = true
  await server.close()
  const portStillOpen = await canConnect(port)
  rmSync(profile, { recursive: true, force: true })
  for (const mode of ['standalone', 'entry']) {
    rmSync(`${profile}-${mode}`, { recursive: true, force: true })
  }
  if (portStillOpen) throw new Error(`Owned Vite port ${port} remained open after close`)
}
