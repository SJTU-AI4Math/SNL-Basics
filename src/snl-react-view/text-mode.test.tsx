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
import { ReaderRuntime } from '../runtime'
import { parseSnlSyntaxTree } from '../snl-syntax-tree/parser'

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
    { style_name: 'infix',  template: { mode: 'formula_inline', body: '#0 = #1' }, tags: [] },
    { style_name: 'prose',  template: { mode: 'text', body: '#0 与 #1 相等' }, tags: [] },
  ],
}

const listAllPeople: SnlMacro = {
  name: 'ListPeople.all', description: 'list all people, comma-separated',
  source: { entries: [], urls: [] },
  dynamic_arity: true,
  tags: [],
  styles: [
    { style_name: 'default',  template: { mode: 'text', body: '所有人：#*', separator: '、' },  tags: [] },
  ],
}

const interfaceMacro: SnlMacro = {
  name: 'interface', description: 'interface documentation block',
  source: { entries: [], urls: [] },
  kind: 'const',
  dynamic_arity: false,
  tags: [],
  styles: [
    {
      style_name: 'default',

      template: { mode: 'text', body: 'interface #0 consists of the following data:\n#1' },
      tags: [],
    },
  ],
}

const enumerateMacro: SnlMacro = {
  name: 'enumerate', description: 'ordered sub block',
  source: { entries: [], urls: [] },
  kind: 'sub',
  dynamic_arity: true,
  tags: [],
  styles: [
    {
      style_name: 'default',

      template: { mode: 'block', body: '#*', block_template_name: 'enumerate' },

      tags: [],
    },
  ],
}

const db: SnlMacroRecord = {
  'Eq.eq': eqDualMode,
  'ListPeople.all': listAllPeople,
  interface: interfaceMacro,
  enumerate: enumerateMacro,
}

afterEach(cleanup)

/** Grab the text content of the panel (works for React TextRun and KaTeX). */
function panelText(container: HTMLElement): string {
  return container.querySelector('.katex-html')?.textContent ?? ''
}

