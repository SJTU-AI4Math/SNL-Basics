import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const root = new URL('..', import.meta.url).pathname
const fixture = join(root, 'test-fixtures/popover-origin')
const chrome = process.env.CHROMIUM_PATH || [
  join(process.env.HOME || '', '.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell'),
  join(process.env.HOME || '', '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
].find((path) => Boolean(path) && existsSync(path))
if (!chrome) throw new Error('Chromium not found; set CHROMIUM_PATH')

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url)
    this.nextId = 0
    this.pending = new Map()
    this.socket.onmessage = ({ data }) => {
      const message = JSON.parse(data)
      if (!message.id) return
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)))
      else pending.resolve(message.result)
    }
  }
  async ready() {
    if (this.socket.readyState === WebSocket.OPEN) return
    await new Promise((resolve, reject) => {
      this.socket.onopen = resolve
      this.socket.onerror = reject
    })
  }
  send(method, params = {}) {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  close() { this.socket.close() }
}

async function waitFor(check, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await check()
    if (value) return value
    await delay(25)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function runViewport(cdp, width) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 700, deviceScaleFactor: 1, mobile: false })
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:4188/' })
  await waitFor(async () => (await evaluate(cdp, 'Boolean(window.__popoverProbe && document.getElementById("origin-root"))')), 'fixture mount')

  const center = async (selector) => evaluate(cdp, `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  const move = (point) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
  const down = (point) => cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 })
  const up = (point) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 })
  const live = () => evaluate(cdp, 'window.__popoverProbe.live()')
  const settlingPoint = await center('#origin-settling')
  assert(settlingPoint.x === 76, 'settling fixture uses pointer x=76')
  await move(settlingPoint)
  const [loading] = await waitFor(async () => {
    const value = await live()
    return value.length === 1 && value[0].subject === 'settling' && value[0].width === 304 ? value : null
  }, '304px loading preview')
  const settlingLeft = width === 320 ? 8 : 88
  assert(loading.left === settlingLeft, 'loading preview uses expected initial placement')
  const [settled] = await waitFor(async () => {
    const value = await live()
    return value.length === 1 && value[0].subject === 'settling' && value[0].width === 224 ? value : null
  }, '224px settled preview')
  assert(settled.id === loading.id && settled.left === settlingLeft, 'async settling preserves preview identity and placement')
  await down(settlingPoint); await up(settlingPoint)
  const [settledPin] = await waitFor(async () => {
    const value = await live()
    return value.length === 1 && value[0].subject === 'settling' && value[0].frozen ? value : null
  }, 'settled preview pin')
  assert(settledPin.id === loading.id, 'settled click promotes the preview in place')
  assert(settledPin.left === settlingLeft, 'fresh equivalent descriptor pin preserves settled placement')
  await evaluate(cdp, 'window.__popoverProbe.dismissAll()')
  await waitFor(async () => (await live()).length === 0, 'settling dismissal')

  const rootPoint = await center('#origin-root')

  await move(rootPoint)
  const [preview] = await waitFor(async () => {
    const value = await live()
    return value.length === 1 && value[0].subject === 'root' && value[0].phase === 'visible' ? value : null
  }, 'visible root preview')
  assert(preview.anchorId === 'origin-root', 'descriptor retains semantic origin element')
  assert(preview.originRect.width > 0 && preview.originRect.height > 0, 'preview has real origin geometry')
  assert(preview.left >= 8 && preview.left + 100 <= width - 8, 'preview uses viewport bounds')

  await down(rootPoint)
  const [afterDown] = await live()
  assert(afterDown?.id === preview.id, 'native pointerdown on origin does not dismiss')
  await up(rootPoint)
  const [pinned] = await waitFor(async () => {
    const value = await live()
    return value.length === 1 && value[0].frozen ? value : null
  }, 'same preview pinned')
  assert(pinned.id === preview.id, 'click promotes preview without changing identity')
  assert(pinned.left === preview.left && pinned.top === preview.top, 'promotion preserves placement')
  assert(pinned.anchorId === preview.anchorId, 'promotion preserves anchor')
  assert(pinned.bounds === preview.bounds && pinned.left + 100 <= width - 8, 'promotion preserves viewport bounds')

  const outside = { x: 5, y: 500 }
  await move(outside); await down(outside); await up(outside)
  await waitFor(async () => (await live()).length === 0, 'outside dismissal')

  // Press/release at a new coordinate without a preceding mouse move: click-only pin path.
  await down(rootPoint); await up(rootPoint)
  const [clickOnly] = await waitFor(async () => {
    const value = await live()
    return value.length === 1 && value[0].frozen ? value : null
  }, 'click-only pin')
  assert(clickOnly.left === preview.left && clickOnly.top === preview.top, 'click-only placement matches hover preview')

  const childPoint = await center('[data-popover-id] #origin-child')
  await move(childPoint)
  const childPreview = await waitFor(async () => {
    const value = await live()
    return value.find((item) => item.subject === 'child') || null
  }, 'nested child preview')
  await down(childPoint); await up(childPoint)
  const nested = await waitFor(async () => {
    const value = await live()
    const child = value.find((item) => item.subject === 'child')
    return child?.frozen ? value : null
  }, 'nested child pin')
  const root = nested.find((item) => item.subject === 'root')
  const child = nested.find((item) => item.subject === 'child')
  assert(root?.id === clickOnly.id, 'nested child preserves root')
  assert(child?.id === childPreview.id && child.parentId === root.id, 'nested child preserves parent identity')

  const beforeScroll = root
  await evaluate(cdp, 'window.__popoverProbe.moveOrigin(-100, 30); document.dispatchEvent(new Event("scroll", { bubbles: true }))')
  const afterScroll = await waitFor(async () => {
    const item = (await live()).find((value) => value.subject === 'root')
    return item && item.originRect.left !== beforeScroll.originRect.left ? item : null
  }, 'scroll geometry refresh')
  assert(afterScroll.id === beforeScroll.id, 'scroll remeasure preserves identity')
  assert(afterScroll.originRect.left === beforeScroll.originRect.left - 100, 'scroll remeasures moved origin x')
  assert(afterScroll.originRect.top === beforeScroll.originRect.top + 30, 'scroll remeasures moved origin y')
  assert(afterScroll.left < beforeScroll.left, 'scroll moves rendered popover with origin geometry')

  await evaluate(cdp, 'window.__popoverProbe.moveOrigin(-130, 50)')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: width - 1, height: 700, deviceScaleFactor: 1, mobile: false })
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 700, deviceScaleFactor: 1, mobile: false })
  const afterResize = await waitFor(async () => {
    const item = (await live()).find((value) => value.subject === 'root')
    return item && item.originRect.top === beforeScroll.originRect.top + 50 ? item : null
  }, 'resize geometry refresh')
  assert(afterResize.id === beforeScroll.id, 'resize remeasure preserves identity')

  await move(outside); await down(outside); await up(outside)
  await waitFor(async () => (await live()).length === 0, 'final outside dismissal')
  return { width, previewId: preview.id, clickOnlyId: clickOnly.id, childId: child.id, previewLeft: preview.left, movedLeft: afterScroll.left }
}

function assert(value, message) {
  if (!value) throw new Error(message)
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}

const vite = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), fixture, '--host', '127.0.0.1', '--port', '4188', '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
let viteLog = ''
vite.stdout.on('data', (chunk) => { viteLog += chunk })
vite.stderr.on('data', (chunk) => { viteLog += chunk })
const profile = mkdtempSync(join(tmpdir(), 'snl-popover-origin-chrome-'))
const browser = spawn(chrome, ['--headless', '--no-sandbox', '--disable-gpu', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
let browserLog = ''
browser.stderr.on('data', (chunk) => { browserLog += chunk })
let cdp
try {
  await waitFor(async () => {
    try { const response = await fetch('http://127.0.0.1:4188/'); return response.ok } catch { return false }
  }, 'Vite fixture')
  const websocketUrl = await waitFor(async () => browserLog.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1], 'Chromium DevTools endpoint')
  const targets = await (await fetch(`http://${new URL(websocketUrl).host}/json/list`)).json()
  cdp = new Cdp(targets[0].webSocketDebuggerUrl)
  await cdp.ready()
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  const results = []
  for (const width of [320, 1000]) results.push(await runViewport(cdp, width))
  console.log(`popover-origin Chromium PASS ${JSON.stringify(results)}`)
} catch (error) {
  console.error(error)
  console.error(viteLog)
  console.error(browserLog)
  process.exitCode = 1
} finally {
  cdp?.close()
  browser.kill('SIGTERM')
  vite.kill('SIGTERM')
  rmSync(profile, { recursive: true, force: true })
}
