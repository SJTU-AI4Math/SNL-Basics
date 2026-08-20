import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const root = new URL('..', import.meta.url).pathname
const fixture = join(root, 'test-fixtures/parameterized-svg')
const artifactDir = join(tmpdir(), 'snl-basics-task5-parameterized-svg')
rmSync(artifactDir, { recursive: true, force: true })
mkdirSync(artifactDir, { recursive: true })
const chrome = process.env.CHROMIUM_PATH || [
  join(process.env.HOME || '', '.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell'),
  join(process.env.HOME || '', '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
].find((candidate) => candidate && existsSync(candidate))
if (!chrome) throw new Error('Chromium not found; set CHROMIUM_PATH')

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url)
    this.next = 0
    this.pending = new Map()
    this.socket.onmessage = ({ data }) => {
      const message = JSON.parse(data)
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result)
    }
  }
  async ready() {
    if (this.socket.readyState === WebSocket.OPEN) return
    await new Promise((resolve, reject) => { this.socket.onopen = resolve; this.socket.onerror = reject })
  }
  send(method, params = {}) {
    const id = ++this.next
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  close() { this.socket.close() }
}

async function waitFor(check, label) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const value = await check()
    if (value) return value
    await delay(25)
  }
  throw new Error(`Timed out waiting for ${label}`)
}
function assert(value, message) { if (!value) throw new Error(message) }
async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}

