// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { findMinimalHoverRoot } from './hover-dom'

/** Build a small DOM chain: outer wrap → partial wrap → inner leaf. */
function scenario(): {
  container: HTMLElement
  leaf: HTMLElement
  partialWrap: HTMLElement
  outerWrap: HTMLElement
} {
  const container = document.createElement('div')
  container.innerHTML = `
    <span class="enclosing" data-name="OuterMacro" data-kind="const">
      <span class="enclosing" data-name="row-helper" data-kind="partial">
        <span class="leaf">cell</span>
      </span>
    </span>
  `
  const outerWrap = container.querySelector<HTMLElement>('[data-name="OuterMacro"]')!
  const partialWrap = container.querySelector<HTMLElement>('[data-name="row-helper"]')!
  const leaf = container.querySelector<HTMLElement>('.leaf')!
  return { container, leaf, partialWrap, outerWrap }
}

describe('findMinimalHoverRoot with kind=partial', () => {
  it('walks past a partial-kind ancestor to the next non-partial data-name', () => {
    const { container, leaf, outerWrap } = scenario()
    expect(findMinimalHoverRoot(leaf, container)).toBe(outerWrap)
  })

  it('walks past a partial-kind start element as well', () => {
    // Hover directly on the partial wrap itself: still skips it.
    const { container, partialWrap, outerWrap } = scenario()
    expect(findMinimalHoverRoot(partialWrap, container)).toBe(outerWrap)
  })

  it('non-partial ancestor is returned as-is (backward compat)', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <span class="enclosing" data-name="Add" data-kind="const">
        <span class="mord">a</span>
      </span>`
    const wrap = container.querySelector<HTMLElement>('[data-name="Add"]')!
    const leaf = container.querySelector<HTMLElement>('.mord')!
    expect(findMinimalHoverRoot(leaf, container)).toBe(wrap)
  })

  it('returns start when no non-partial ancestor exists', () => {
    // A tree with ONLY partials: fallback returns start (which the caller
    // then filters out with a hasName + kind check).
    const container = document.createElement('div')
    container.innerHTML = `
      <span class="enclosing" data-name="only-partial" data-kind="partial">
        <span class="leaf">x</span>
      </span>`
    const leaf = container.querySelector<HTMLElement>('.leaf')!
    expect(findMinimalHoverRoot(leaf, container)).toBe(leaf)
  })
})
