import React from 'react'
import { createRoot } from 'react-dom/client'
import { SnlSyntaxTreeView } from '../../src/components/SnlSyntaxTreeView'
import { createSnlSyntaxTreeNode } from '../../src/snl-syntax-tree/types'
import { MacroDataDriver } from '../../src/snl-macro/macro-data-driver'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import '../../src/snl-react-view/style.css'
import { applySnlHoverHighlight, clearSnlHoverHighlight } from '../../src/snl-react-view/hover-apply'
import {
  findDeepestHoverRootFromStack,
  findMinimalHoverRoot,
  measureSemanticHighlightRect,
} from '../../src/snl-react-view/hover-dom'

const app = document.getElementById('app') as HTMLElement
const result = document.getElementById('result') as HTMLElement
Object.assign(document.documentElement.style, {
  position: 'relative',
  border: '13px solid transparent',
  padding: '7px',
})
Object.assign(document.body.style, { margin: '40px', fontSize: '28px', minHeight: '1200px' })
app.className = 'katex-html'
Object.assign(app.style, { transform: 'translate(80px, 40px) rotate(30deg) scale(1.25)', transformOrigin: '0 0' })
app.innerHTML = katex.renderToString(String.raw`
  \htmlData{name=parent,kind=const,tree-path=}{
    \frac{
      \htmlData{name=top,kind=const,tree-path=0}{\sum_{i=0}^{n} i}
    }{
      \htmlData{name=bottom,kind=const,tree-path=1}{\frac{a}{b}}
    }
  }
`, { throwOnError: true, trust: true, output: 'html' })

// Retain a checked surface for manual screenshots; automated runs always clean up.
const inspect = new URLSearchParams(location.search).get('inspect')
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 100))
const visibleRects = (element: Element) => [...element.getClientRects()].filter((r) => r.width > 0 && r.height > 0)
const paintedRects = () => [...document.querySelectorAll<HTMLElement>('[data-snl-highlight-overlay]')].map((e) => e.getBoundingClientRect())
const contains = (outer: DOMRect, inner: DOMRect) => outer.left <= inner.left + 0.75 && outer.right >= inner.right - 0.75 &&
  outer.top <= inner.top + 0.75 && outer.bottom >= inner.bottom - 0.75
const equalRect = (a: DOMRect, b: DOMRect) => ['left', 'top', 'width', 'height'].every((key) =>
  Math.abs(a[key as keyof DOMRect] as number - (b[key as keyof DOMRect] as number)) <= 0.75)

