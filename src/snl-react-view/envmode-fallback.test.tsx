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

import { createSnlSyntaxTreeNode } from '../snl-syntax-tree/types'
import { parseSnlSyntaxTree } from '../snl-syntax-tree/parser'
import type { SnlMacroRecord } from '../snl-macro/types'
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'
import { testDriver } from '../snl-react-view/test-helpers'

// Empty macroDb + its query — every node is a macroDb-miss by construction.
const emptyDb: SnlMacroRecord = {}


/** Extract the resolved LaTeX from a render via the onResolved callback. */
function collectLatex(tree: SnlSyntaxTree, db: SnlMacroRecord): Promise<string> {
  return new Promise<string>((resolve) => {
    render(
      <SnlSyntaxTreeView
        tree={tree} macro_data_driver={testDriver(db)}
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
      macro_name: '#',
      temporary_source: 'hello world',
      env_mode: 'text',
      kind: '',
      mdata: null,
      children: [],
    }
    const { container } = render(
      <SnlSyntaxTreeView tree={t} macro_data_driver={testDriver(emptyDb)} />,
    )
    await waitFor(() => {
      expect(container.querySelector('.katex-html.snl-text')?.textContent).toBe('hello world')
    })
  })

  it('$latex$ root renders payload as raw LaTeX', async () => {
    const t: SnlSyntaxTree = {
      macro_name: '#',
      temporary_source: 'x + y',
      env_mode: 'formula_inline',
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
      macro_name: '#',
      temporary_source: 'f',
      env_mode: 'formula_inline',
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
      macro_name: '#',
      temporary_source: '\\operatorname{Im}(#0)',
      env_mode: 'formula_inline',
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
      macro_name: '#',
      temporary_source: 'hello #0',
      env_mode: 'text',
      kind: '',
      mdata: null,
      children: [createSnlSyntaxTreeNode('name', { kind: 'fvar' })],
    }
    const { container } = render(
      <SnlSyntaxTreeView tree={t} macro_data_driver={testDriver(emptyDb)} />,
    )
    await waitFor(() => {
      const root = container.querySelector('.katex-html')
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
      macro_name: 'foo',
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
      macro_name: '\\foo',
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
      macro_name: '\\i',
      kind: 'fvar',
      mdata: null,
      children: [],
    }
    const latex = await collectLatex(t, emptyDb)
    expect(latex).toContain('\\mathrm{i}')
  })

  it('leaf `x` (pure alpha) renders as bare `x`', async () => {
    const t: SnlSyntaxTree = {
      macro_name: 'x',
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
      <SnlSyntaxTreeView tree={t} macro_data_driver={testDriver(emptyDb)} />,
    )
    await waitFor(() => {
      expect(container.querySelector('.katex')).not.toBeNull()
    })
  })
})

describe('leaf binder fallback', () => {
  it('@f carries kind=binder without recursive binder children', async () => {
    const t = parseSnlSyntaxTree('@f')
    const latex = await collectLatex(t, emptyDb)
    expect(latex).toMatch(/\\htmlData\{name=f,kind=binder/)
  })

  it('un-@ f(x) still renders with kind=fvar (default annotate-bind)', async () => {
    const t: SnlSyntaxTree = {
      macro_name: 'f',
      kind: 'fvar',
      mdata: null,
      children: [createSnlSyntaxTreeNode('x', { kind: 'fvar' })],
    }
    const latex = await collectLatex(t, emptyDb)
    expect(latex).toMatch(/\\htmlData\{name=f,kind=fvar/)
  })
})
