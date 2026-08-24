import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnOwnedProcess, terminateOwnedProcess } from './process-group-cleanup.mjs'
import { Cdp } from './cdp-client.mjs'
import { closeOwnedVite, raceVerifierLifecycle, startOwnedVite } from './verifier-infrastructure.mjs'
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

let lifecycleRace = promise => Promise.resolve(promise)

async function waitFor(check, label) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
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
  profile = mkdtempSync(join(tmpdir(), 'snl-svg-template-chrome-'))
  browser = await spawnOwnedProcess(chrome, ['--headless', '--no-sandbox', '--disable-gpu', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
  browser.child.stderr.on('data', (chunk) => { browserLog += chunk })
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
  let fixedCanvasLabelWidths
  const cases = [
    { name: '390', viewportWidth: 390, path: '/' },
    { name: '1000-wide', viewportWidth: 1000, path: '/' },
    { name: '1000-narrow-sidebar', viewportWidth: 1000, path: '/?narrow-sidebar=1', narrowSidebar: true },
  ]
  for (const testCase of cases) {
    const width = testCase.viewportWidth
    const caseLabel = testCase.name
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 760, deviceScaleFactor: 1, mobile: false })
    await cdp.send('Page.navigate', { url: new URL(testCase.path, vite.url).href })
    await waitFor(() => evaluate(cdp, 'Boolean(window.__svgFixture?.ready())'), `${caseLabel} (viewport ${width}px) positioned fixture`)
    await evaluate(cdp, 'document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))')
    const fontProof = await evaluate(cdp, `(() => {
      const label = document.querySelector('.fixture-frame .snl-text');
      const math = document.querySelector('.fixture-frame .katex .mathnormal');
      const firstFamily = element => getComputedStyle(element).fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
      const loadedFaces = [...document.fonts].filter(face => face.status === 'loaded').map(face => ({ family: face.family.replace(/^['"]|['"]$/g, ''), style: face.style, weight: face.weight }));
      return {
        mainCheck: document.fonts.check('16px KaTeX_Main'),
        mathCheck: document.fonts.check('italic 16px KaTeX_Math'),
        labelFamily: getComputedStyle(label).fontFamily,
        labelFirstFamily: firstFamily(label),
        mathFamily: getComputedStyle(math).fontFamily,
        mathFirstFamily: firstFamily(math),
        loadedFaces,
      };
    })()`)
    assert(fontProof.mainCheck && fontProof.mathCheck, `${caseLabel} exact KaTeX font checks failed: ${JSON.stringify(fontProof)}`)
    assert(fontProof.labelFirstFamily === 'KaTeX_Main', `${caseLabel} label first available face is not KaTeX_Main: ${fontProof.labelFamily}`)
    assert(fontProof.mathFirstFamily === 'KaTeX_Math', `${caseLabel} formula first available face is not KaTeX_Math: ${fontProof.mathFamily}`)
    assert(fontProof.loadedFaces.some(face => face.family === 'KaTeX_Main' && face.style === 'normal'), `${caseLabel} KaTeX_Main regular face was not loaded`)
    assert(fontProof.loadedFaces.some(face => face.family === 'KaTeX_Math' && face.style === 'italic'), `${caseLabel} KaTeX_Math italic face was not loaded`)
    assert(networkFailures.length === 0, `${caseLabel} fixture network failures: ${networkFailures.join(' | ')}`)
    assert(fontRequests.some(request => /KaTeX_Main-Regular\.woff2(?:$|\?)/.test(request.url) && request.status === 200), `${caseLabel} did not fetch KaTeX_Main-Regular.woff2 successfully: ${JSON.stringify(fontRequests)}`)
    assert(fontRequests.some(request => /KaTeX_Math-Italic\.woff2(?:$|\?)/.test(request.url) && request.status === 200), `${caseLabel} did not fetch KaTeX_Math-Italic.woff2 successfully: ${JSON.stringify(fontRequests)}`)
    assert(vite.viteMessages.length === 0, `${caseLabel} unexpected Vite diagnostics: ${JSON.stringify(vite.viteMessages)}`)
    await waitFor(() => evaluate(cdp, 'Boolean(window.__svgFixture?.ready())'), `${caseLabel} (viewport ${width}px) settled positioned fixture`)
    const before = await evaluate(cdp, `(async () => {
      const svg = document.querySelector('.fixture-frame svg.snl-svg-template-artwork');
      const frame = document.querySelector('.fixture-frame');
      const panel = document.querySelector('.fixture-frame .katex-panel');
      const host = document.querySelector('.fixture-frame .snl-svg-template');
      const labels = [...document.querySelectorAll('.fixture-frame .snl-foreign-box[data-state="positioned"]')];
      const markers = [...svg.querySelectorAll('g[data-snl-slot]')];
      const frameRect = frame.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      const rectValue = rect => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height });
      const center = rect => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      const contained = (inner, outer, tolerance = 2) => inner.left >= outer.left - tolerance
        && inner.top >= outer.top - tolerance && inner.right <= outer.right + tolerance && inner.bottom <= outer.bottom + tolerance;
      const overlapArea = (left, right) => Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left))
        * Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
      const edgePaint = [...svg.querySelectorAll('path.snl-svg-edge')].map(path => {
        const style = getComputedStyle(path);
        const directStroke = path.getAttribute('stroke') || '';
        return {
          directStroke,
          stroke: style.stroke,
          width: Number.parseFloat(style.strokeWidth),
          opacity: Number.parseFloat(style.opacity) * Number.parseFloat(style.strokeOpacity),
          length: path.getTotalLength(),
        };
      });
      const arrowPaint = [...svg.querySelectorAll('path.snl-svg-arrowhead')].map(path => {
        const style = getComputedStyle(path);
        return {
          fill: style.fill,
          opacity: Number.parseFloat(style.opacity) * Number.parseFloat(style.fillOpacity),
          length: path.getTotalLength(),
        };
      });
      const rasterCorridors = await new Promise((resolve, reject) => {
        const clone = svg.cloneNode(true);
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clone.setAttribute('width', '640');
        clone.setAttribute('height', '360');
        const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const image = new Image();
        image.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = 640; canvas.height = 360;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            context.drawImage(image, 0, 0, 640, 360);
            const pixels = context.getImageData(0, 0, 640, 360).data;
            const count = (x0, y0, x1, y1) => {
              let painted = 0;
              for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
                if (pixels[(y * 640 + x) * 4 + 3] > 0) painted += 1;
              }
              return painted;
            };
            resolve([
              count(295, 73, 465, 87), count(145, 293, 465, 307),
              count(123, 205, 137, 290), count(473, 100, 487, 290),
            ]);
          } catch (error) { reject(error); } finally { URL.revokeObjectURL(url); }
        };
        image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('serialized SVG rasterization failed')); };
        image.src = url;
      });
      window.__svgBefore = svg;
      window.__svgBeforeChildren = [...document.querySelectorAll('.fixture-frame .snl-foreign-box-measure > *')];
      const labelRects = labels.map(label => rectValue(label.getBoundingClientRect()));
      const markerRects = markers.map(marker => rectValue(marker.getBoundingClientRect()));
      const centerDeltas = labelRects.map((label, index) => {
        const labelCenter = center(label);
        const markerCenter = center(markerRects[index]);
        return { x: labelCenter.x - markerCenter.x, y: labelCenter.y - markerCenter.y };
      });
      // This fixture's four straight arrows deliberately terminate outside the
      // endpoint labels. Treat each painted stroke/arrowhead as a protected
      // corridor rather than exempting endpoint labels from collision checks.
      const paintedCorridors = [
        ...[...svg.querySelectorAll('path.snl-svg-edge')].map((path, index) => {
          const style = getComputedStyle(path);
          const padding = Number.parseFloat(style.strokeWidth) / 2 + 2;
          const rect = path.getBoundingClientRect();
          return { kind: 'edge', index, left: rect.left - padding, top: rect.top - padding,
            right: rect.right + padding, bottom: rect.bottom + padding };
        }),
        ...[...svg.querySelectorAll('path.snl-svg-arrowhead')].map((path, index) => {
          const rect = path.getBoundingClientRect();
          return { kind: 'arrowhead', index, left: rect.left - 1, top: rect.top - 1,
            right: rect.right + 1, bottom: rect.bottom + 1 };
        }),
      ];
      const labelEdgeCrossings = labelRects.flatMap((label, labelIndex) => paintedCorridors
        .filter(corridor => Math.min(label.right, corridor.right) > Math.max(label.left, corridor.left)
          && Math.min(label.bottom, corridor.bottom) > Math.max(label.top, corridor.top))
        .map(corridor => ({ labelIndex, corridorKind: corridor.kind, corridorIndex: corridor.index })));
      const labelClipping = labels.map(label => {
        const content = label.querySelector('.snl-svg-template-slot-content');
        return {
          labelClientWidth: label.clientWidth, labelScrollWidth: label.scrollWidth,
          labelClientHeight: label.clientHeight, labelScrollHeight: label.scrollHeight,
          contentClientWidth: content?.clientWidth ?? -1, contentScrollWidth: content?.scrollWidth ?? -1,
          contentClientHeight: content?.clientHeight ?? -1, contentScrollHeight: content?.scrollHeight ?? -1,
          contentOverflowX: content ? getComputedStyle(content).overflowX : 'missing',
          contentOverflowY: content ? getComputedStyle(content).overflowY : 'missing',
          contentContained: Boolean(content && contained(content.getBoundingClientRect(), label.getBoundingClientRect())),
          visibleSurfaceContained: Boolean(content && [...content.querySelectorAll('.katex-html, .snl-text')]
            .every(surface => contained(surface.getBoundingClientRect(), hostRect))),
        };
      });
      return {
        markerCount: svg?.querySelectorAll('g[data-snl-slot]').length,
        transforms: [...svg.querySelectorAll('g[data-snl-slot]')].map(x => x.getAttribute('transform')),
        edgePaint,
        arrowPaint,
        rasterCorridors,
        positioned: labels.length,
        accessibleArtwork: document.querySelectorAll('.fixture-frame svg[role="img"][aria-label]').length,
        accessibleForeign: document.querySelectorAll('.fixture-frame .snl-foreign-box[data-state="positioned"][aria-hidden="false"]:not([inert])').length,
        geometry: {
          frame: { clientWidth: frame.clientWidth, scrollWidth: frame.scrollWidth, clientHeight: frame.clientHeight, scrollHeight: frame.scrollHeight, rect: rectValue(frameRect) },
          panel: { clientWidth: panel.clientWidth, scrollWidth: panel.scrollWidth, clientHeight: panel.clientHeight, scrollHeight: panel.scrollHeight, overflowX: getComputedStyle(panel).overflowX },
          host: { clientWidth: host.clientWidth, scrollWidth: host.scrollWidth, clientHeight: host.clientHeight, scrollHeight: host.scrollHeight, overflowX: getComputedStyle(host).overflowX, overflowY: getComputedStyle(host).overflowY, rect: rectValue(hostRect) },
          artworkViewBox: { width: svg.viewBox.baseVal.width, height: svg.viewBox.baseVal.height },
          labelRects,
          markerRects,
          centerDeltas,
          ancestorScale: frameRect.width / frame.offsetWidth,
          labelsContainedInFrame: labelRects.every(rect => contained(rect, frameRect)),
          labelsContainedInHost: labelRects.every(rect => contained(rect, hostRect)),
          maxPairOverlap: labelRects.reduce((maximum, left, index) => Math.max(maximum,
            ...labelRects.slice(index + 1).map(right => overlapArea(left, right)), 0), 0),
          labelEdgeCrossings,
          clippedLabels: labelClipping.filter(item => item.labelScrollWidth > item.labelClientWidth + 1
            || item.contentScrollWidth > item.contentClientWidth + 1
            || ((item.contentOverflowY === 'hidden' || item.contentOverflowY === 'clip') && item.contentScrollHeight > item.contentClientHeight + 1)
            || !item.contentContained || !item.visibleSurfaceContained).length,
          labelClipping,
          slotWidths: labels.map(label => {
            const content = label.querySelector('.snl-svg-template-slot-content');
            return { width: content.getBoundingClientRect().width, scrollWidth: content.scrollWidth, clientWidth: content.clientWidth };
          }),
        },
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
    assert(before.markerCount === 4, `${caseLabel} (viewport ${width}px) has four real g markers`)
    assert(JSON.stringify(before.transforms) === JSON.stringify(['translate(200 85)', 'translate(570 85)', 'translate(130 340)', 'translate(520 330)']), `${caseLabel} (viewport ${width}px) preserves transformed marker geometry`)
    assert(before.edgePaint.length === 4, `${caseLabel} (viewport ${width}px) has four directed edge paths`)
    before.edgePaint.forEach((edge, index) => {
      assert(edge.directStroke && edge.directStroke !== 'none' && !edge.directStroke.startsWith('url('), `${caseLabel} (viewport ${width}px) edge ${index} has a direct non-URL stroke`)
      assert(edge.stroke && edge.stroke !== 'none' && edge.stroke !== 'transparent', `${caseLabel} (viewport ${width}px) edge ${index} has computed paint`)
      assert(edge.width > 0 && edge.opacity > 0 && edge.length > 0, `${caseLabel} (viewport ${width}px) edge ${index} has positive width, opacity, and length`)
    })
    assert(before.arrowPaint.length === 4, `${caseLabel} (viewport ${width}px) has four explicit arrowhead paths`)
    before.arrowPaint.forEach((arrow, index) => {
      assert(arrow.fill && arrow.fill !== 'none' && arrow.fill !== 'transparent', `${caseLabel} (viewport ${width}px) arrowhead ${index} has computed fill`)
      assert(arrow.opacity > 0 && arrow.length > 0, `${caseLabel} (viewport ${width}px) arrowhead ${index} has positive opacity and geometry`)
    })
    assert(before.rasterCorridors.every(pixels => pixels > 180), `${caseLabel} (viewport ${width}px) edge corridors contain rasterized artwork: ${before.rasterCorridors.join(',')}`)
    assert(before.positioned === 4, `${caseLabel} (viewport ${width}px) positions every foreign label`)
    assert(Math.abs(before.geometry.ancestorScale - 0.9) <= 0.01, `${caseLabel} (viewport ${width}px) exercises an effective common-ancestor transform: ${before.geometry.ancestorScale}`)
    assert(before.geometry.centerDeltas.every(delta => Math.abs(delta.x) <= 0.75 && Math.abs(delta.y) <= 0.75),
      `${caseLabel} (viewport ${width}px) aligns every non-square SNL child center to its SVG slot center: ${JSON.stringify(before.geometry.centerDeltas)}`)
    assert(before.accessibleArtwork === 1, `${caseLabel} (viewport ${width}px) exposes exactly one labelled SVG artwork`)
    assert(before.accessibleForeign === 4, `${caseLabel} (viewport ${width}px) exposes exactly four positioned foreign labels`)
    assert(before.geometry.host.clientWidth === 680, `${caseLabel} (viewport ${width}px) keeps the renderer-owned 680px intrinsic canvas (received ${before.geometry.host.clientWidth}px)`)
    const expectedCanvasHeight = 680 * before.geometry.artworkViewBox.height / before.geometry.artworkViewBox.width
    assert(Math.abs(before.geometry.host.clientHeight - expectedCanvasHeight) <= 1,
      `${caseLabel} (viewport ${width}px) derives the intrinsic canvas height from the artwork viewBox (received ${before.geometry.host.clientHeight}px, expected ${expectedCanvasHeight}px)`)
    if (before.geometry.panel.clientWidth < before.geometry.host.clientWidth) {
      assert(before.geometry.panel.overflowX === 'auto' && before.geometry.panel.scrollWidth > before.geometry.panel.clientWidth + 1,
        `${caseLabel} (viewport ${width}px) narrow KaTeX panel owns horizontal scrolling for the transformed fixed canvas: ${JSON.stringify({ panel: before.geometry.panel, host: before.geometry.host })}`)
    } else {
      assert(before.geometry.panel.scrollWidth <= before.geometry.panel.clientWidth + 1,
        `${caseLabel} (viewport ${width}px) desktop KaTeX panel does not scroll unnecessarily`)
    }
    assert(before.geometry.host.overflowX === 'visible' && before.geometry.host.overflowY === 'visible',
      `${caseLabel} (viewport ${width}px) SVG host does not become an internal scroll owner: ${JSON.stringify(before.geometry.host)}`)
    assert(before.geometry.frame.scrollHeight <= before.geometry.frame.clientHeight + 1, `${caseLabel} (viewport ${width}px) fixture frame has no internal vertical overflow (${before.geometry.frame.clientHeight}/${before.geometry.frame.scrollHeight})`)
    assert(before.geometry.host.scrollHeight <= before.geometry.host.clientHeight + 1, `${caseLabel} (viewport ${width}px) SVG host has no internal vertical overflow (${before.geometry.host.clientHeight}/${before.geometry.host.scrollHeight})`)
    if (testCase.narrowSidebar) {
      assert(before.geometry.frame.clientWidth >= 295 && before.geometry.frame.clientWidth <= 330,
        `${caseLabel} uses an approximately 300px sidebar frame (received ${before.geometry.frame.clientWidth}px)`)
    }
    assert(before.geometry.labelsContainedInHost, `${caseLabel} (viewport ${width}px) every positioned label is contained in the fixed SVG host: ${JSON.stringify(before.geometry)}`)
    assert(before.geometry.maxPairOverlap <= 1, `${caseLabel} (viewport ${width}px) positioned labels do not intersect: ${JSON.stringify(before.geometry)}`)
    assert(before.geometry.labelEdgeCrossings.length === 0, `${caseLabel} (viewport ${width}px) labels do not cross painted edge corridors: ${JSON.stringify(before.geometry.labelEdgeCrossings)}`)
    assert(before.geometry.clippedLabels === 0, `${caseLabel} (viewport ${width}px) positioned labels are not clipped: ${JSON.stringify(before.geometry)}`)
    const currentLabelWidths = before.geometry.slotWidths.map(slot => slot.width)
    if (!fixedCanvasLabelWidths) fixedCanvasLabelWidths = currentLabelWidths
    else assert(currentLabelWidths.every((value, index) => Math.abs(value - fixedCanvasLabelWidths[index]) <= 0.75),
      `${caseLabel} (viewport ${width}px) fixed-canvas labels do not squeeze across hosts: ${JSON.stringify({ fixedCanvasLabelWidths, currentLabelWidths })}`)
    assert(before.foreignFallbacks.length === 4, `${caseLabel} (viewport ${width}px) retains four stable main-fixture fallback boundaries`)
    before.foreignFallbacks.forEach((fallback, index) => {
      assert(fallback.hidden, `${caseLabel} (viewport ${width}px) fallback ${index} has the hidden gate after positioning`)
      assert(fallback.display === 'none', `${caseLabel} (viewport ${width}px) fallback ${index} computes display:none (received ${fallback.display})`)
      assert(fallback.clientRects === 0, `${caseLabel} (viewport ${width}px) fallback ${index} has no boundary client rects`)
      assert(fallback.textRects === 0, `${caseLabel} (viewport ${width}px) fallback ${index} text has no visible normal-flow geometry`)
      assert(fallback.text && fallback.text === fallback.liveText, `${caseLabel} (viewport ${width}px) fallback ${index} is associated with its positioned wrapper`)
      assert(fallback.liveTextRects > 0, `${caseLabel} (viewport ${width}px) positioned wrapper ${index} remains visibly rendered`)
    })
    assert(before.fallbackProbe.text.includes('fixed arity'), `${caseLabel} (viewport ${width}px) exposes deterministic fixed-arity fallback`)
    assert(before.fallbackProbe.display !== 'none' && before.fallbackProbe.visibleRects > 0 && !before.fallbackProbe.hidden, `${caseLabel} (viewport ${width}px) keeps the intentional dynamic-arity fallback visibly rendered`)
    assert(before.errors.length === 0, `${caseLabel} (viewport ${width}px) has no console/runtime errors: ${before.errors.join(' | ')}`)
    assert(!before.alert, `${caseLabel} (viewport ${width}px) has no visible fallback: ${before.alert}`)
    assert(before.pageWidth <= before.viewport, `${caseLabel} (viewport ${width}px) fixture has no page overflow`)
    const sparseBlock = await evaluate(cdp, `(() => {
      const host = document.querySelector('.sparse-block-fixture');
      if (!host) return { found: false };
      const markers = [...host.querySelectorAll('g[data-snl-slot]')];
      const boxes = [...host.querySelectorAll('.snl-foreign-box[data-state="positioned"]')];
      const blockCopies = [...host.querySelectorAll('.snl-foreign-box-measure [data-name="blockLabel"]')];
      const wrapperPaths = boxes.map(box => box.getAttribute('data-tree-path'));
      const wrapperPlacements = boxes.map(box => box.getAttribute('data-snl-foreign-placement'));
      const markerCenters = markers.map(marker => { const r = marker.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      const boxCenters = boxes.map(box => { const r = box.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      return {
        found: true,
        slots: markers.map(marker => Number(marker.getAttribute('data-snl-slot'))),
        positioned: boxes.length,
        blockCopies: blockCopies.length,
        blockPaths: blockCopies.map(block => block.getAttribute('data-tree-path')),
        wrapperPaths,
        wrapperPlacements,
        missingLabels: host.querySelectorAll('.snl-foreign-box-measure [data-name="labelB"], .snl-foreign-box-measure [data-name="labelD"]').length,
        centerDeltas: markerCenters.map((marker, index) => ({ x: boxCenters[index]?.x - marker.x, y: boxCenters[index]?.y - marker.y })),
      };
    })()`)
    assert(sparseBlock.found, `${caseLabel} exercises a sparse/repeated block-slot fixture`)
    assert(JSON.stringify(sparseBlock.slots) === '[2,0,2]', `${caseLabel} preserves sparse/repeated SVG slot document order: ${JSON.stringify(sparseBlock)}`)
    assert(sparseBlock.positioned === 3 && sparseBlock.blockCopies === 2 && sparseBlock.missingLabels === 0,
      `${caseLabel} renders repeated block children while omitting unreferenced children: ${JSON.stringify(sparseBlock)}`)
    assert(new Set(sparseBlock.blockPaths).size === 1 && sparseBlock.blockPaths[0],
      `${caseLabel} keeps repeated children on one semantic child tree path: ${JSON.stringify(sparseBlock)}`)
    assert(sparseBlock.wrapperPaths.length === 3
      && sparseBlock.wrapperPaths[0] === sparseBlock.wrapperPaths[2]
      && sparseBlock.wrapperPaths[0] !== sparseBlock.wrapperPaths[1]
      && sparseBlock.wrapperPaths.every(path => typeof path === 'string' && !path.includes('@svg-slot-')),
      `${caseLabel} publishes canonical semantic paths on repeated foreign wrappers: ${JSON.stringify(sparseBlock)}`)
    assert(JSON.stringify(sparseBlock.wrapperPlacements) === JSON.stringify(['svg-slot:0', 'svg-slot:1', 'svg-slot:2']),
      `${caseLabel} publishes independent placement identities for repeated wrappers: ${JSON.stringify(sparseBlock)}`)
    assert(sparseBlock.centerDeltas.every(delta => Math.abs(delta.x) <= 0.75 && Math.abs(delta.y) <= 0.75),
      `${caseLabel} centers every sparse/repeated block placement: ${JSON.stringify(sparseBlock)}`)

    const depthProbe = await evaluate(cdp, `(() => {
      const marker = document.querySelector('[data-depth-center-marker]');
      const label = document.querySelector('.depth-center-probe .snl-foreign-box[data-state="positioned"]');
      if (!marker || !label) return { found: false };
      const markerRect = marker.getBoundingClientRect();
      const labelRect = label.getBoundingClientRect();
      return {
        found: true,
        depth: Number.parseFloat(label.style.getPropertyValue('--snl-foreign-box-depth')),
        x: labelRect.left + labelRect.width / 2 - markerRect.left - markerRect.width / 2,
        y: labelRect.top + labelRect.height / 2 - markerRect.top - markerRect.height / 2,
      };
    })()`)
    assert(depthProbe.found && depthProbe.depth > 0, `${caseLabel} (viewport ${width}px) exercises a center-aligned browser surface with nonzero depth: ${JSON.stringify(depthProbe)}`)
    assert(Math.abs(depthProbe.x) <= 0.75 && Math.abs(depthProbe.y) <= 0.75,
      `${caseLabel} (viewport ${width}px) centers the total height including nonzero depth: ${JSON.stringify(depthProbe)}`)
    await evaluate(cdp, 'window.__svgFixture.toggle()')
    await waitFor(() => evaluate(cdp, 'document.querySelector(".fixture-frame svg")?.getAttribute("aria-label") === "Updated commutative square projection"'), `${caseLabel} (viewport ${width}px) projection update`)
    await waitFor(() => evaluate(cdp, `(() => {
      const markers = [...document.querySelectorAll('.fixture-frame g[data-snl-slot]')];
      const labels = [...document.querySelectorAll('.fixture-frame .snl-foreign-box[data-state="positioned"]')];
      return labels.length === markers.length && labels[2].getBoundingClientRect().width > 25
        && labels.every((label, index) => {
          const child = label.getBoundingClientRect(); const marker = markers[index].getBoundingClientRect();
          return Math.abs(child.left + child.width / 2 - marker.left - marker.width / 2) <= 0.75
            && Math.abs(child.top + child.height / 2 - marker.top - marker.height / 2) <= 0.75;
        });
    })()`), `${caseLabel} (viewport ${width}px) centered dynamic measurement update`)
    const identity = await evaluate(cdp, `(() => {
      const afterChildren = [...document.querySelectorAll('.fixture-frame .snl-foreign-box-measure > *')];
      const markers = [...document.querySelectorAll('.fixture-frame g[data-snl-slot]')];
      const labels = [...document.querySelectorAll('.fixture-frame .snl-foreign-box[data-state="positioned"]')];
      return {
        svg: window.__svgBefore === document.querySelector('svg.snl-svg-template-artwork'),
        children: afterChildren.length === window.__svgBeforeChildren.length && afterChildren.every((node, index) => node === window.__svgBeforeChildren[index]),
        widths: labels.map(label => label.getBoundingClientRect().width),
        centerDeltas: labels.map((label, index) => {
          const child = label.getBoundingClientRect(); const marker = markers[index].getBoundingClientRect();
          return { x: child.left + child.width / 2 - marker.left - marker.width / 2,
            y: child.top + child.height / 2 - marker.top - marker.height / 2 };
        }),
        ready: window.__svgFixture.ready(),
        errors: window.__fixtureErrors || []
      };
    })()` )
    assert(identity.svg, `${caseLabel} (viewport ${width}px) projection update preserves SVG DOM identity`)
    assert(identity.children, `${caseLabel} (viewport ${width}px) projection update preserves every child DOM identity`)
    assert(identity.widths[2] >= before.geometry.labelRects[2].width + 20,
      `${caseLabel} (viewport ${width}px) dynamic child measurement changes painted width: ${before.geometry.labelRects[2].width} -> ${identity.widths[2]}`)
    assert(identity.centerDeltas.every(delta => Math.abs(delta.x) <= 0.75 && Math.abs(delta.y) <= 0.75),
      `${caseLabel} (viewport ${width}px) keeps updated child centers on SVG slot centers: ${JSON.stringify(identity.centerDeltas)}`)
    assert(identity.ready, `${caseLabel} (viewport ${width}px) projection update keeps all children positioned`)
    assert(identity.errors.length === 0, `${caseLabel} (viewport ${width}px) update has no console/runtime errors: ${identity.errors.join(' | ')}`)
    const screenshot = join(artifactDir, `parameterized-svg-${caseLabel}.png`)
    const capture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    writeFileSync(screenshot, Buffer.from(capture.data, 'base64'))
    const domSnapshot = join(artifactDir, `parameterized-svg-${caseLabel}.html`)
    writeFileSync(domSnapshot, await evaluate(cdp, 'document.documentElement.outerHTML'))
    results.push({
      case: caseLabel,
      width,
      markers: before.markerCount,
      positioned: before.positioned,
      nonzeroDepth: depthProbe.depth,
      depthCenterDelta: { x: depthProbe.x, y: depthProbe.y },
      hiddenFallbacks: before.foreignFallbacks.filter(fallback => fallback.hidden && fallback.display === 'none' && fallback.textRects === 0).length,
      dynamicFallbackVisible: before.fallbackProbe.visibleRects > 0,
      pageOverflow: Math.max(0, before.pageWidth - before.viewport),
      frameClientWidth: before.geometry.frame.clientWidth,
      frameScrollWidth: before.geometry.frame.scrollWidth,
      frameClientHeight: before.geometry.frame.clientHeight,
      frameScrollHeight: before.geometry.frame.scrollHeight,
      hostClientWidth: before.geometry.host.clientWidth,
      hostScrollWidth: before.geometry.host.scrollWidth,
      hostClientHeight: before.geometry.host.clientHeight,
      hostScrollHeight: before.geometry.host.scrollHeight,
      maxPairOverlap: before.geometry.maxPairOverlap,
      labelEdgeCrossings: before.geometry.labelEdgeCrossings.length,
      clippedLabels: before.geometry.clippedLabels,
      labelWidths: before.geometry.slotWidths.map(slot => slot.width),
      rasterCorridors: before.rasterCorridors,
      accessible: before.accessibleForeign,
      svgPreserved: identity.svg,
      childrenPreserved: identity.children,
      fontProof,
      fontRequests: fontRequests.map(({ url, status }) => ({ url, status })),
      viteMessages: [...vite.viteMessages],
      networkFailures: [...networkFailures],
      screenshot,
      domSnapshot,
    })
  }
  verificationResults = results
} catch (error) {
  verificationError = error
} finally {
  try { await cdp?.close() } catch (error) {
    cleanupErrors.push(new Error('CDP cleanup failed', { cause: error }))
  }

  browserTreeGone = !browser && verificationError?.cleanupIncomplete !== true
  if (!browser && verificationError?.cleanupIncomplete === true) {
    cleanupErrors.push(new Error('Chromium profile retained because startup cleanup could not be verified'))
  }
  if (browser) {
    try {
      await terminateOwnedProcess(browser)
      browserTreeGone = true
    } catch (error) {
      cleanupErrors.push(new Error(`Chromium process-group cleanup failed for ${browser.groupId}`, { cause: error }))
    }
  }
  if (vite) {
    try { await closeOwnedVite(vite) } catch (error) {
      cleanupErrors.push(new Error(`Vite server cleanup failed for port ${vite.port}`, { cause: error }))
    }
  }

  if (profile && browserTreeGone) {
    try { rmSync(profile, { recursive: true, force: true }) } catch (error) {
      cleanupErrors.push(new Error(`Chromium profile cleanup failed: ${profile}`, { cause: error }))
    }
  }
}

if (verificationError) {
  console.error(verificationError)
  if (vite?.viteMessages?.length) console.error(JSON.stringify(vite.viteMessages))
  console.error(browserLog)
  process.exitCode = 1
}
if (cleanupErrors.length > 0) {
  console.error(new AggregateError(cleanupErrors, 'parameterized-svg infrastructure cleanup failed'))
  process.exitCode = 1
}
if (!verificationError && cleanupErrors.length === 0) {
  console.log(`parameterized-svg Chromium PASS ${JSON.stringify(verificationResults)} owned-infrastructure ${JSON.stringify({ vitePort: vite.port, vitePortClosed: vite.closed === true, chromiumGroup: browser.groupId, chromiumAnchor: browser.anchor, chromiumGroupDead: browserTreeGone, profile, profileRemoved: profile ? !existsSync(profile) : true })}`)
}
