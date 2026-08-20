import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { spawnOwnedProcess, terminateOwnedProcess } from './process-group-cleanup.mjs'
import { Cdp } from './cdp-client.mjs'
import { closeOwnedVite, raceVerifierLifecycle, startOwnedVite } from './verifier-infrastructure.mjs'

const root = new URL('..', import.meta.url).pathname
const fixture = join(root, 'test-fixtures/formula-foreign-box')
const artifactDir = join(tmpdir(), 'snl-basics-task6-formula-foreign-box')
rmSync(artifactDir, { recursive: true, force: true })
mkdirSync(artifactDir, { recursive: true })
const chrome = process.env.CHROMIUM_PATH || [
  join(process.env.HOME || '', '.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell'),
  join(process.env.HOME || '', '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
].find(candidate => candidate && existsSync(candidate))
if (!chrome) throw new Error('Chromium not found; set CHROMIUM_PATH')

let lifecycleRace = promise => Promise.resolve(promise)
async function waitFor(check, label) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const value = await lifecycleRace(check())
    if (value) return value
    await lifecycleRace(delay(25))
  }
  throw new Error(`Timed out waiting for ${label}`)
}
function assert(value, message) { if (!value) throw new Error(message) }
async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}

let vite
let browser
let profile
let cdp
let browserLog = ''
let verificationResults
let verificationError
let browserTreeGone = false
const cleanupErrors = []
const networkRequests = new Map()
const networkFailures = []
const fontRequests = []
try {
  vite = await startOwnedVite(fixture)
  profile = mkdtempSync(join(tmpdir(), 'snl-formula-foreign-chrome-'))
  browser = await spawnOwnedProcess(chrome, ['--headless', '--no-sandbox', '--disable-gpu', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
  browser.child.stderr.on('data', chunk => { browserLog += chunk })
  lifecycleRace = promise => raceVerifierLifecycle(vite, browser, promise)
  await lifecycleRace(fetch(vite.url).then(response => response.ok || Promise.reject(new Error('owned Vite fixture was not ready'))))
  const websocketUrl = await waitFor(async () => browserLog.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1], 'Chromium endpoint')
  const targets = await lifecycleRace(fetch(`http://${new URL(websocketUrl).host}/json/list`).then(response => response.json()))
  cdp = new Cdp(targets[0].webSocketDebuggerUrl)
  const rawSend = cdp.send.bind(cdp)
  cdp.send = (...args) => lifecycleRace(rawSend(...args))
  await lifecycleRace(cdp.ready())
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Network.enable')
  const fixtureOrigin = new URL(vite.url).origin
  const fixtureResourceTypes = new Set(['Stylesheet', 'Font', 'Script', 'Image'])
  const fixtureOwned = (url, type) => {
    try { return new URL(url).origin === fixtureOrigin && fixtureResourceTypes.has(type) }
    catch { return false }
  }
  cdp.on('Network.requestWillBeSent', event => {
    if (!fixtureOwned(event.request?.url, event.type)) return
    const request = { requestId: event.requestId, url: event.request.url, type: event.type, status: undefined }
    networkRequests.set(event.requestId, request)
    if (event.type === 'Font') fontRequests.push(request)
  })
  cdp.on('Network.responseReceived', event => {
    const request = networkRequests.get(event.requestId)
    if (!request) return
    request.status = event.response.status
    if (event.response.status >= 400) networkFailures.push(`${request.type} ${request.url} returned HTTP ${event.response.status}`)
  })
  cdp.on('Network.loadingFailed', event => {
    const request = networkRequests.get(event.requestId)
    if (request) networkFailures.push(`${request.type} ${request.url} failed: ${event.errorText}`)
  })
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__fixtureErrors = [];
    const originalError = console.error.bind(console);
    console.error = (...args) => { window.__fixtureErrors.push('console.error: ' + args.map(String).join(' ')); originalError(...args); };
    addEventListener('error', event => window.__fixtureErrors.push('error: ' + event.message));
    addEventListener('unhandledrejection', event => window.__fixtureErrors.push('unhandledrejection: ' + String(event.reason)));
  ` })
  const results = []
  for (const testCase of [{ name: '390', width: 390, height: 1500 }, { name: '1000', width: 1000, height: 760 }]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: testCase.width, height: testCase.height, deviceScaleFactor: 1, mobile: false })
    await cdp.send('Page.navigate', { url: vite.url })
    await waitFor(() => evaluate(cdp, 'Boolean(window.__formulaForeignFixture?.ready())'), `${testCase.name} positioned formula boxes`)
    await evaluate(cdp, 'document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))')
    const before = await evaluate(cdp, `(() => {
      const rv = rect => ({ x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height });
      const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
      const contexts = [...document.querySelectorAll('.context')].map(section => {
        const marker = section.querySelector('[data-snl-formula-foreign-marker]');
        const rule = marker?.querySelector('.snlFormulaForeignMarker .rule');
        const surface = section.querySelector('.interactive-formula-svg');
        const outer = section.querySelector('.snl-foreign-box[data-state="positioned"]');
        const panel = section.querySelector('.katex-panel');
        const host = section.querySelector('.snl-formula-foreign-host');
        const fallback = section.querySelector('.snl-formula-foreign-fallback');
        const rr = rule?.getBoundingClientRect();
        const sr = surface?.getBoundingClientRect();
        const cr = section.getBoundingClientRect();
        const fractionLines = [...section.querySelectorAll('.frac-line')].map(line => line.getBoundingClientRect());
        const delimiters = [...section.querySelectorAll('.delimsizing, .mopen, .mclose')].map(item => item.getBoundingClientRect()).filter(rect => rect.height > 0);
        return {
          name: section.dataset.context,
          markerCount: section.querySelectorAll('[data-snl-formula-foreign-marker]').length,
          rule: rr ? rv(rr) : null,
          surface: sr ? rv(sr) : null,
          outerState: outer?.getAttribute('data-state') || '',
          overflow: { panel: panel ? getComputedStyle(panel).overflow : 'missing', host: host ? getComputedStyle(host).overflow : 'missing' },
          accessibleSvg: section.querySelectorAll('svg[role="img"][aria-label="Arrow from A to B"]').length,
          fallbackHidden: Boolean(fallback?.hidden),
          fallbackDisplay: fallback ? getComputedStyle(fallback).display : 'missing',
          fallbackRects: fallback ? fallback.getClientRects().length : -1,
          errors: section.querySelectorAll('.snl-formula-foreign-error,[role="alert"]').length,
          contained: Boolean(sr && sr.x >= cr.x - 1 && sr.right <= cr.right + 1 && sr.y >= cr.y - 1 && sr.bottom <= cr.bottom + 1),
          fractionOverlap: rr ? fractionLines.reduce((sum, line) => sum + overlap(rr, line), 0) : -1,
          delimiterMaxHeight: delimiters.reduce((max, rect) => Math.max(max, rect.height), 0),
        };
      });
      const math = document.querySelector('.katex .mathnormal');
      const firstFamily = element => getComputedStyle(element).fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
      window.__beforeFormulaSurfaces = [...document.querySelectorAll('.interactive-formula-svg')];
      const first = window.__beforeFormulaSurfaces[0]; first.focus(); first.click();
      return {
        contexts,
        errors: window.__fixtureErrors || [],
        page: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
        font: { main: document.fonts.check('16px KaTeX_Main'), math: document.fonts.check('italic 16px KaTeX_Math'), first: firstFamily(math) },
      };
    })()`)
    assert(before.contexts.length === 9, `${testCase.name} renders all nine formula contexts`)
    for (const context of before.contexts) {
      assert(context.markerCount === 1 && context.rule && context.surface, `${testCase.name}/${context.name} has one marker, calibrated rule, and surface`)
      const delta = Math.max(Math.abs(context.rule.x - context.surface.x), Math.abs(context.rule.y - context.surface.y), Math.abs(context.rule.width - context.surface.width), Math.abs(context.rule.height - context.surface.height))
      assert(delta <= 0.75, `${testCase.name}/${context.name} marker/surface alignment drift ${delta}: ${JSON.stringify(context)}`)
      assert(context.rule.width > 40 && context.rule.height > 25, `${testCase.name}/${context.name} reserves positive fixed TeX geometry`)
      assert(context.outerState === 'positioned', `${testCase.name}/${context.name} surface is committed`)
      assert(context.overflow.panel === 'visible' && context.overflow.host === 'visible', `${testCase.name}/${context.name} exposes an internal scrollbar or clips foreign geometry: ${JSON.stringify(context.overflow)}`)
      assert(context.accessibleSvg === 1, `${testCase.name}/${context.name} exposes one accessible SVG`)
      assert(context.fallbackHidden && context.fallbackDisplay === 'none' && context.fallbackRects === 0, `${testCase.name}/${context.name} has no duplicate fallback geometry`)
      assert(context.errors === 0 && context.contained, `${testCase.name}/${context.name} is visible, contained, and error-free`)
      assert(context.fractionOverlap <= 0.1, `${testCase.name}/${context.name} foreign rule crosses a fraction line`)
      if (context.name === 'delimiters') assert(context.delimiterMaxHeight >= context.rule.height * 0.75, `${testCase.name} delimiters scale around the fixed box`)
    }
    assert(before.errors.length === 0, `${testCase.name} console/runtime errors: ${before.errors.join(' | ')}`)
    assert(before.page.scrollWidth <= before.page.clientWidth + 1, `${testCase.name} has horizontal page overflow`)
    assert(before.font.main && before.font.math && before.font.first === 'KaTeX_Math', `${testCase.name} does not use real KaTeX fonts: ${JSON.stringify(before.font)}`)
    await evaluate(cdp, 'window.__formulaForeignFixture.rerender()')
    await waitFor(() => evaluate(cdp, 'document.querySelector("main")?.dataset.revision === "1"'), `${testCase.name} surrounding rerender`)
    const identity = await evaluate(cdp, `(() => {
      const after = [...document.querySelectorAll('.interactive-formula-svg')];
      return {
        preserved: after.length === window.__beforeFormulaSurfaces.length && after.every((node, index) => node === window.__beforeFormulaSurfaces[index]),
        focused: document.activeElement === after[0],
        interactions: after[0]?.dataset.interactions,
        ready: window.__formulaForeignFixture.ready(),
        errors: window.__fixtureErrors || [],
      };
    })()`)
    assert(identity.preserved && identity.focused && identity.interactions === '1' && identity.ready, `${testCase.name} rerender remounted or disrupted interactive foreign DOM: ${JSON.stringify(identity)}`)
    assert(identity.errors.length === 0, `${testCase.name} rerender errors: ${identity.errors.join(' | ')}`)
    const screenshot = join(artifactDir, `formula-foreign-box-${testCase.name}.png`)
    const capture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    writeFileSync(screenshot, Buffer.from(capture.data, 'base64'))
    results.push({ case: testCase.name, contexts: before.contexts.map(({ name, rule, surface }) => ({ name, rule, surface })), identity, font: before.font, screenshot })
  }
  assert(vite.viteMessages.length === 0, `Vite diagnostics: ${JSON.stringify(vite.viteMessages)}`)
  assert(networkFailures.length === 0, `network failures: ${networkFailures.join(' | ')}`)
  assert(fontRequests.some(request => request.url.includes('KaTeX_Main-Regular') && request.status === 200)
    && fontRequests.some(request => request.url.includes('KaTeX_Math-Italic') && request.status === 200)
    && fontRequests.every(request => request.status === 200 || request.status === 304),
  `KaTeX font requests incomplete: ${JSON.stringify(fontRequests)}`)
  verificationResults = { cases: results, fontRequests: fontRequests.map(({ url, status }) => ({ url, status })), viteMessages: vite.viteMessages, networkFailures }
} catch (error) {
  verificationError = error
} finally {
  try { await cdp?.close() } catch (error) { cleanupErrors.push(new Error('CDP cleanup failed', { cause: error })) }
  browserTreeGone = !browser && verificationError?.cleanupIncomplete !== true
  if (!browser && verificationError?.cleanupIncomplete === true) cleanupErrors.push(new Error('Chromium profile retained because startup cleanup could not be verified'))
  if (browser) {
    try { await terminateOwnedProcess(browser); browserTreeGone = true }
    catch (error) { cleanupErrors.push(new Error(`Chromium process-group cleanup failed for ${browser.groupId}`, { cause: error })) }
  }
  if (vite) {
    try { await closeOwnedVite(vite) }
    catch (error) { cleanupErrors.push(new Error(`Vite server cleanup failed for port ${vite.port}`, { cause: error })) }
  }
  if (profile && browserTreeGone) {
    try { rmSync(profile, { recursive: true, force: true }) }
    catch (error) { cleanupErrors.push(new Error(`Chromium profile cleanup failed: ${profile}`, { cause: error })) }
  }
}
if (verificationError) {
  console.error(verificationError)
  if (vite?.viteMessages?.length) console.error(JSON.stringify(vite.viteMessages))
  console.error(browserLog)
  process.exitCode = 1
}
if (cleanupErrors.length > 0) {
  console.error(new AggregateError(cleanupErrors, 'formula-foreign-box infrastructure cleanup failed'))
  process.exitCode = 1
}
if (!verificationError && cleanupErrors.length === 0) {
  console.log(`formula-foreign-box Chromium PASS ${JSON.stringify(verificationResults)} owned-infrastructure ${JSON.stringify({ vitePort: vite.port, vitePortClosed: vite.closed === true, chromiumGroup: browser.groupId, chromiumAnchor: browser.anchor, chromiumGroupDead: browserTreeGone, profileRemoved: profile ? !existsSync(profile) : true })}`)
}
