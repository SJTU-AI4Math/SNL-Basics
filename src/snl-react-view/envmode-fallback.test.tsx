// @vitest-environment jsdom
//
// Coverage for the 2026-07-04-late render pipeline:
//   * envMode-carrying nodes render via the synthetic-macro path (no macroDb
//     lookup), producing `\text{...}` / raw-LaTeX bodies.
//   * macroDb-miss with `\foo` name → `\operatorname{foo}(...)` applied form
//     or `\mathrm{foo}` leaf form.
//   * macroDb-miss with plain `foo` name → raw `foo(...)` applied form; leaf
//     `foo` (pure-alpha) → bare `foo`; leaf `foo1` → `\mathrm{foo1}` via the
//     existing fallbackLatexSymbol.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import { createMacroTemplateQueryFromDb } from './default-query'
import { createSnlSyntaxTreeNode } from '../snl-syntax-tree/types'
import type { SnlMacroDb } from '../snl-macro/types'
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'

// Empty macroDb + its query — every node is a macroDb-miss by construction.
const emptyDb: SnlMacroDb = {}
const emptyQuery = createMacroTemplateQueryFromDb(emptyDb)

/** Extract the resolved LaTeX from a render via the onResolved callback. */
function collectLatex(tree: SnlSyntaxTree, db: SnlMacroDb): Promise<string> {
  return new Promise<string>((resolve) => {
    const query = createMacroTemplateQueryFromDb(db)
    render(
      <SnlSyntaxTreeView
        tree={tree}
        macroDb={db}
        query={query}
        onResolved={(latex) => resolve(latex)}
      />,
    )
  })
}

afterEach(cleanup)

describe('envMode synthetic-macro path', () => {
  it('%text% root renders as \\text{...} (no macroDb lookup)', async () => {
    const t: SnlSyntaxTree = {
      name: 'hello world',
      envMode: 'text',
      kind: '',
      mdata: null,
      children: [],
    }
    const latex = await collectLatex(t, emptyDb)
    // The root text env wraps its body once — the synthetic path emits
    // `\text{hello world}`, and resolveRootLatex sees envMode is set so it
    // does NOT wrap again.
    expect(latex).toContain('\\text{hello world}')
    // Should NOT be wrapped twice.
    expect(latex).not.toContain('\\text{\\text{')
  })

  it('$latex$ root renders payload as raw LaTeX', async () => {
    const t: SnlSyntaxTree = {
      name: 'x + y',
      envMode: 'formula_inline',
      kind: '',
      mdata: null,
      children: [],
    }
    const latex = await collectLatex(t, emptyDb)
    // Payload IS LaTeX. Auto-wrap adds \htmlData around it.
    expect(latex).toContain('x + y')
    expect(latex).toContain('\\htmlData')
  })

  it('envMode with children appends operator-application form', async () => {
    const t: SnlSyntaxTree = {
      name: 'f',
      envMode: 'formula_inline',
      kind: '',
      mdata: null,
      children: [createSnlSyntaxTreeNode('a', { kind: 'fvar' })],
    }
    const latex = await collectLatex(t, emptyDb)
    expect(latex).toMatch(/f\(.*a.*\)/)
  })
})

describe('macroDb-miss fallback for plain names', () => {
  it('applied `foo(a)` with no db entry renders as `foo(a)` (no \\operatorname)', async () => {
    const t: SnlSyntaxTree = {
      name: 'foo',
      kind: 'fvar',
      mdata: null,
      children: [createSnlSyntaxTreeNode('a', { kind: 'fvar' })],
    }
    const latex = await collectLatex(t, emptyDb)
    expect(latex).not.toContain('\\operatorname')
    expect(latex).toMatch(/foo\(.*a.*\)/)
  })

  it('applied `\\foo(a)` with no db entry renders as \\operatorname{foo}(a)', async () => {
    const t: SnlSyntaxTree = {
      name: '\\foo',
      kind: 'fvar',
      mdata: null,
      children: [createSnlSyntaxTreeNode('a', { kind: 'fvar' })],
    }
    const latex = await collectLatex(t, emptyDb)
    expect(latex).toContain('\\operatorname{foo}')
    expect(latex).toMatch(/\\operatorname\{foo\}\(.*a.*\)/)
  })

  it('leaf `\\i` renders as \\mathrm{i}', async () => {
    const t: SnlSyntaxTree = {
      name: '\\i',
      kind: 'fvar',
      mdata: null,
      children: [],
    }
    const latex = await collectLatex(t, emptyDb)
    expect(latex).toContain('\\mathrm{i}')
  })

  it('leaf `x` (pure alpha) renders as bare `x`', async () => {
    const t: SnlSyntaxTree = {
      name: 'x',
      kind: 'fvar',
      mdata: null,
      children: [],
    }
    const latex = await collectLatex(t, emptyDb)
    // Auto-wrap adds \htmlData(...){x} — so the payload just contains `x`.
    expect(latex).toMatch(/\{x\}/)
  })

  it('waitFor sanity — render commits at least one .katex container', async () => {
    // Sanity check that our fake query pipeline actually finishes.
    const t = createSnlSyntaxTreeNode('x', { kind: 'fvar' })
    const { container } = render(
      <SnlSyntaxTreeView tree={t} macroDb={emptyDb} query={emptyQuery} />,
    )
    await waitFor(() => {
      expect(container.querySelector('.katex')).not.toBeNull()
    })
  })
})

describe('@ binder kind survives the fallback path (2026-07-04-late 猫猫 fix)', () => {
  it('@f(x) → \\htmlData carries kind=binder, NOT overridden to fvar', async () => {
    // Before the fix, the fallback path forced kindOverride='fvar' when
    // wrapping the emitted `f(x)` LaTeX, so a user's `@f(x)` (kind=binder)
    // rendered with data-kind="fvar" — visually indistinguishable from
    // `f(x)`. The fix drops the override so wrapHtmlData falls through to
    // node.kind ('binder' in this case).
    const t: SnlSyntaxTree = {
      name: 'f',
      kind: 'binder',
      mdata: null,
      children: [createSnlSyntaxTreeNode('x', { kind: 'binder' })],
    }
    const latex = await collectLatex(t, emptyDb)
    // The outer wrap for `f` should carry kind=binder.
    expect(latex).toMatch(/\\htmlData\{name=f,kind=binder/)
  })

  it('un-@ f(x) still renders with kind=fvar (default annotate-bind)', async () => {
    const t: SnlSyntaxTree = {
      name: 'f',
      kind: 'fvar',
      mdata: null,
      children: [createSnlSyntaxTreeNode('x', { kind: 'fvar' })],
    }
    const latex = await collectLatex(t, emptyDb)
    expect(latex).toMatch(/\\htmlData\{name=f,kind=fvar/)
  })
})
