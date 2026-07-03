// @vitest-environment jsdom
//
// Regression tests for the text-mode render pipeline.
//
// Pre-2026-07-03: the text branch dropped the style template entirely and
// just concatenated children, so `Eq.eq[prose]` with template
// `#0 与 #1 相等` came out as just "a b" — the literal 与 / 相等 chars and
// the #0 / #1 ordering were both lost.
//
// Current pipeline: text-mode nodes go through the same KaTeX pipeline as
// formula ones. The whole subtree's LaTeX is wrapped in `\text{...}`, and
// formula children get `$...$` wrapped around them so KaTeX switches back to
// math mode. Literal text (including CJK — via KaTeX's `.cjk_fallback`) is
// preserved verbatim.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import { createMacroTemplateQueryFromDb } from './default-query'
import { createSnlSyntaxTreeNode } from '../snl-syntax-tree/types'
import type { SnlMacro, SnlMacroDb } from '../snl-macro/types'
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'

function leaf(name: string): SnlSyntaxTree {
  return createSnlSyntaxTreeNode(name, { kind: 'fvar' })
}

const eqDualMode: SnlMacro = {
  name: 'Eq.eq',
  description: 'equality',
  source: { entries: [], urls: [] },
  kind: 'const',
  arity: 'fixed',
  styles: [
    { tag: 'infix', mode: 'formula', template: '#0 = #1' },
    { tag: 'prose', mode: 'text', template: '#0 与 #1 相等' },
  ],
}

const listAllPeople: SnlMacro = {
  name: 'ListPeople.all',
  description: 'list all people, comma-separated',
  source: { entries: [], urls: [] },
  arity: 'variadic',
  styles: [
    { tag: 'default', mode: 'text', template: '所有人：#*', variadic_join: '、' },
  ],
}

const db: SnlMacroDb = {
  'Eq.eq': eqDualMode,
  'ListPeople.all': listAllPeople,
}
const query = createMacroTemplateQueryFromDb(db)

afterEach(cleanup)

/** Grab the text content of the KaTeX-rendered root panel. */
function katexText(container: HTMLElement): string {
  return container.querySelector('.katex-html')?.textContent ?? ''
}

describe('text-mode template splicing (regression)', () => {
  it('splices #0 / #1 into the template and keeps literal 与 / 相等', async () => {
    const tree = createSnlSyntaxTreeNode('Eq.eq', {
      children: [leaf('a'), leaf('b')],
    })
    tree.style = 'prose'
    const { container } = render(
      <SnlSyntaxTreeView tree={tree} query={query} macroDb={db} />,
    )
    await waitFor(() => {
      const raw = katexText(container)
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
    tree.style = 'prose'
    const { container } = render(
      <SnlSyntaxTreeView tree={tree} query={query} macroDb={db} />,
    )
    await waitFor(() => {
      const raw = katexText(container)
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

  it('shows a snlMissingArg placeholder when a #N slot has no child', async () => {
    const tree = createSnlSyntaxTreeNode('Eq.eq', {
      children: [leaf('only')],
    })
    tree.style = 'prose'
    const { container } = render(
      <SnlSyntaxTreeView tree={tree} query={query} macroDb={db} />,
    )
    await waitFor(() => {
      // Missing #1 renders as `[1]` inside .snlMissingArg (text-mode variant).
      const missing = container.querySelector('.snlMissingArg')
      expect(missing).not.toBeNull()
    })
  })

  it('expands #* with variadic_join between text-mode children', async () => {
    const tree = createSnlSyntaxTreeNode('ListPeople.all', {
      children: [leaf('Alice'), leaf('Bob'), leaf('Cara')],
    })
    const { container } = render(
      <SnlSyntaxTreeView tree={tree} query={query} macroDb={db} />,
    )
    await waitFor(() => {
      const raw = katexText(container)
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
        tree={tree}
        query={query}
        macroDb={db}
        onResolved={(l) => (latex = l)}
      />,
    )
    await waitFor(() => {
      expect(latex).toContain('=')
      expect(latex.startsWith('\\text{')).toBe(false)
    })
  })

  it('text root wraps its whole latex in \\text{...}', async () => {
    const tree = createSnlSyntaxTreeNode('Eq.eq', {
      children: [leaf('a'), leaf('b')],
    })
    tree.style = 'prose'
    let latex = ''
    render(
      <SnlSyntaxTreeView
        tree={tree}
        query={query}
        macroDb={db}
        onResolved={(l) => (latex = l)}
      />,
    )
    await waitFor(() => {
      expect(latex.startsWith('\\text{')).toBe(true)
      expect(latex).toContain('与')
      expect(latex).toContain('相等')
    })
  })
})
