// @vitest-environment jsdom
/**
 * The DOM-only hover contract, exercised directly.
 *
 * These guard the behaviour a NON-React consumer depends on. The static HTML
 * export in SNL-Doc-Extension had hand-copied this logic, the copy drifted, and
 * nested subtrees inside a hovered node stopped reverting to the base colour
 * (猫猫 2026-07-29). Now both surfaces call `applySnlHoverHighlight`, so these
 * tests cover both.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  applySnlHoverHighlight,
  clearSnlHoverHighlight,
  SNL_BASE_TEXT_COLOR_VAR,
  SNL_HOVER_CLASS,
} from './hover-apply'

function mount(html: string): HTMLElement {
  document.body.innerHTML = `<div id="c" class="katex-html">${html}</div>`
  const container = document.getElementById('c') as HTMLElement
  mountedContainers.push(container)
  return container
}

const mountedContainers: HTMLElement[] = []

const TWO_SCOPES = `
<span data-scope="binder" data-bindref="b1" data-kind="rule" data-name="forall">
  <span id="binder1" data-kind="binder" data-bindref="b1" data-name="x">x</span>
  <span id="bvar1" data-kind="bvar" data-bindref="b1" data-name="x">x</span>
</span>
<span data-scope="binder" data-bindref="b2" data-kind="rule" data-name="forall">
  <span id="binder2" data-kind="binder" data-bindref="b2" data-name="x">x</span>
  <span id="bvar2" data-kind="bvar" data-bindref="b2" data-name="x">x</span>
</span>`

const byId = (id: string): HTMLElement => document.getElementById(id) as HTMLElement

afterEach(() => {
  mountedContainers.splice(0).forEach((container) => clearSnlHoverHighlight(container))
  document.body.innerHTML = ''
})

describe('applySnlHoverHighlight', () => {
  it('captures the base text colour so nested subtrees can revert', () => {
    // `.snl-single-hover [data-kind] { color: var(--snl-base-text-color) }` in
    // style.css is dead without this. The export omitted it and every nested
    // subtree took the highlight colour instead of staying put.
    const container = mount('<span id="t" data-kind="const" data-name="c">c</span>')
    container.style.color = 'rgb(17, 17, 17)'

    applySnlHoverHighlight(byId('t'), container)

    expect(container.style.getPropertyValue(SNL_BASE_TEXT_COLOR_VAR)).toBe('rgb(17, 17, 17)')
  })

  it('captures the colour BEFORE marking, not after', () => {
    // Reading after the class lands would capture the highlight colour and the
    // nested-revert rule would highlight instead of revert — silently inverted.
    const container = mount('<span id="t" data-kind="const" data-name="c">c</span>')
    container.style.color = 'rgb(1, 2, 3)'

    applySnlHoverHighlight(byId('t'), container)

    expect(container.style.getPropertyValue(SNL_BASE_TEXT_COLOR_VAR)).toBe('rgb(1, 2, 3)')
    expect(byId('t').classList.contains(SNL_HOVER_CLASS.singleHover)).toBe(true)
  })

  it('marks the hovered node', () => {
    const container = mount('<span id="t" data-kind="const" data-name="c">c</span>')
    const set = applySnlHoverHighlight(byId('t'), container)

    expect(set.singleHover).toBe(byId('t'))
    expect(byId('t').classList.contains(SNL_HOVER_CLASS.singleHover)).toBe(true)
  })

  it('marks every DOM fragment of one alignment-split semantic node', () => {
    const container = mount(`
      <span id="row-left" data-kind="const" data-name="matrix.row" data-tree-path="0">a</span>
      <span aria-hidden="true">&amp;</span>
      <span id="row-right" data-kind="const" data-name="matrix.row" data-tree-path="0">b</span>
      <span id="other-row" data-kind="const" data-name="matrix.row" data-tree-path="1">c</span>
    `)

    applySnlHoverHighlight(byId('row-left'), container)

    expect(byId('row-left').classList.contains(SNL_HOVER_CLASS.singleHover)).toBe(true)
    expect(byId('row-right').classList.contains(SNL_HOVER_CLASS.singleHover)).toBe(true)
    expect(byId('other-row').classList.contains(SNL_HOVER_CLASS.singleHover)).toBe(false)
  })

  it.each(['', 'class="snl-text" style="display:block"'])('projects the complete visible subtree union into paint-only frame geometry (%s)', (attributes) => {
    const container = mount(`<span id="t" ${attributes} data-kind="const" data-name="c"><span id="upper"></span><span id="lower"></span></span>`)
    const rects = (rect: DOMRect): DOMRectList => Object.assign([rect], { item: (index: number) => index === 0 ? rect : null })
    byId('t').getClientRects = () => rects({ left: 10, top: 20, right: 50, bottom: 40, width: 40, height: 20 } as DOMRect)
    byId('upper').getClientRects = () => rects({ left: 12, top: 8, right: 48, bottom: 24, width: 36, height: 16 } as DOMRect)
    byId('lower').getClientRects = () => rects({ left: 20, top: 36, right: 40, bottom: 58, width: 20, height: 22 } as DOMRect)

    applySnlHoverHighlight(byId('t'), container)

    expect(byId('t').classList.contains(SNL_HOVER_CLASS.geometry)).toBe(true)
    const overlay = document.documentElement.querySelector<HTMLElement>('[data-snl-highlight-overlay]')!
    expect(overlay.style.left).toBe('10px')
    expect(overlay.style.top).toBe('8px')
    expect(overlay.style.width).toBe('40px')
    expect(overlay.style.height).toBe('50px')
  })

  it('paints native text line fragments without enclosing the preceding or following text', () => {
    const container = mount('prefix <span id="t" class="snl-text" style="display:inline" data-kind="const" data-name="text" data-tree-path="0">wrapped text</span> suffix')
    let lines = [new DOMRect(80, 20, 40, 20), new DOMRect(10, 44, 35, 20)]
    byId('t').getClientRects = () => Object.assign(lines, { item: (index: number) => lines[index] ?? null })
    const overlays = () => [...document.querySelectorAll<HTMLElement>('[data-snl-highlight-overlay]')]
    const boxes = () => overlays().map((overlay) => [overlay.style.left, overlay.style.top, overlay.style.width, overlay.style.height])

    const set = applySnlHoverHighlight(byId('t'), container)

    expect(set.singleHover).toBe(byId('t'))
    expect(byId('t').dataset.treePath).toBe('0')
    expect(boxes()).toEqual([['80px', '20px', '40px', '20px'], ['10px', '44px', '35px', '20px']])
    const original = overlays()
    applySnlHoverHighlight(byId('t'), container)
    expect(overlays()).toEqual(original)

    // Nested scrolling/reflow changes both coordinates and the number of lines.
    lines = [new DOMRect(10, 5, 105, 20)]
    container.dispatchEvent(new Event('scroll'))
    expect(boxes()).toEqual([['10px', '5px', '105px', '20px']])
    expect(original[1].isConnected).toBe(false)
    lines = [new DOMRect(80, 20, 40, 20), new DOMRect(10, 44, 35, 20)]
    container.dispatchEvent(new Event('scroll'))
    expect(overlays()).toHaveLength(2)
    lines = []
    container.dispatchEvent(new Event('scroll'))
    expect(overlays()).toHaveLength(1)
    expect(overlays()[0].hidden).toBe(true)
    lines = [new DOMRect(10, 5, 105, 20)]
    container.dispatchEvent(new Event('scroll'))
    expect(overlays()[0].hidden).toBe(false)
    expect(boxes()).toEqual([['10px', '5px', '105px', '20px']])
    clearSnlHoverHighlight(container)
    expect(overlays()).toHaveLength(0)
    expect(byId('t').classList.contains(SNL_HOVER_CLASS.geometry)).toBe(false)
  })

  it('keeps a tall inline formula atomic on its own text line, including escaped descendants', () => {
    const container = mount('<span id="t" class="snl-text" style="display:inline" data-kind="const" data-name="mixed"><span id="nested" class="snl-text">text</span><span id="math" class="snl-math-span"><span id="fraction"></span></span></span>')
    const stub = (id: string, rects: DOMRect[]) => {
      byId(id).getClientRects = () => Object.assign(rects, { item: (index: number) => rects[index] ?? null })
    }
    stub('t', [new DOMRect(80, 20, 40, 20), new DOMRect(10, 64, 70, 20)])
    stub('nested', [new DOMRect(80, 20, 40, 20), new DOMRect(10, 64, 20, 20)])
    stub('math', [new DOMRect(35, 64, 30, 20)])
    // A vlist escapes upward past the preceding line: do not assign its pieces
    // independently to neighboring prose lines or ignore them altogether.
    stub('fraction', [new DOMRect(35, 10, 30, 90)])

    applySnlHoverHighlight(byId('t'), container)

    const boxes = [...document.querySelectorAll<HTMLElement>('[data-snl-highlight-overlay]')]
      .map((overlay) => [overlay.style.left, overlay.style.top, overlay.style.width, overlay.style.height])
    expect(boxes).toEqual([['80px', '20px', '40px', '20px'], ['10px', '10px', '70px', '90px']])
  })

  it('reuses geometry while the pointer remains on the same semantic fragment', () => {
    const container = mount('<span id="t" data-kind="const" data-name="c">c</span>')
    const rect = { left: 10, top: 20, right: 50, bottom: 40, width: 40, height: 20 } as DOMRect
    const getClientRects = vi.fn((): DOMRectList => Object.assign([rect], { item: (index: number) => index === 0 ? rect : null }))
    byId('t').getClientRects = getClientRects

    applySnlHoverHighlight(byId('t'), container)
    applySnlHoverHighlight(byId('t'), container)

    expect(getClientRects).toHaveBeenCalledTimes(1)
  })

  it('tracks a nested scroller before the next animation frame', () => {
    const container = mount('<span id="t" data-kind="const" data-name="c">c</span>')
    const scroller = document.createElement('div')
    document.body.append(scroller)
    scroller.append(container)
    let top = 20
    byId('t').getClientRects = () => {
      const rect = { left: 10, top, right: 50, bottom: top + 20, width: 40, height: 20 } as DOMRect
      return Object.assign([rect], { item: (index: number) => index === 0 ? rect : null })
    }
    applySnlHoverHighlight(byId('t'), container)
    const overlay = document.documentElement.querySelector<HTMLElement>('[data-snl-highlight-overlay]')!
    expect(overlay.style.top).toBe('20px')

    top = 5
    scroller.dispatchEvent(new Event('scroll'))

    expect(overlay.style.top).toBe('5px')
  })

  it('does not let a retained observer callback recreate geometry after cleanup', () => {
    const original = window.MutationObserver
    const callbacks: MutationCallback[] = []
    const instances: Array<{ observe: () => void; disconnect: () => void; takeRecords: () => MutationRecord[] }> = []
    class RetainedMutationObserver {
      constructor(callback: MutationCallback) {
        callbacks.push(callback)
        instances.push(this)
      }
      observe() {}
      disconnect() {}
      takeRecords(): MutationRecord[] { return [] }
    }
    Object.defineProperty(window, 'MutationObserver', {
      configurable: true,
      value: RetainedMutationObserver as unknown as typeof MutationObserver,
    })
    try {
      const container = mount('<span id="t" data-kind="const" data-name="c">c</span>')
      const rect = { left: 10, top: 20, right: 50, bottom: 40, width: 40, height: 20 } as DOMRect
      byId('t').getClientRects = () => Object.assign([rect], { item: (index: number) => index === 0 ? rect : null })
      applySnlHoverHighlight(byId('t'), container)
      const ownedOverlay = document.querySelector<HTMLElement>('[data-snl-highlight-overlay]')!
      const observerCount = instances.length

      clearSnlHoverHighlight(container)
      callbacks[0]([
        { type: 'childList', target: byId('t') } as unknown as MutationRecord,
      ], instances[0] as MutationObserver)

      expect(instances).toHaveLength(observerCount)
      expect(ownedOverlay.isConnected).toBe(false)
    } finally {
      Object.defineProperty(window, 'MutationObserver', { configurable: true, value: original })
    }
  })

  it('lights up only the hovered bvar\'s own binding scope', () => {
    const container = mount(TWO_SCOPES)
    applySnlHoverHighlight(byId('bvar1'), container)

    expect(byId('bvar1').classList.contains(SNL_HOVER_CLASS.bvarScope)).toBe(true)
    expect(byId('binder1').classList.contains(SNL_HOVER_CLASS.binderDecl)).toBe(true)
    // The other scope reuses the same name and kind; it must stay dark.
    expect(byId('bvar2').classList.contains(SNL_HOVER_CLASS.bvarScope)).toBe(false)
    expect(byId('binder2').classList.contains(SNL_HOVER_CLASS.binderDecl)).toBe(false)
  })

  it('clears previous marks on each application', () => {
    const container = mount(TWO_SCOPES)
    applySnlHoverHighlight(byId('bvar1'), container)
    applySnlHoverHighlight(byId('bvar2'), container)

    expect(byId('bvar1').classList.contains(SNL_HOVER_CLASS.bvarScope)).toBe(false)
    expect(byId('bvar2').classList.contains(SNL_HOVER_CLASS.bvarScope)).toBe(true)
  })

  it('builds a scope index on demand when none is supplied', () => {
    // The export has no long-lived index to hand in; the helper must cope.
    const container = mount(TWO_SCOPES)
    const set = applySnlHoverHighlight(byId('bvar1'), container)
    expect(set.bvarScope).toHaveLength(1)
    expect(set.binderDecl).toHaveLength(1)
  })

  it('recovers a secondary binder ref when a supplied scope index is stale', () => {
    const container = mount(`
      <span data-scope="binder" data-bindref="b1" data-kind="rule" data-name="scope">
        <span id="binder-x" data-kind="binder" data-bindref="b1" data-name="x">x</span>
        <span id="binder-y" data-kind="binder" data-bindref="b2" data-name="y">y</span>
        <span id="bvar-x" data-kind="bvar" data-bindref="b1" data-name="x">x</span>
        <span id="bvar-y" data-kind="bvar" data-bindref="b2" data-name="y">y</span>
      </span>`)

    applySnlHoverHighlight(byId('bvar-y'), container, { bvarScopeIndex: new Map() })

    expect(byId('bvar-y').classList.contains(SNL_HOVER_CLASS.bvarScope)).toBe(true)
    expect(byId('binder-y').classList.contains(SNL_HOVER_CLASS.binderDecl)).toBe(true)
    expect(byId('bvar-x').classList.contains(SNL_HOVER_CLASS.bvarScope)).toBe(false)
    expect(byId('binder-x').classList.contains(SNL_HOVER_CLASS.binderDecl)).toBe(false)
  })
})

describe('clearSnlHoverHighlight', () => {
  it('removes every hover class, including marks it did not apply', () => {
    const container = mount(
      `<span id="a" class="${SNL_HOVER_CLASS.singleHover} ${SNL_HOVER_CLASS.geometry}" style="--snl-highlight-left: 10px; --snl-highlight-top: 20px; --snl-highlight-width: 30px; --snl-highlight-height: 40px" data-kind="const" data-name="a">a</span>` +
        `<span id="b" class="${SNL_HOVER_CLASS.bvarScope}" data-kind="bvar" data-name="b">b</span>` +
        `<span id="c2" class="${SNL_HOVER_CLASS.binderDecl}" data-kind="binder" data-name="c">c</span>`
    )
    clearSnlHoverHighlight(container)

    expect(container.querySelectorAll(`.${SNL_HOVER_CLASS.singleHover}`)).toHaveLength(0)
    expect(container.querySelectorAll(`.${SNL_HOVER_CLASS.bvarScope}`)).toHaveLength(0)
    expect(container.querySelectorAll(`.${SNL_HOVER_CLASS.binderDecl}`)).toHaveLength(0)
    expect(byId('a').classList.contains(SNL_HOVER_CLASS.geometry)).toBe(false)
    expect(byId('a').style.getPropertyValue('--snl-highlight-left')).toBe('')
    expect(byId('a').style.getPropertyValue('--snl-highlight-height')).toBe('')
  })
})