async function verifyNativeText() {
  app.style.display = 'none'
  document.body.scrollTop = 0
  const host = document.createElement('div')
  host.id = 'native-text'
  Object.assign(host.style, { width: '270px', fontSize: '20px', height: '220px', overflow: 'auto' })
  document.body.prepend(host)
  const root = createRoot(host)
  const driver = new MacroDataDriver({ queries: { query_macro: async () => null } })
  const renderText = async (text: string) => {
    root.render(React.createElement(SnlSyntaxTreeView, {
      tree: Object.assign(createSnlSyntaxTreeNode('prose-root', {
        kind: 'sub',
        children: [Object.assign(createSnlSyntaxTreeNode('wrapped-target', { kind: 'const' }), {
          env_mode: 'text' as const, temporary_source: text,
        })],
      }), { env_mode: 'text' as const, temporary_source: 'BEFORE #0 AFTER AFTER' }),
      macro_data_driver: driver,
    }))
    await settle()
    const target = host.querySelector<HTMLElement>('.snl-text[data-name="wrapped-target"]')
    if (!target || target.dataset.treePath !== '0' || getComputedStyle(target).display !== 'inline') {
      throw new Error('Missing production inline native Text semantic target')
    }
    return target
  }
  const checkLines = (target: HTMLElement) => {
    const lines = visibleRects(target)
    const paint = paintedRects()
    if (paint.length !== lines.length || !lines.every((line, i) => equalRect(line, paint[i]))) {
      throw new Error(`Native text must paint separate line rectangles: lines=${JSON.stringify(lines)} paint=${JSON.stringify(paint)}`)
    }
    return { lines: lines.map((r) => r.toJSON()), paint: paint.map((r) => r.toJSON()) }
  }
  try {
    const target = await renderText('selected words wrap here')
    applySnlHoverHighlight(target, host)
    const plain = checkLines(target)
    const lines = visibleRects(target)
    if (lines.length !== 2 || lines[0].left < lines[1].left + 30 || lines[1].right > lines[0].right - 30) {
      throw new Error(`Fixture needs first-line tail and second-line start: ${JSON.stringify(lines)}`)
    }
    // Prefix/suffix are literal siblings outside the semantic target.
    for (const sibling of [target.previousSibling, target.nextSibling]) {
      if (!sibling || sibling.nodeType !== Node.TEXT_NODE) throw new Error('Missing outside prose sentinel')
      const range = document.createRange()
      range.selectNodeContents(sibling)
      for (const rect of range.getClientRects()) {
        if (paintedRects().some((paint) => contains(paint, new DOMRect(rect.left + rect.width / 2, rect.top + rect.height / 2, 1, 1)))) {
          throw new Error('Native text frame encloses outside prose')
        }
      }
    }
    if (inspect === 'plain') return { plain }
    target.style.display = 'none'
    await settle()
    if (paintedRects().some((rect) => rect.width > 0 && rect.height > 0)) {
      throw new Error('Hidden native text still paints retained overlay geometry')
    }
    target.style.removeProperty('display')
    await settle()
    checkLines(target)
    host.style.width = '180px'
    await settle()
    const narrow = checkLines(target)
    host.style.width = '600px'
    await settle()
    checkLines(target)
    if (paintedRects().length !== 1) throw new Error('Reflow retained obsolete line overlays')
    host.style.width = '270px'
    await settle()
    const spacer = document.createElement('div')
    spacer.style.height = '500px'
    host.append(spacer)
    host.scrollTop = 20
    host.dispatchEvent(new Event('scroll'))
    checkLines(target)
    clearSnlHoverHighlight(host)
    if (paintedRects().length || target.classList.contains('snl-highlight-geometry')) throw new Error('Native cleanup leaked line overlays')
    host.scrollTop = 0
    const mixed = await renderText(String.raw`selected words $\frac{\sum_{i=0}^{n}i}{\frac{a}{b}}$ then more text wraps here`)
    applySnlHoverHighlight(mixed, host)
    const math = mixed.querySelector<HTMLElement>('.snl-math-span')
    if (!math || visibleRects(mixed).length < 2 || paintedRects().length < 2) throw new Error('Missing wrapped text/formula fixture')
    const mathRects = [math, ...math.querySelectorAll('*')].flatMap(visibleRects)
    const mathUnion = new DOMRect(Math.min(...mathRects.map((r) => r.left)), Math.min(...mathRects.map((r) => r.top)), 0, 0)
    mathUnion.width = Math.max(...mathRects.map((r) => r.right)) - mathUnion.left
    mathUnion.height = Math.max(...mathRects.map((r) => r.bottom)) - mathUnion.top
    if (!paintedRects().some((paint) => contains(paint, mathUnion))) {
      throw new Error(`Mixed native text lost atomic formula envelope: math=${JSON.stringify(mathUnion)} paint=${JSON.stringify(paintedRects())}`)
    }
    return { plain, narrow, mixed: { lines: visibleRects(mixed).map((r) => r.toJSON()), paint: paintedRects().map((r) => r.toJSON()), mathUnion } }
  } finally {
    if (!inspect) {
      clearSnlHoverHighlight(host)
      root.unmount()
      host.remove()
    }
  }
}

