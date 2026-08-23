import katex from 'katex'
import 'katex/dist/katex.min.css'
import '../../src/snl-react-view/style.css'
import { applySnlHoverHighlight } from '../../src/snl-react-view/hover-apply'
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
    result.dataset.status = 'pass'
    result.textContent = JSON.stringify(payload)
  } catch (error) {
    result.dataset.status = 'fail'
    result.textContent = error instanceof Error ? error.stack ?? error.message : String(error)
  }
})