describe('text-mode template splicing (regression)', () => {
  it('renders a root temporary text payload like a text Macro while remaining bare sub HTML', async () => {
    const temporary = parseSnlSyntaxTree('%$x$ is a number%')
    const { container } = render(
      <SnlSyntaxTreeView tree={temporary} macro_data_driver={testDriver(db)} />,
    )

    await waitFor(() => {
      expect(container.querySelector('.snl-math-span .katex')).not.toBeNull()
      expect(container.textContent).toContain('x')
      expect(container.textContent).toContain(' is a number')
      expect(container.querySelector('[data-name="#"]')).toBeNull()
      expect(container.querySelector('[data-kind="sub"]')).toBeNull()
    })
  })

  it('renders backtick sugar through formula-inline texttt without adding a mode', async () => {
    const temporary = parseSnlSyntaxTree('`a_b`')
    let latex = ''
    const { container } = render(
      <SnlSyntaxTreeView
        tree={temporary}
        macro_data_driver={testDriver(db)}
        onResolved={(value) => { latex = value }}
      />,
    )
    await waitFor(() => {
      expect(container.querySelector('.katex-error')).toBeNull()
      expect(latex).toContain('\\texttt{a\\_b}')
    })
  })

  it('selects the current language projection inside the implicit first style', async () => {
    const localized: SnlMacro = {
      ...eqDualMode,
      styles: [{
        style_name: 'prose',
        template: {
          type: 'i18n',
          default_language: 'en',
          values: {
            en: { mode: 'text', body: '#0 equals #1' },
            'zh-CN': { mode: 'text', body: '#0 等于 #1' },
          },
        },
        tags: [],
      }],
    }
    const tree = createSnlSyntaxTreeNode('Eq.eq', { children: [leaf('a'), leaf('b')] })
    const runtime = new ReaderRuntime({
      queries: { query_environment: () => ({ language: 'zh-CN' }) },
    })
    const { container } = render(
      <SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver({ 'Eq.eq': localized })} reader_runtime={runtime} />,
    )
    await waitFor(() => expect(panelText(container)).toContain('a 等于 b'))
  })

  it('samples one language for every text node in a React render tree', async () => {
    let reads = 0
    const localizedStyle = (en: string, zh: string) => ({
      style_name: 'default',
      template: {
        type: 'i18n' as const,
        default_language: 'en',
        values: {
          en: { mode: 'text' as const, body: en },
          'zh-CN': { mode: 'text' as const, body: zh },
        },
      },
      tags: [],
    })
    const macros: SnlMacroRecord = {
      Parent: {
        name: 'Parent', description: '', source: { entries: [], urls: [] },
        dynamic_arity: false, tags: [], styles: [localizedStyle('EN(#0)', 'ZH(#0)')],
      },
      Child: {
        name: 'Child', description: '', source: { entries: [], urls: [] },
        dynamic_arity: false, tags: [], styles: [localizedStyle('EN_CHILD', 'ZH_CHILD')],
      },
    }
    const runtime = new ReaderRuntime({
      queries: { query_environment: () => ({ language: reads++ % 2 === 0 ? 'en' : 'zh-CN' }) },
    })
    const tree = createSnlSyntaxTreeNode('Parent', {
      children: [createSnlSyntaxTreeNode('Child')],
    })
    const { container } = render(
      <SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(macros)} reader_runtime={runtime} />,
    )
    await waitFor(() => {
      const text = container.querySelector('.katex-html')?.textContent ?? ''
      expect(text === 'EN(EN_CHILD)' || text === 'ZH(ZH_CHILD)').toBe(true)
    })
    const text = container.querySelector('.katex-html')?.textContent ?? ''
    expect(text).not.toMatch(/EN\(ZH_CHILD\)|ZH\(EN_CHILD\)/)
  })

  it.each(['formula_inline', 'block'] as const)(
    'surfaces malformed whole-template localization near %s data',
    async (mode) => {
      const malformed = {
        name: 'Malformed', description: '', source: { entries: [], urls: [] },
        dynamic_arity: false, tags: [],
        styles: [{
          style_name: 'default',
          template: { type: 'i18n', default_language: 'en', values: { en: 'bad' } },
          tags: [],
        }],
      } as unknown as SnlMacro
      const macros: SnlMacroRecord = mode === 'formula_inline'
        ? {
            Parent: {
              name: 'Parent', description: '', source: { entries: [], urls: [] },
              dynamic_arity: false, tags: [],
              styles: [{ style_name: 'default',  template: { mode: 'text', body: '#0' }, tags: [] }],
            },
            Malformed: malformed,
          }
        : { Malformed: malformed }
      const tree = mode === 'formula_inline'
        ? createSnlSyntaxTreeNode('Parent', { children: [createSnlSyntaxTreeNode('Malformed')] })
        : createSnlSyntaxTreeNode('Malformed')
      const { container } = render(
        <SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(macros)} />,
      )
      await waitFor(() => {
        const error = container.querySelector('.katex-error')
        expect(error?.textContent).toMatch(/template projection/)
      })
    },
  )

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

  it('preserves a literal newline and keeps enumerate sub metadata-transparent', async () => {
    const fields = createSnlSyntaxTreeNode('enumerate', {
      children: [leaf('name'), leaf('kind')],
    })
    const tree = createSnlSyntaxTreeNode('interface', {
      children: [leaf('SnlMacro'), fields],
    })
    const { container } = render(
      <SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} />,
    )
    await waitFor(() => {
      const root = container.querySelector('.snl-text[data-name="interface"]')
      const lineBreak = root?.querySelector('br')
      const enumerateHost = root?.querySelector<HTMLElement>('.snl-block-host')
      expect(lineBreak).not.toBeNull()
      expect(enumerateHost).not.toBeNull()
      expect(enumerateHost?.dataset.name).toBeUndefined()
      expect(enumerateHost?.dataset.kind).toBeUndefined()
      expect(lineBreak!.compareDocumentPosition(enumerateHost!)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      )
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
