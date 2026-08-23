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
Object.assign(document.body.style, { margin: '40px', fontSize: '28px' })
app.className = 'katex-html'
app.innerHTML = katex.renderToString(String.raw`
  \htmlData{name=parent,kind=const,tree-path=}{
    \frac{
      \htmlData{name=top,kind=const,tree-path=0}{\sum_{i=0}^{n} i}
    }{
      \htmlData{name=bottom,kind=const,tree-path=1}{\frac{a}{b}}
    }
  }
`, { throwOnError: true, trust: true, output: 'html' })

requestAnimationFrame(() => {
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
    const pseudo = getComputedStyle(parent, '::before')
    const numeric = (value: string) => Number.parseFloat(value)
    const close = (a: number, b: number) => Math.abs(a - b) <= 0.75
    const painted = {
      left: numeric(pseudo.left),
      top: numeric(pseudo.top),
      width: numeric(pseudo.width),
      height: numeric(pseudo.height),
    }
    if (!(union.height > self.height + 8)) throw new Error(`Fixture did not reproduce undersized wrapper: ${self.height} vs ${union.height}`)
    if (!close(painted.left, union.left) || !close(painted.top, union.top) ||
        !close(painted.width, union.width) || !close(painted.height, union.height)) {
      throw new Error(`Painted geometry ${JSON.stringify(painted)} != union ${JSON.stringify(union)}`)
    }
    if (pseudo.pointerEvents !== 'none') throw new Error(`Highlight frame intercepts pointers: ${pseudo.pointerEvents}`)

    const payload = {
      status: 'PASS',
      witness: { x: witness.x, y: witness.y, naive: 'parent', resolved: 'bottom' },
      self: { left: self.left, top: self.top, width: self.width, height: self.height },
      union,
      painted,
      pointerEvents: pseudo.pointerEvents,
    }
    result.dataset.status = 'pass'
    result.textContent = JSON.stringify(payload)
  } catch (error) {
    result.dataset.status = 'fail'
    result.textContent = error instanceof Error ? error.stack ?? error.message : String(error)
  }
})
