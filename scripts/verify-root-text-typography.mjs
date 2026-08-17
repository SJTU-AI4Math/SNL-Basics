import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const root = new URL('..', import.meta.url).pathname
const fixture = join(root, 'test-fixtures/root-text-typography')
const chrome = process.env.CHROMIUM_PATH || [
  join(process.env.HOME || '', '.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell'),
  join(process.env.HOME || '', '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
].find((path) => { try { return Boolean(path) && process.getBuiltinModule('fs').existsSync(path) } catch { return false } })
if (!chrome) throw new Error('Chromium not found; set CHROMIUM_PATH')
const vite = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), fixture, '--host', '127.0.0.1', '--port', '4187', '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
let viteLog = ''
vite.stdout.on('data', (chunk) => { viteLog += chunk })
vite.stderr.on('data', (chunk) => { viteLog += chunk })
const profile = mkdtempSync(join(tmpdir(), 'snl-root-text-chrome-'))
try {
  let ready = false
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { const response = await fetch('http://127.0.0.1:4187/standalone.html'); if (response.ok) { ready = true; break } } catch {}
    await delay(100)
  }
  if (!ready) throw new Error(`Vite fixture did not start:
${viteLog}`)
  for (const mode of ['standalone', 'entry']) {
    const browser = spawn(chrome, ['--headless', '--no-sandbox', '--disable-gpu', `--user-data-dir=${profile}-${mode}`, '--virtual-time-budget=5000', '--dump-dom', `http://127.0.0.1:4187/${mode}.html`], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''
    browser.stdout.on('data', (chunk) => { stdout += chunk })
    browser.stderr.on('data', (chunk) => { stderr += chunk })
    const code = await new Promise((resolve) => browser.on('close', resolve))
    const match = stdout.match(/<pre id="result" data-status="(pass|fail)">([^<]*)<\/pre>/)
    if (code !== 0 || !match) throw new Error(`${mode}: Chromium fixture failed (${code})
${stderr}
${stdout.slice(-2000)}`)
    const payload = match[2].replaceAll('&quot;', '"').replaceAll('&amp;', '&')
    console.log(`${mode}: ${payload}`)
    if (match[1] !== 'pass') process.exitCode = 1
  }
} finally {
  vite.kill('SIGTERM')
  rmSync(profile, { recursive: true, force: true })
  for (const mode of ['standalone', 'entry']) rmSync(`${profile}-${mode}`, { recursive: true, force: true })
}
