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
let viteLog = ''
let browserLog = ''
let verificationResults
let verificationError
let browserTreeGone = false
const cleanupErrors = []
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
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__fixtureErrors = [];
    const originalError = console.error.bind(console);
    console.error = (...args) => { window.__fixtureErrors.push('console.error: ' + args.map(String).join(' ')); originalError(...args); };
    addEventListener('error', event => window.__fixtureErrors.push('error: ' + event.message));
    addEventListener('unhandledrejection', event => window.__fixtureErrors.push('unhandledrejection: ' + String(event.reason)));
  ` })
  const results = []
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
    await waitFor(() => evaluate(cdp, 'Boolean(window.__svgFixture?.ready())'), `${caseLabel} (viewport ${width}px) settled positioned fixture`)
    const before = await evaluate(cdp, `(async () => {
      const svg = document.querySelector('.fixture-frame svg.snl-svg-template-artwork');
      const frame = document.querySelector('.fixture-frame');
      const host = document.querySelector('.fixture-frame .snl-svg-template');
      const labels = [...document.querySelectorAll('.fixture-frame .snl-foreign-box[data-state="positioned"]')];
      const frameRect = frame.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      const rectValue = rect => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height });
      const contained = (inner, outer, tolerance = 1) => inner.left >= outer.left - tolerance
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
            .every(surface => contained(surface.getBoundingClientRect(), hostRect) && contained(surface.getBoundingClientRect(), frameRect))),
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
          frame: { clientWidth: frame.clientWidth, scrollWidth: frame.scrollWidth, rect: rectValue(frameRect) },
          host: { clientWidth: host.clientWidth, scrollWidth: host.scrollWidth, rect: rectValue(hostRect) },
          labelRects,
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
    assert(JSON.stringify(before.transforms) === JSON.stringify(['translate(155 70)', 'translate(500 70)', 'translate(130 310)', 'translate(480 310)']), `${caseLabel} (viewport ${width}px) preserves transformed marker geometry`)
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
    assert(before.accessibleArtwork === 1, `${caseLabel} (viewport ${width}px) exposes exactly one labelled SVG artwork`)
    assert(before.accessibleForeign === 4, `${caseLabel} (viewport ${width}px) exposes exactly four positioned foreign labels`)
    assert(before.geometry.frame.scrollWidth <= before.geometry.frame.clientWidth + 1, `${caseLabel} (viewport ${width}px) fixture frame has no internal horizontal overflow`)
    assert(before.geometry.host.scrollWidth <= before.geometry.host.clientWidth + 1, `${caseLabel} (viewport ${width}px) SVG host has no internal horizontal overflow`)
    if (testCase.narrowSidebar) {
      assert(before.geometry.host.clientWidth >= 275 && before.geometry.host.clientWidth <= 305,
        `${caseLabel} uses an approximately 300px sidebar host (received ${before.geometry.host.clientWidth}px)`)
      const rightLabel = before.geometry.labelRects[1]
      assert(rightLabel.height >= 40, `${caseLabel} right-side long label wraps to multiple lines`)
      assert(rightLabel.width <= before.geometry.host.clientWidth * 0.205,
        `${caseLabel} right-side slot stays within 20% of its host (received ${rightLabel.width}px)`)
    }
    assert(before.geometry.labelsContainedInFrame && before.geometry.labelsContainedInHost, `${caseLabel} (viewport ${width}px) every positioned label is contained in frame and SVG host: ${JSON.stringify(before.geometry)}`)
    assert(before.geometry.maxPairOverlap <= 1, `${caseLabel} (viewport ${width}px) positioned labels do not intersect: ${JSON.stringify(before.geometry)}`)
    assert(before.geometry.labelEdgeCrossings.length === 0, `${caseLabel} (viewport ${width}px) labels do not cross painted edge corridors: ${JSON.stringify(before.geometry.labelEdgeCrossings)}`)
    assert(before.geometry.clippedLabels === 0, `${caseLabel} (viewport ${width}px) positioned labels are not clipped: ${JSON.stringify(before.geometry)}`)
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
    await evaluate(cdp, 'window.__svgFixture.toggle()')
    await waitFor(() => evaluate(cdp, 'document.querySelector(".fixture-frame svg")?.getAttribute("aria-label") === "Updated commutative square projection"'), `${caseLabel} (viewport ${width}px) projection update`)
    const identity = await evaluate(cdp, `(() => {
      const afterChildren = [...document.querySelectorAll('.fixture-frame .snl-foreign-box-measure > *')];
      return {
        svg: window.__svgBefore === document.querySelector('svg.snl-svg-template-artwork'),
        children: afterChildren.length === window.__svgBeforeChildren.length && afterChildren.every((node, index) => node === window.__svgBeforeChildren[index]),
        ready: window.__svgFixture.ready(),
        errors: window.__fixtureErrors || []
      };
    })()` )
    assert(identity.svg, `${caseLabel} (viewport ${width}px) projection update preserves SVG DOM identity`)
    assert(identity.children, `${caseLabel} (viewport ${width}px) projection update preserves every child DOM identity`)
    assert(identity.ready, `${caseLabel} (viewport ${width}px) projection update keeps all children positioned`)
    assert(identity.errors.length === 0, `${caseLabel} (viewport ${width}px) update has no console/runtime errors: ${identity.errors.join(' | ')}`)
    const screenshot = join(artifactDir, `parameterized-svg-${caseLabel}.png`)
    const capture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    writeFileSync(screenshot, Buffer.from(capture.data, 'base64'))
    results.push({
      case: caseLabel,
      width,
      markers: before.markerCount,
      positioned: before.positioned,
      hiddenFallbacks: before.foreignFallbacks.filter(fallback => fallback.hidden && fallback.display === 'none' && fallback.textRects === 0).length,
      dynamicFallbackVisible: before.fallbackProbe.visibleRects > 0,
      pageOverflow: Math.max(0, before.pageWidth - before.viewport),
      frameClientWidth: before.geometry.frame.clientWidth,
      frameScrollWidth: before.geometry.frame.scrollWidth,
      hostClientWidth: before.geometry.host.clientWidth,
      hostScrollWidth: before.geometry.host.scrollWidth,
      maxPairOverlap: before.geometry.maxPairOverlap,
      labelEdgeCrossings: before.geometry.labelEdgeCrossings.length,
      clippedLabels: before.geometry.clippedLabels,
      labelWidths: before.geometry.slotWidths.map(slot => slot.width),
      rasterCorridors: before.rasterCorridors,
      accessible: before.accessibleForeign,
      svgPreserved: identity.svg,
      childrenPreserved: identity.children,
      screenshot,
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
  console.error(viteLog)
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
