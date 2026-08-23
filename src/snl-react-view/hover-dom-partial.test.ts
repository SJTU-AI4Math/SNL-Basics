// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  findDeepestHoverRootFromStack,
  findMinimalHoverRoot,
  measureSemanticHighlightRect,
  resolveDeepestHoverHitFromStack,
} from './hover-dom'

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

  it('selects the deepest semantic candidate when an escaped parent layout box is topmost', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <span data-name="parent" data-kind="const" data-tree-path="">
        <span class="parent-vlist"></span>
        <span data-name="child" data-kind="const" data-tree-path="1">
          <span class="child-vlist"></span>
        </span>
      </span>`
    const parentVlist = container.querySelector<HTMLElement>('.parent-vlist')!
    const childVlist = container.querySelector<HTMLElement>('.child-vlist')!
    const child = container.querySelector<HTMLElement>('[data-name="child"]')!

    expect(findDeepestHoverRootFromStack([parentVlist, childVlist], container)).toBe(child)
  })

  it('keeps front-to-back order for overlapping but unrelated semantic branches', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <span data-name="front" data-kind="const" data-tree-path="0"><span class="front-leaf"></span></span>
      <span data-name="behind" data-kind="const" data-tree-path="1.2"><span class="behind-leaf"></span></span>`
    const front = container.querySelector<HTMLElement>('[data-name="front"]')!
    const frontLeaf = container.querySelector<HTMLElement>('.front-leaf')!
    const behindLeaf = container.querySelector<HTMLElement>('.behind-leaf')!

    expect(findDeepestHoverRootFromStack([frontLeaf, behindLeaf], container)).toBe(front)
  })

  it('retains the frontmost stack member when later entries resolve to the same semantic root', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <span data-name="root" data-kind="const" data-tree-path="">
        <button><span class="button-content"></span></button>
      </span>`
    const root = container.querySelector<HTMLElement>('[data-name="root"]')!
    const button = container.querySelector('button')!
    const content = container.querySelector('.button-content')!

    expect(resolveDeepestHoverHitFromStack([content, button, root], container)).toEqual({ root, hit: content })
  })

  it('resolves elements using the container document realm', () => {
    const frame = document.createElement('iframe')
    document.body.append(frame)
    const foreignDocument = frame.contentDocument!
    const container = foreignDocument.createElement('div')
    container.innerHTML = '<span data-name="root" data-kind="const"><span class="leaf"></span></span>'
    foreignDocument.body.append(container)
    const root = container.querySelector<HTMLElement>('[data-name="root"]')!
    const leaf = container.querySelector('.leaf')!

    expect(resolveDeepestHoverHitFromStack([leaf, root], container)).toEqual({ root, hit: leaf })
    frame.remove()
  })

  it('measures the visible descendant union instead of the undersized semantic line box', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <span data-name="parent" data-kind="const" data-tree-path="">
        <span class="top"></span><span class="bottom"></span>
      </span>`
    const parent = container.querySelector<HTMLElement>('[data-name="parent"]')!
    const top = container.querySelector<HTMLElement>('.top')!
    const bottom = container.querySelector<HTMLElement>('.bottom')!
    const rects = (rect: DOMRect): DOMRectList => Object.assign([rect], { item: (index: number) => index === 0 ? rect : null })
    parent.getClientRects = () => rects({ left: 10, top: 20, right: 50, bottom: 40, width: 40, height: 20 } as DOMRect)
    top.getClientRects = () => rects({ left: 12, top: 8, right: 48, bottom: 24, width: 36, height: 16 } as DOMRect)
    bottom.getClientRects = () => rects({ left: 20, top: 36, right: 40, bottom: 58, width: 20, height: 22 } as DOMRect)

    expect(measureSemanticHighlightRect(parent)).toEqual({ left: 10, top: 8, right: 50, bottom: 58, width: 40, height: 50 })
  })
})
