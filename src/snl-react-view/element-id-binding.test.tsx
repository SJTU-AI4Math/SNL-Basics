// @vitest-environment jsdom
/**
 * Page-wide binder identities: a binder declares `@x@##id`, a use elsewhere on
 * the page — another tree, panel or popover — refers to it with `x@##id`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import { parseSnlSyntaxTree } from '../snl-syntax-tree/parser'
import { SnlDslFormatter } from '../snl-syntax-tree/formatter'
import { resolveSnlSemantics } from '../snl-syntax-tree/semantic-resolver'
import type { SnlMacroRecord } from '../snl-macro/types'
import { testDriver } from './test-helpers'

const db: SnlMacroRecord = {
  pair: {
    name: 'pair', description: '', source: { entries: [], urls: [] }, dynamic_arity: false, tags: [],
    styles: [{ style_name: 'default', template: { mode: 'formula_inline', body: '#0 , #1' }, tags: [] }],
  },
}
const driver = testDriver(db)

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('page-wide binder ids in the DSL', () => {
  it('parses, resolves and formats `@x@##id` and `x@##id`', () => {
    const binder = parseSnlSyntaxTree('@x@##ctx.1')
    expect(binder.kind).toBe('binder')
    expect(binder.binder_id).toBe('ctx.1')
    const use = parseSnlSyntaxTree('x@##ctx.1')
    expect(use.postfix).toEqual({ type: 'element_id', id: 'ctx.1' })

    // The binder is in another tree: the use still resolves, to the page-wide id.
    const resolved = resolveSnlSemantics(use, {})
    expect(resolved.tree.kind).toBe('bvar')
    expect(resolved.tree.source).toEqual({ type: 'element_id', id: 'ctx.1' })
    expect(resolved.diagnostics).toEqual([])

    const formatter = new SnlDslFormatter()
    expect(formatter.format('@x@##ctx.1')).toBe('@x@##ctx.1')
    expect(formatter.format('pair(@x@##c, x@##c)')).toBe('pair(@x@##c, x@##c)')
    expect(() => parseSnlSyntaxTree('@x@#ctx')).toThrow(/@##/)
  })
})

describe('page-wide binder ids in the view', () => {
  it('links a use in one view to its binder in another, and clears both on leave', async () => {
    const { container } = render(<>
      <div data-testid="declaring"><SnlSyntaxTreeView tree={parseSnlSyntaxTree('pair(@x@##c1, y)')} macro_data_driver={driver} /></div>
      <div data-testid="using"><SnlSyntaxTreeView tree={parseSnlSyntaxTree('pair(x@##c1, z)')} macro_data_driver={driver} /></div>
    </>)
    const [binder, use] = await waitFor(() => {
      const b = container.querySelector<HTMLElement>('[data-testid="declaring"] [data-binder-id="c1"]')
      const u = container.querySelector<HTMLElement>('[data-testid="using"] [data-source-id="c1"]')
      expect(b && u).toBeTruthy()
      return [b!, u!]
    })
    expect(binder.dataset.kind).toBe('binder')
    expect(use.dataset.kind).toBe('bvar')

    const surface = container.querySelector<HTMLElement>('[data-testid="using"] .katex-html')!
    const original = document.elementsFromPoint
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [use] })
    vi.useFakeTimers()
    try {
      fireEvent.mouseMove(use, { clientX: 5, clientY: 5 })
      act(() => vi.advanceTimersByTime(1000))
      expect(binder.classList.contains('snl-binder-decl')).toBe(true)
      fireEvent.mouseLeave(surface)
      expect(binder.classList.contains('snl-binder-decl')).toBe(false)
    } finally {
      Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: original })
    }
  })

  it('lights every use, in any view, when the binder is hovered', async () => {
    const { container } = render(<>
      <div data-testid="declaring"><SnlSyntaxTreeView tree={parseSnlSyntaxTree('pair(@x@##c2, x)')} macro_data_driver={driver} /></div>
      <div data-testid="using"><SnlSyntaxTreeView tree={parseSnlSyntaxTree('pair(x@##c2, x@##c2)')} macro_data_driver={driver} /></div>
    </>)
    const binder = await waitFor(() => {
      const b = container.querySelector<HTMLElement>('[data-testid="declaring"] [data-binder-id="c2"]')
      expect(container.querySelectorAll('[data-testid="using"] [data-source-id="c2"]')).toHaveLength(2)
      expect(b).toBeTruthy()
      return b!
    })
    const original = document.elementsFromPoint
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [binder] })
    vi.useFakeTimers()
    try {
      fireEvent.mouseMove(binder, { clientX: 5, clientY: 5 })
      act(() => vi.advanceTimersByTime(1000))
      const lit = [...container.querySelectorAll<HTMLElement>('.snl-bvar-scope')]
      // two cross-tree uses plus the in-tree use `x` (resolved by name in the declaring tree)
      expect(lit.filter((element) => element.dataset.sourceId === 'c2')).toHaveLength(2)
      expect(lit.some((element) => element.closest('[data-testid="declaring"]'))).toBe(true)
    } finally {
      Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: original })
    }
  })
})
