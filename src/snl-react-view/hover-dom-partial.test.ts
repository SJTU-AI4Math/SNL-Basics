// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { findMinimalHoverRoot } from './hover-dom'

/** Build a small DOM chain: outer wrap → sub wrap → inner leaf. */
function scenario(): {
  container: HTMLElement
  leaf: HTMLElement
  subWrap: HTMLElement
  outerWrap: HTMLElement
} {
  const container = document.createElement('div')
  container.innerHTML = `
    <span class="enclosing" data-name="OuterMacro" data-kind="const">
      <span class="enclosing" data-name="row-helper" data-kind="sub">
        <span class="leaf">cell</span>
      </span>
    </span>
  `
  const outerWrap = container.querySelector<HTMLElement>('[data-name="OuterMacro"]')!
  const subWrap = container.querySelector<HTMLElement>('[data-name="row-helper"]')!
  const leaf = container.querySelector<HTMLElement>('.leaf')!
  return { container, leaf, subWrap, outerWrap }
}

describe('findMinimalHoverRoot with kind=sub', () => {
  it('walks past a sub-kind ancestor to the next non-sub data-name', () => {
    const { container, leaf, outerWrap } = scenario()
    expect(findMinimalHoverRoot(leaf, container)).toBe(outerWrap)
  })

  it('walks past a sub-kind start element as well', () => {
    // Hover directly on the sub wrap itself: still skips it.
    const { container, subWrap, outerWrap } = scenario()
    expect(findMinimalHoverRoot(subWrap, container)).toBe(outerWrap)
  })

  it('non-sub ancestor is returned as-is (backward compat)', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <span class="enclosing" data-name="Add" data-kind="const">
        <span class="mord">a</span>
      </span>`
    const wrap = container.querySelector<HTMLElement>('[data-name="Add"]')!
    const leaf = container.querySelector<HTMLElement>('.mord')!
    expect(findMinimalHoverRoot(leaf, container)).toBe(wrap)
  })

  it('returns start when no non-sub ancestor exists', () => {
    // A tree with ONLY subs: fallback returns start (which the caller
    // then filters out with a hasName + kind check).
    const container = document.createElement('div')
    container.innerHTML = `
      <span class="enclosing" data-name="only-sub" data-kind="sub">
        <span class="leaf">x</span>
      </span>`
    const leaf = container.querySelector<HTMLElement>('.leaf')!
    expect(findMinimalHoverRoot(leaf, container)).toBe(leaf)
  })
})
