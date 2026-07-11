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
  it('%text% root renders as native React text (no macroDb lookup)', async () => {
    // Cat 2026-07-10 refactor: text roots via React TextRun, not KaTeX \\text{...}.
    // onResolved is KaTeX-only, so assert on the DOM.
    const t: SnlSyntaxTree = {
      name: 'hello world',
      envMode: 'text',
      kind: '',
      mdata: null,
      children: [],
    }
    const { container } = render(
      <SnlSyntaxTreeView tree={t} macroDb={emptyDb} query={emptyQuery} />,
    )
    await waitFor(() => {
      const text = container.querySelector('.snl-text')
      expect(text).not.toBeNull()
      expect(text!.textContent).toBe('hello world')
    })
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

  it('envMode payload without #N drops children silently (per 猫猫 spec)', async () => {
    // `@$f$(x)` — payload has no `#N`, so `x` is silently NOT rendered
    // (though it stays in the tree for scoping). Result: just "f" (as
    // raw LaTeX, wrapped in \htmlData).
    const t: SnlSyntaxTree = {
      name: 'f',
      envMode: 'formula_inline',
      kind: '',
      mdata: null,
      children: [createSnlSyntaxTreeNode('a', { kind: 'fvar' })],
    }
    const latex = await collectLatex(t, emptyDb)
    // The literal `a` should NOT appear in the output as a rendered atom.
    // (The `a` variable name IS in the \htmlData wrap around any
    // rendering — that's tree metadata, not visible LaTeX. So we check
    // that the payload after the outer \htmlData opening brace is just
    // 'f' — no application parens, no `a`.)
    // Loose check: no `(` immediately after the payload.
    expect(latex).not.toMatch(/\{f\(a\)\}/)
    expect(latex).toMatch(/\{f\}/)
  })

  it('envMode payload WITH #0 splices child into that slot', async () => {
    // `@$\operatorname{Im}(#0)$(x)` — payload has `#0`, so `x` gets
    // inlined. Result: `\operatorname{Im}(x)`.
    const t: SnlSyntaxTree = {
      name: '\\operatorname{Im}(#0)',
      envMode: 'formula_inline',
      kind: '',
      mdata: null,
      children: [createSnlSyntaxTreeNode('x', { kind: 'fvar' })],
    }
    const latex = await collectLatex(t, emptyDb)
    expect(latex).toContain('\\operatorname{Im}')
    // The child `x` must be substituted inside the parens.
    expect(latex).toMatch(/\\operatorname\{Im\}\(.*x.*\)/)
  })

  it('%text with #0% splices child', async () => {
    const t: SnlSyntaxTree = {
      name: 'hello #0',
      envMode: 'text',
      kind: '',
      mdata: null,
      children: [createSnlSyntaxTreeNode('name', { kind: 'fvar' })],
    }
    const { container } = render(
      <SnlSyntaxTreeView tree={t} macroDb={emptyDb} query={emptyQuery} />,
    )
    await waitFor(() => {
      const root = container.querySelector('.snl-text')
      expect(root).not.toBeNull()
      expect(root!.textContent).toContain('hello ')
      // The `name` child is a bare identifier → formula-mode → KaTeX
      // renders it async. Assert on the presence of a MathSpan inside
      // instead of chasing the KaTeX output timing.
      expect(root!.querySelector('.snl-math-span')).not.toBeNull()
    })
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