requestAnimationFrame(async () => {
  try {
    const parent = app.querySelector<HTMLElement>('[data-name="parent"]')!
    const child = app.querySelector<HTMLElement>('[data-name="bottom"]')!
    const childRect = measureSemanticHighlightRect(child)!
    let witness: { x: number; y: number; stack: Element[] } | null = null

    for (let y = Math.floor(childRect.top); y <= Math.ceil(childRect.bottom) && !witness; y += 1) {
      for (let x = Math.floor(childRect.left); x <= Math.ceil(childRect.right); x += 1) {
        const stack = document.elementsFromPoint(x, y).filter((element) => app.contains(element))
        const first = stack[0]
        if (!(first instanceof HTMLElement)) continue
        const naive = findMinimalHoverRoot(first, app)
        const deepest = findDeepestHoverRootFromStack(stack, app)
        if (naive === parent && deepest === child) {
          witness = { x, y, stack }
          break
        }
      }
    }
    if (!witness) throw new Error('No escaped-vlist parent-over-child witness found')

    applySnlHoverHighlight(parent, app)
    const union = measureSemanticHighlightRect(parent)!
    const self = parent.getBoundingClientRect()
    const overlay = document.querySelector<HTMLElement>('[data-snl-highlight-overlay]')!
    const close = (a: number, b: number) => Math.abs(a - b) <= 0.75
    const paintedRect = overlay.getBoundingClientRect()
    const painted = { left: paintedRect.left, top: paintedRect.top, width: paintedRect.width, height: paintedRect.height }
    if (!(union.height > self.height + 8)) throw new Error(`Fixture did not reproduce undersized wrapper: ${self.height} vs ${union.height}`)
    if (!close(painted.left, union.left) || !close(painted.top, union.top) ||
        !close(painted.width, union.width) || !close(painted.height, union.height)) {
      throw new Error(`Painted geometry ${JSON.stringify(painted)} != union ${JSON.stringify(union)}`)
    }
    if (getComputedStyle(overlay).pointerEvents !== 'none') throw new Error('Highlight frame intercepts pointers')
    if (getComputedStyle(overlay).position !== 'absolute') throw new Error('Highlight frame must scroll in document coordinates')
    const sourceBackground = getComputedStyle(parent).backgroundColor
    const sourceShadow = getComputedStyle(parent).boxShadow
    const overlayBackground = getComputedStyle(overlay).backgroundColor
    const overlayShadow = getComputedStyle(overlay).boxShadow
    if (sourceBackground !== 'transparent' && sourceBackground !== 'rgba(0, 0, 0, 0)') {
      throw new Error(`Semantic source still paints a second background: ${sourceBackground}`)
    }
    if (sourceShadow !== 'none') throw new Error(`Semantic source still paints a second frame: ${sourceShadow}`)
    if (overlayBackground !== 'transparent' && overlayBackground !== 'rgba(0, 0, 0, 0)') {
      throw new Error(`Authoritative overlay unexpectedly paints a background: ${overlayBackground}`)
    }
    if (overlayShadow === 'none') throw new Error('Authoritative overlay frame is missing')
    if (getComputedStyle(parent).position !== 'static') {
      throw new Error('Highlight must not create a containing block for positioned descendants')
    }

    window.scrollTo(0, 120)
    const immediateScrolledUnion = measureSemanticHighlightRect(parent)!
    const immediateScrolledPaint = overlay.getBoundingClientRect()
    if (!close(immediateScrolledPaint.left, immediateScrolledUnion.left) ||
        !close(immediateScrolledPaint.top, immediateScrolledUnion.top)) {
      throw new Error(`Highlight floated for a frame during scroll: paint=(${immediateScrolledPaint.left},${immediateScrolledPaint.top}) union=(${immediateScrolledUnion.left},${immediateScrolledUnion.top})`)
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50))
    const scrolledUnion = measureSemanticHighlightRect(parent)!
    const scrolledPaint = overlay.getBoundingClientRect()
    if (!close(scrolledPaint.left, scrolledUnion.left) || !close(scrolledPaint.top, scrolledUnion.top)) {
      throw new Error(`Highlight did not track scroll: paint=(${scrolledPaint.left},${scrolledPaint.top}) union=(${scrolledUnion.left},${scrolledUnion.top})`)
    }

    const growth = document.createElement('span')
    Object.assign(growth.style, { display: 'inline-block', width: '20px', height: '20px', transform: 'translateY(300px)' })
    parent.append(growth)
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50))
    const grownUnion = measureSemanticHighlightRect(parent)!
    const grownPaint = overlay.getBoundingClientRect()
    if (!(grownUnion.height > scrolledUnion.height + 40)) throw new Error('Growth fixture did not enlarge the subtree')
    if (!close(grownPaint.left, grownUnion.left) || !close(grownPaint.top, grownUnion.top) ||
        !close(grownPaint.width, grownUnion.width) || !close(grownPaint.height, grownUnion.height)) {
      throw new Error(`Highlight did not track growth: paint=${JSON.stringify(grownPaint.toJSON())} union=${JSON.stringify(grownUnion)}`)
    }

    Object.assign(document.documentElement.style, { height: '100%', overflow: 'hidden' })
    Object.assign(document.body.style, { height: '400px', minHeight: '0', overflow: 'auto' })
    const bodySpacer = document.createElement('div')
    bodySpacer.style.height = '1200px'
    document.body.append(bodySpacer)
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50))
    const beforeBodyScroll = measureSemanticHighlightRect(parent)!
    document.body.scrollTop = 100
    document.body.dispatchEvent(new Event('scroll'))
    const bodyScrolledUnion = measureSemanticHighlightRect(parent)!
    if (!(bodyScrolledUnion.top < beforeBodyScroll.top - 50)) {
      throw new Error(`Fixture did not create an independently scrolling body: ${beforeBodyScroll.top} -> ${bodyScrolledUnion.top}`)
    }
    const bodyScrolledPaint = overlay.getBoundingClientRect()
    if (!close(bodyScrolledPaint.left, bodyScrolledUnion.left) || !close(bodyScrolledPaint.top, bodyScrolledUnion.top)) {
      throw new Error(`Highlight floated in independently scrolling body: paint=(${bodyScrolledPaint.left},${bodyScrolledPaint.top}) union=(${bodyScrolledUnion.left},${bodyScrolledUnion.top})`)
    }

    const payload = {
      status: 'PASS',
      witness: { x: witness.x, y: witness.y, naive: 'parent', resolved: 'bottom' },
      self: { left: self.left, top: self.top, width: self.width, height: self.height },
      union,
      painted,
      grownUnion,
      grownPaint: { left: grownPaint.left, top: grownPaint.top, width: grownPaint.width, height: grownPaint.height },
      pointerEvents: getComputedStyle(overlay).pointerEvents,
      sourceBackground,
      sourceShadow,
      overlayBackground,
      overlayShadow,
      sourcePosition: getComputedStyle(parent).position,
      transform: app.style.transform,
      scrollTop: window.scrollY,
    }
    clearSnlHoverHighlight(app)
    const nativeText = await verifyNativeText()
    Object.assign(payload, { nativeText })
    result.dataset.status = 'pass'
    result.textContent = JSON.stringify(payload)
  } catch (error) {
    result.dataset.status = 'fail'
    result.textContent = error instanceof Error ? error.stack ?? error.message : String(error)
  }
})