const vite = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), fixture, '--host', '127.0.0.1', '--port', '43190', '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
let viteLog = ''
vite.stdout.on('data', (chunk) => { viteLog += chunk })
vite.stderr.on('data', (chunk) => { viteLog += chunk })
const profile = mkdtempSync(join(tmpdir(), 'snl-svg-template-chrome-'))
const browser = spawn(chrome, ['--headless', '--no-sandbox', '--disable-gpu', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
let browserLog = ''
browser.stderr.on('data', (chunk) => { browserLog += chunk })
let cdp
try {
  await waitFor(async () => { try { return (await fetch('http://127.0.0.1:43190/')).ok } catch { return false } }, 'Vite fixture')
  const websocketUrl = await waitFor(async () => browserLog.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1], 'Chromium endpoint')
  const targets = await (await fetch(`http://${new URL(websocketUrl).host}/json/list`)).json()
  cdp = new Cdp(targets[0].webSocketDebuggerUrl)
  await cdp.ready()
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__fixtureErrors = [];
    const originalError = console.error.bind(console);
    console.error = (...args) => { window.__fixtureErrors.push('console.error: ' + args.map(String).join(' ')); originalError(...args); };
    addEventListener('error', event => window.__fixtureErrors.push('error: ' + event.message));
    addEventListener('unhandledrejection', event => window.__fixtureErrors.push('unhandledrejection: ' + String(event.reason)));
  ` })
  const results = []
  for (const width of [390, 1000]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 760, deviceScaleFactor: 1, mobile: false })
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:43190/' })
    await waitFor(() => evaluate(cdp, 'Boolean(window.__svgFixture?.ready())'), `${width}px positioned fixture`)
    const before = await evaluate(cdp, `(() => {
      const svg = document.querySelector('svg.snl-svg-template-artwork');
      window.__svgBefore = svg;
      window.__svgBeforeChildren = [...document.querySelectorAll('.fixture-frame .snl-foreign-box-measure > *')];
      return {
        markerCount: svg?.querySelectorAll('g[data-snl-slot]').length,
        transforms: [...svg.querySelectorAll('g[data-snl-slot]')].map(x => x.getAttribute('transform')),
        positioned: document.querySelectorAll('.fixture-frame .snl-foreign-box[data-state="positioned"]').length,
        accessibleArtwork: document.querySelectorAll('.fixture-frame svg[role="img"][aria-label]').length,
        accessibleForeign: document.querySelectorAll('.fixture-frame .snl-foreign-box[data-state="positioned"][aria-hidden="false"]:not([inert])').length,
        foreignFallbacks: (() => {
          const visibleTextRectCount = element => {
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
            let count = 0
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              if (!node.textContent?.trim()) continue
              const range = document.createRange()
              range.selectNodeContents(node)
              count += [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).length
            }
            return count
          }
          const boundaries = [...document.querySelectorAll('.fixture-frame [data-snl-foreign-box-fallback]')]
          const wrappers = [...document.querySelectorAll('.fixture-frame .snl-foreign-box[data-state="positioned"]')]
          return boundaries.map((boundary, index) => ({
            hidden: boundary.hasAttribute('hidden') && boundary.hidden,
            display: getComputedStyle(boundary).display,
            clientRects: [...boundary.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).length,
            textRects: visibleTextRectCount(boundary),
            text: boundary.textContent?.trim() || '',
            liveText: wrappers[index]?.textContent?.trim() || '',
            liveTextRects: wrappers[index] ? visibleTextRectCount(wrappers[index]) : 0,
          }))
        })(),
        pageWidth: document.documentElement.scrollWidth,
        viewport: innerWidth,
        alert: document.querySelector('.fixture-frame [role="alert"]')?.textContent || '',
        fallbackProbe: (() => {
          const alert = document.querySelector('#fallback-probe [role="alert"]')
          return {
            text: alert?.textContent || '',
            display: alert ? getComputedStyle(alert).display : 'missing',
            visibleRects: alert ? [...alert.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).length : 0,
            hidden: alert?.hasAttribute('hidden') ?? false,
          }
        })(),
        errors: window.__fixtureErrors || []
      };
    })()`)
    assert(before.markerCount === 4, `${width}px has four real g markers`)
    assert(JSON.stringify(before.transforms) === JSON.stringify(['translate(130 70)', 'translate(500 70)', 'translate(130 290)', 'translate(500 290)']), `${width}px preserves transformed marker geometry`)
    assert(before.positioned === 4, `${width}px positions every foreign label`)
    assert(before.accessibleArtwork === 1, `${width}px exposes exactly one labelled SVG artwork`)
    assert(before.accessibleForeign === 4, `${width}px exposes exactly four positioned foreign labels`)
    assert(before.foreignFallbacks.length === 4, `${width}px retains four stable main-fixture fallback boundaries`)
    before.foreignFallbacks.forEach((fallback, index) => {
      assert(fallback.hidden, `${width}px fallback ${index} has the hidden gate after positioning`)
      assert(fallback.display === 'none', `${width}px fallback ${index} computes display:none (received ${fallback.display})`)
      assert(fallback.clientRects === 0, `${width}px fallback ${index} has no boundary client rects`)
      assert(fallback.textRects === 0, `${width}px fallback ${index} text has no visible normal-flow geometry`)
      assert(fallback.text && fallback.text === fallback.liveText, `${width}px fallback ${index} is associated with its positioned wrapper`)
      assert(fallback.liveTextRects > 0, `${width}px positioned wrapper ${index} remains visibly rendered`)
    })
    assert(before.fallbackProbe.text.includes('fixed arity'), `${width}px exposes deterministic fixed-arity fallback`)
    assert(before.fallbackProbe.display !== 'none' && before.fallbackProbe.visibleRects > 0 && !before.fallbackProbe.hidden, `${width}px keeps the intentional dynamic-arity fallback visibly rendered`)
    assert(before.errors.length === 0, `${width}px has no console/runtime errors: ${before.errors.join(' | ')}`)
    assert(!before.alert, `${width}px has no visible fallback: ${before.alert}`)
    assert(before.pageWidth <= before.viewport, `${width}px fixture has no page overflow`)
    await evaluate(cdp, 'window.__svgFixture.toggle()')
    await waitFor(() => evaluate(cdp, 'document.querySelector(".fixture-frame svg")?.getAttribute("aria-label") === "Updated commutative square projection"'), `${width}px projection update`)
    const identity = await evaluate(cdp, `(() => {
      const afterChildren = [...document.querySelectorAll('.fixture-frame .snl-foreign-box-measure > *')];
      return {
        svg: window.__svgBefore === document.querySelector('svg.snl-svg-template-artwork'),
        children: afterChildren.length === window.__svgBeforeChildren.length && afterChildren.every((node, index) => node === window.__svgBeforeChildren[index]),
        ready: window.__svgFixture.ready(),
        errors: window.__fixtureErrors || []
      };
    })()` )
    assert(identity.svg, `${width}px projection update preserves SVG DOM identity`)
    assert(identity.children, `${width}px projection update preserves every child DOM identity`)
    assert(identity.ready, `${width}px projection update keeps all children positioned`)
    assert(identity.errors.length === 0, `${width}px update has no console/runtime errors: ${identity.errors.join(' | ')}`)
    const screenshot = join(artifactDir, `parameterized-svg-${width}.png`)
    const capture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    writeFileSync(screenshot, Buffer.from(capture.data, 'base64'))
    results.push({
      width,
      markers: before.markerCount,
      positioned: before.positioned,
      hiddenFallbacks: before.foreignFallbacks.filter(fallback => fallback.hidden && fallback.display === 'none' && fallback.textRects === 0).length,
      dynamicFallbackVisible: before.fallbackProbe.visibleRects > 0,
      pageOverflow: Math.max(0, before.pageWidth - before.viewport),
      accessible: before.accessibleForeign,
      svgPreserved: identity.svg,
      childrenPreserved: identity.children,
      screenshot,
    })
  }
  console.log(`parameterized-svg Chromium PASS ${JSON.stringify(results)}`)
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
