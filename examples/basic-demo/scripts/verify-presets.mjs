import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { spawnOwnedProcess, terminateOwnedProcess } from '../../../scripts/process-group-cleanup.mjs'
import { Cdp } from '../../../scripts/cdp-client.mjs'
import { closeOwnedVite, raceVerifierLifecycle, startOwnedVite } from '../../../scripts/verifier-infrastructure.mjs'

const fixture = process.env.SNL_DEMO_FIXTURE || new URL('..', import.meta.url).pathname
const chrome = process.env.CHROMIUM_PATH || [
  join(process.env.HOME || '', '.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell'),
  join(process.env.HOME || '', '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
].find(candidate => candidate && existsSync(candidate))
if (!chrome) throw new Error('Chromium not found; set CHROMIUM_PATH')

const expected = [9, 8, 7, 7, 7]
const assert = (value, message) => { if (!value) throw new Error(message) }
let lifecycleRace = promise => Promise.resolve(promise)
async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}
async function waitFor(check, label) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const value = await lifecycleRace(check())
    if (value) return value
    await lifecycleRace(delay(25))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

let vite
let browser
let profile
let cdp
let browserLog = ''
let verificationError
let verificationResults
let browserTreeGone = false
const cleanupErrors = []
try {
  vite = await startOwnedVite(fixture)
  profile = mkdtempSync(join(tmpdir(), 'snl-basic-demo-presets-'))
  browser = await spawnOwnedProcess(chrome, [
    '--headless', '--no-sandbox', '--disable-gpu', `--user-data-dir=${profile}`,
    '--remote-debugging-port=0', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  browser.child.stderr.on('data', chunk => { browserLog += chunk })
  lifecycleRace = promise => raceVerifierLifecycle(vite, browser, promise)
  const websocketUrl = await waitFor(async () => browserLog.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1], 'Chromium endpoint')
  const targets = await lifecycleRace(fetch(`http://${new URL(websocketUrl).host}/json/list`).then(response => response.json()))
  cdp = new Cdp(targets[0].webSocketDebuggerUrl)
  const rawSend = cdp.send.bind(cdp)
  cdp.send = (...args) => lifecycleRace(rawSend(...args))
  await lifecycleRace(cdp.ready())
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__presetErrors = [];
    const originalError = console.error.bind(console);
    console.error = (...args) => { window.__presetErrors.push('console.error: ' + args.map(String).join(' ')); originalError(...args); };
    addEventListener('error', event => window.__presetErrors.push('error: ' + event.message));
    addEventListener('unhandledrejection', event => window.__presetErrors.push('unhandledrejection: ' + String(event.reason)));
  ` })
  await cdp.send('Page.navigate', { url: vite.url })
  await waitFor(() => evaluate(cdp, "document.querySelectorAll('.preset').length === 5"), 'five preset buttons')

  const modes = [
    { name: 'desktop', stageWidth: null, hostMin: 600, hostMax: 700 },
    { name: '300px-host', stageWidth: 360, hostMin: 270, hostMax: 300 },
  ]
  const results = []
  for (const mode of modes) {
    await evaluate(cdp, `(() => {
      const stage = document.querySelector('.demo-entry-stage');
      stage.style.width = ${mode.stageWidth === null ? "''" : `'${mode.stageWidth}px'`};
      stage.style.boxSizing = 'border-box';
      return true;
    })()`)
    for (let index = 0; index < expected.length; index += 1) {
      await evaluate(cdp, `document.querySelectorAll('.preset')[${index}].click()`)
      await waitFor(() => evaluate(cdp, `document.querySelectorAll('.snl-svg-template .snl-foreign-box:not(.snl-foreign-box-measure)').length === ${expected[index]}`), `${mode.name} preset ${index} labels`)
      await evaluate(cdp, `(async () => { await document.fonts.ready; await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); return true })()`)
      const metrics = await evaluate(cdp, `(() => {
        const host = document.querySelector('.snl-svg-template');
        const svg = host.querySelector('svg.snl-svg-template-artwork');
        const boxes = [...host.querySelectorAll('.snl-foreign-box:not(.snl-foreign-box-measure)')];
        const hr = host.getBoundingClientRect();
        const stage = document.querySelector('.demo-entry-stage');
        const sr = stage.getBoundingClientRect();
        const rects = boxes.map(box => { const r = box.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height } });
        const overlaps = [];
        for (let i=0;i<rects.length;i++) for (let j=i+1;j<rects.length;j++) {
          const area = Math.max(0, Math.min(rects[i].right,rects[j].right)-Math.max(rects[i].left,rects[j].left)) * Math.max(0, Math.min(rects[i].bottom,rects[j].bottom)-Math.max(rects[i].top,rects[j].top));
          if (area > 1) overlaps.push([i,j,area]);
        }
        const paths = [...svg.querySelectorAll('path')];
        const paintAlpha = (paint) => {
          if (!paint || paint === 'none' || paint === 'transparent') return 0;
          if (paint.startsWith('rgba(')) {
            const channels = paint.slice(5, -1).split(',').map(channel => channel.trim());
            if (channels.length === 4) return Number(channels[3]);
          }
          return 1;
        };
        const visibleStroke = style => paintAlpha(style.stroke) * Number(style.strokeOpacity) * Number(style.opacity) > 0;
        const visibleFill = style => paintAlpha(style.fill) * Number(style.fillOpacity) * Number(style.opacity) > 0;
        const painted = paths.filter(path => {
          const style = getComputedStyle(path);
          return path.getTotalLength() > 0 && (visibleStroke(style) || visibleFill(style));
        });
        const filled = paths.filter(path => visibleFill(getComputedStyle(path)));
        const list = document.querySelector('[role="list"][aria-label="Mathematical diagram presets"]');
        const buttons = [...list.querySelectorAll('[role="listitem"] > button.preset')];
        return {
          hostWidth: hr.width, stageWidth: sr.width, viewportWidth: document.documentElement.clientWidth,
          documentOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          hostContainedByStage: hr.left >= sr.left - 1 && hr.right <= sr.right + 1 && hr.top >= sr.top - 1 && hr.bottom <= sr.bottom + 1,
          stageContainedByViewport: sr.left >= -1 && sr.right <= document.documentElement.clientWidth + 1,
          hostOverflowX: host.scrollWidth-host.clientWidth, hostOverflowY: host.scrollHeight-host.clientHeight,
          outside: rects.map((r,i)=>({i,r})).filter(({r})=>r.left<hr.left-1||r.right>hr.right+1||r.top<hr.top-1||r.bottom>hr.bottom+1),
          overlaps, labels: boxes.length, paths: paths.length, painted: painted.length, filled: filled.length,
          buttons: buttons.length, pressed: buttons.filter(button=>button.getAttribute('aria-pressed')==='true').map(button=>buttons.indexOf(button)),
          errors: window.__presetErrors,
        };
      })()`)
      assert(metrics.hostWidth >= mode.hostMin && metrics.hostWidth <= mode.hostMax, `${mode.name} preset ${index}: host width ${metrics.hostWidth} outside ${mode.hostMin}..${mode.hostMax}`)
      if (mode.stageWidth !== null) assert(Math.abs(metrics.stageWidth - mode.stageWidth) <= 1, `${mode.name} preset ${index}: stage width ${metrics.stageWidth} did not reach ${mode.stageWidth}`)
      assert(metrics.hostContainedByStage && metrics.stageContainedByViewport && metrics.documentOverflowX <= 1, `${mode.name} preset ${index}: host/stage/document containment failed`)
      assert(metrics.labels === expected[index], `${mode.name} preset ${index}: expected ${expected[index]} visible labels, got ${metrics.labels}`)
      assert(metrics.hostOverflowX <= 1 && metrics.hostOverflowY <= 1, `${mode.name} preset ${index}: host overflow ${metrics.hostOverflowX}x${metrics.hostOverflowY}`)
      assert(metrics.outside.length === 0, `${mode.name} preset ${index}: labels outside host ${JSON.stringify(metrics.outside)}`)
      assert(metrics.overlaps.length === 0, `${mode.name} preset ${index}: label overlaps ${JSON.stringify(metrics.overlaps)}`)
      assert(metrics.paths >= 4 && metrics.painted === metrics.paths, `${mode.name} preset ${index}: unpainted artwork ${metrics.painted}/${metrics.paths}`)
      assert(metrics.filled >= 1, `${mode.name} preset ${index}: no explicit filled arrowhead path`)
      assert(metrics.buttons === 5 && metrics.pressed.length === 1 && metrics.pressed[0] === index, `${mode.name} preset ${index}: broken accessible selection ${JSON.stringify(metrics.pressed)}`)
      assert(metrics.errors.length === 0, `${mode.name} preset ${index}: runtime errors ${JSON.stringify(metrics.errors)}`)
      results.push({ mode: mode.name, preset: index, ...metrics })
    }
  }
  verificationResults = results
} catch (error) {
  verificationError = error
} finally {
  try { await cdp?.close() } catch (error) { cleanupErrors.push(new Error('CDP cleanup failed', { cause: error })) }
  if (browser) {
    try { await terminateOwnedProcess(browser); browserTreeGone = true }
    catch (error) { cleanupErrors.push(new Error('Chromium cleanup failed', { cause: error })) }
  }
  if (vite) {
    try { await closeOwnedVite(vite) }
    catch (error) { cleanupErrors.push(new Error('Vite cleanup failed', { cause: error })) }
  }
  if (profile && browserTreeGone) {
    try { rmSync(profile, { recursive: true, force: true }) }
    catch (error) { cleanupErrors.push(new Error('Chromium profile cleanup failed', { cause: error })) }
  }
}
if (verificationError) { console.error(verificationError); console.error(browserLog); process.exitCode = 1 }
if (cleanupErrors.length) { console.error(new AggregateError(cleanupErrors, 'preset verifier cleanup failed')); process.exitCode = 1 }
if (!verificationError && cleanupErrors.length === 0) console.log(`basic-demo presets Chromium PASS ${JSON.stringify(verificationResults)}`)
