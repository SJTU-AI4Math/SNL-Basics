// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import katex from 'katex'
import { tightenHoverBoxes } from './tighten-hover-boxes'

describe('tightenHoverBoxes', () => {
  function renderInto(latex: string): HTMLElement {
    const container = document.createElement('div')
    container.innerHTML = katex.renderToString(latex, {
      throwOnError: false,
      trust: true,
      strict: false,
    })
    // Every katex output nests a katex-html span inside .katex; walk to it.
    const html = container.querySelector<HTMLElement>('.katex-html')
    if (!html) throw new Error('no .katex-html in output')
    return html
  }

  it('moves trailing .mspace OUT of .enclosing[data-name] wrap', () => {
    // Simulate a SNL-wrapped mord followed by a mbin: KaTeX puts the inter-atom
    // mspace inside the wrap (the bug).
    const el = renderInto('\\htmlData{name=x,kind=const}{a} + b')
    const wrap = el.querySelector<HTMLElement>('.enclosing[data-name="x"]')!
    // Before the fix: last child is .mspace.
    expect(wrap.lastElementChild?.classList.contains('mspace')).toBe(true)
    tightenHoverBoxes(el)
    // After: last child is the last inner mord, mspace is a sibling AFTER the wrap.
    expect(wrap.lastElementChild?.classList.contains('mspace')).toBe(false)
    const next = wrap.nextElementSibling as HTMLElement
    expect(next?.classList.contains('mspace')).toBe(true)
  })

  it('is idempotent', () => {
    const el = renderInto('\\htmlData{name=x,kind=const}{a} + b')
    tightenHoverBoxes(el)
    const beforeHtml = el.innerHTML
    tightenHoverBoxes(el)
    expect(el.innerHTML).toBe(beforeHtml)
  })

  it('leaves lone SNL wraps (no trailing mspace) untouched', () => {
    const el = renderInto('\\htmlData{name=x,kind=const}{a}')
    const wrap = el.querySelector<HTMLElement>('.enclosing[data-name="x"]')!
    const beforeHtml = wrap.outerHTML
    tightenHoverBoxes(el)
    // Lone atom: KaTeX doesn't add trailing mspace, so wrap is unchanged.
    expect(wrap.outerHTML).toBe(beforeHtml)
  })

  it('handles multiple wraps in one render', () => {
    const el = renderInto(
      '\\htmlData{name=x,kind=const}{a} + \\htmlData{name=y,kind=const}{b} + c',
    )
    tightenHoverBoxes(el)
    for (const w of el.querySelectorAll<HTMLElement>('.enclosing[data-name]')) {
      expect(w.lastElementChild?.classList.contains('mspace')).toBe(false)
    }
  })

  it('does not eat placeholder inner .snlArgPlaceholder ends (which have NO trailing mspace after \\mathord fix)', () => {
    // The Create Macro preview wraps placeholders in \mathord{\htmlClass{snlArgPlaceholder}{N}},
    // so the INNER .snlArgPlaceholder frame is clean. The OUTER \htmlData still may have
    // trailing mspace though — that's what we tighten.
    const el = renderInto(
      '\\htmlData{name=_snl_arg_0,kind=argPlaceholder}{\\mathord{\\htmlClass{snlArgPlaceholder}{0}}} + x',
    )
    const inner = el.querySelector<HTMLElement>('.snlArgPlaceholder')!
    expect(inner.lastElementChild?.classList.contains('mspace')).toBe(false)
    tightenHoverBoxes(el)
    // Inner untouched:
    expect(inner.lastElementChild?.classList.contains('mspace')).toBe(false)
    // Outer wrap: mspace moved out.
    const outer = el.querySelector<HTMLElement>(
      '.enclosing[data-name="_snl_arg_0"]',
    )!
    expect(outer.lastElementChild?.classList.contains('mspace')).toBe(false)
  })
})
