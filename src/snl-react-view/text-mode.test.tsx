// @vitest-environment jsdom
//
// Regression tests for the text-mode render pipeline.
//
// Pre-2026-07-03: the text branch dropped the style template entirely and
// just concatenated children, so `Eq.eq[prose]` with template
// `#0 与 #1 相等` came out as just "a b" — the literal 与 / 相等 chars and
// the #0 / #1 ordering were both lost.
//
// 2026-07-03 → 2026-07-10: text nodes went through the KaTeX pipeline
// wrapped in `\text{...}`.
//
// 2026-07-10 refactor (cat): text roots now render via React (TextRun),
// so they can contain block macros. The subtree stays in native HTML
// until it hits a formula child, at which point that child drops into
// KaTeX via MathSpan. Missing-arg placeholder is now `.snl-missing-arg`.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import { createSnlSyntaxTreeNode } from '../snl-syntax-tree/types'
import type { SnlMacro, SnlMacroRecord } from '../snl-macro/types'
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'
import { testDriver } from '../snl-react-view/test-helpers'

function leaf(name: string): SnlSyntaxTree {
  return createSnlSyntaxTreeNode(name, { kind: 'fvar' })
}

const eqDualMode: SnlMacro = {
  name: 'Eq.eq', description: 'equality',
  source: { entries: [], urls: [] },
  kind: 'const',
  dynamic_arity: false,
  tags: [],
  styles: [
    { style_name: 'infix', mode: 'formula_inline', template: '#0 = #1', tags: [] },
    { style_name: 'prose', mode: 'text', template: '#0 与 #1 相等', tags: [] },
  ],
}

const listAllPeople: SnlMacro = {
  name: 'ListPeople.all', description: 'list all people, comma-separated',
  source: { entries: [], urls: [] },
  dynamic_arity: true,
  tags: [],
  styles: [
    { style_name: 'default', mode: 'text', template: '所有人：#*', separator: '、', tags: [] },
  ],
}

const db: SnlMacroRecord = {
  'Eq.eq': eqDualMode,
  'ListPeople.all': listAllPeople,
}

afterEach(cleanup)

/** Grab the text content of the panel (works for React TextRun and KaTeX). */
function panelText(container: HTMLElement): string {
  return container.querySelector('.katex-html')?.textContent ?? ''
}

describe('text-mode template splicing (regression)', () => {
  it('splices #0 / #1 into the template and keeps literal 与 / 相等', async () => {
    const tree = createSnlSyntaxTreeNode('Eq.eq', {
      children: [leaf('a'), leaf('b')],
    })
    tree.style_name = 'prose'
    const { container } = render(
      <SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} />,
    )
    await waitFor(() => {
      const raw = panelText(container)
      expect(raw).toContain('a')
      expect(raw).toContain('b')
      expect(raw).toContain('与')
      expect(raw).toContain('相等')
    })
  })

  it('preserves child order (a 与 b 相等, not b 与 a 相等)', async () => {
    const tree = createSnlSyntaxTreeNode('Eq.eq', {
      children: [leaf('lhs'), leaf('rhs')],
    })
    tree.style_name = 'prose'
    const { container } = render(
      <SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} />,
    )
    await waitFor(() => {
      const raw = panelText(container)
      const iLhs = raw.indexOf('lhs')
      const iYu = raw.indexOf('与')
      const iRhs = raw.indexOf('rhs')
      const iEq = raw.indexOf('相等')
      expect(iLhs).toBeGreaterThanOrEqual(0)
      expect(iYu).toBeGreaterThan(iLhs)
      expect(iRhs).toBeGreaterThan(iYu)
      expect(iEq).toBeGreaterThan(iRhs)
    })
  })

  it('shows a snl-missing-arg placeholder when a #N slot has no child', async () => {
    // Cat 2026-07-10: text-mode now renders via React TextRun instead
    // of KaTeX \text{...}; missing #N slots become
    // <span class="snl-missing-arg">[N]</span>.
    const tree = createSnlSyntaxTreeNode('Eq.eq', {
      children: [leaf('only')],
    })
    tree.style_name = 'prose'
    const { container } = render(
      <SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} />,
    )
    await waitFor(() => {
      const missing = container.querySelector('.snl-missing-arg')
      expect(missing).not.toBeNull()
      expect(missing!.textContent).toBe('[1]')
    })
  })

  it('expands #* with separator between text-mode children', async () => {
    const tree = createSnlSyntaxTreeNode('ListPeople.all', {
      children: [leaf('Alice'), leaf('Bob'), leaf('Cara')],
    })
    const { container } = render(
      <SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} />,
    )
    await waitFor(() => {
      const raw = panelText(container)
      expect(raw).toContain('所有人：')
      expect(raw).toContain('Alice')
      expect(raw).toContain('Bob')
      expect(raw).toContain('Cara')
      // 、 separator lands between children (2 separators for 3 children).
      expect(raw.split('、').length).toBeGreaterThanOrEqual(3)
    })
  })

  it('formula root emits raw LaTeX (no \\text{...} wrapping)', async () => {
    // Sanity-check: formula-mode roots still render as pure math, no \text.
    const tree = createSnlSyntaxTreeNode('Eq.eq', {
      children: [leaf('a'), leaf('b')],
    })
    // no style override → styles[0] = infix (formula)
    let latex = ''
    render(
      <SnlSyntaxTreeView
        tree={tree} macro_data_driver={testDriver(db)}
        onResolved={(l) => (latex = l)}
      />,
    )
    await waitFor(() => {
      expect(latex).toContain('=')
      expect(latex.startsWith('\\text{')).toBe(false)
    })
  })

  it('text root renders via React <span.snl-text> instead of KaTeX \\text{...} wrap', async () => {
    // Cat 2026-07-10 refactor: text roots no longer hit the KaTeX
    // \text{...} pipeline. Whole subtree is a React tree of TextRun
    // spans; formula CHILDREN drop into MathSpan and block children
    // into block renderers. onResolved is KaTeX-only so it won't
    // fire — assert on the DOM.
    const tree = createSnlSyntaxTreeNode('Eq.eq', {
      children: [leaf('a'), leaf('b')],
    })
    tree.style_name = 'prose'
    const { container } = render(
      <SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} />,
    )
    await waitFor(() => {
      const text = container.querySelector('.snl-text')
      expect(text).not.toBeNull()
      expect(text!.textContent).toContain('与')
      expect(text!.textContent).toContain('相等')
    })
  })
})
