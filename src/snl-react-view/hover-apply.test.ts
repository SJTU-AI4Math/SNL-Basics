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
import { describe, it, expect, afterEach } from 'vitest'
import {
  applySnlHoverHighlight,
  clearSnlHoverHighlight,
  SNL_BASE_TEXT_COLOR_VAR,
  SNL_HOVER_CLASS,
} from './hover-apply'

function mount(html: string): HTMLElement {
  document.body.innerHTML = `<div id="c" class="katex-html">${html}</div>`
  return document.getElementById('c') as HTMLElement
}

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
      `<span id="a" class="${SNL_HOVER_CLASS.singleHover}" data-kind="const" data-name="a">a</span>` +
        `<span id="b" class="${SNL_HOVER_CLASS.bvarScope}" data-kind="bvar" data-name="b">b</span>` +
        `<span id="c2" class="${SNL_HOVER_CLASS.binderDecl}" data-kind="binder" data-name="c">c</span>`
    )
    clearSnlHoverHighlight(container)

    expect(container.querySelectorAll(`.${SNL_HOVER_CLASS.singleHover}`)).toHaveLength(0)
    expect(container.querySelectorAll(`.${SNL_HOVER_CLASS.bvarScope}`)).toHaveLength(0)
    expect(container.querySelectorAll(`.${SNL_HOVER_CLASS.binderDecl}`)).toHaveLength(0)
  })
})
