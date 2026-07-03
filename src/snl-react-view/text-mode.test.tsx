// @vitest-environment jsdom
//
// Regression: pre-2026-07-03 the text-mode render branch dropped the style
// template entirely and just concatenated children, so a text-style macro
// like `Eq.eq[prose]` with template `#0 与 #1 相等` would show up as just
// "a b" — the literal 与 / 相等 chars were lost, and only formula children
// or self-contained placeholders rendered. Fix: text branch walks the
// template, splices `#N` at each slot, keeps literals verbatim.
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
      const text = container.querySelector('.snl-text')
      expect(text).not.toBeNull()
      // Whole text content must include the literal characters AND both children.
      const raw = text!.textContent ?? ''
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
      const raw = container.querySelector('.snl-text')?.textContent ?? ''
      // #0 substituted BEFORE 与; #1 substituted AFTER.
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
      // Missing child slot renders as an .snlMissingArg span.
      expect(container.querySelector('.snlMissingArg')).not.toBeNull()
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
      const raw = container.querySelector('.snl-text')?.textContent ?? ''
      expect(raw.startsWith('所有人：')).toBe(true)
      // Children render (each Alice / Bob / Cara appears) and the variadic
      // join literal 、 appears between them.
      expect(raw).toContain('Alice')
      expect(raw).toContain('Bob')
      expect(raw).toContain('Cara')
      expect(raw.split('、').length).toBeGreaterThanOrEqual(3)
    })
  })
})
