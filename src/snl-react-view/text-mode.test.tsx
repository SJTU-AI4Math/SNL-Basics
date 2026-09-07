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
import { serializeSnlSyntaxTree } from './serialize'
import { automaticStyleFixture, automaticStyleText } from '../../test-fixtures/root-text-typography/automatic-style'


describe('native text separators share literal-run processing', () => {
  it.each(['\n', '\r\n', '\r', '\n\n'])('materializes authored breaks in a #* separator (%j)', async (sep) => {
    const macro: SnlMacro = { ...listAllPeople, name: 'Breaks', kind: 'const', styles: [
      { style_name: 'default', tags: [], template: { mode: 'text', body: 'HEADER #* END', separator: sep } },
    ] }
    const tree = parseSnlSyntaxTree('Breaks(%first%,%second%,%third%)')
    const original = JSON.stringify(tree)
    const { container } = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver({ Breaks: macro })} />)
    await waitFor(() => expect(container.querySelector('.snl-text[data-name="Breaks"]')).not.toBeNull())
    const target = container.querySelector('.snl-text[data-name="Breaks"]')!
    expect(target.querySelectorAll('br')).toHaveLength(2 * (sep.match(/\r\n?|\n/g)?.length ?? 0))
    expect(target.textContent).toBe('HEADER firstsecondthird END')
    expect(JSON.stringify(tree)).toBe(original)
    expect(macro.styles[0].template).toEqual({ mode: 'text', body: 'HEADER #* END', separator: sep })
  })

  it.each(['', '#*'])('keeps empty-template and #* joining equivalent for authored separators (body %j)', async (body) => {
    const macro: SnlMacro = { ...listAllPeople, name: 'Breaks', kind: 'const', dynamic_arity: body === '#*', styles: [
      { style_name: 'default', tags: [], template: { mode: 'text', body, separator: '\n\n' } },
    ] }
    const { container } = render(<SnlSyntaxTreeView tree={parseSnlSyntaxTree('Breaks(%first%,%second%)')} macro_data_driver={testDriver({ Breaks: macro })} />)
    await waitFor(() => expect(container.querySelector('.snl-text[data-name="Breaks"]')).not.toBeNull())
    expect(container.querySelectorAll('br')).toHaveLength(2)
    expect(container.querySelector('.snl-text[data-name="Breaks"]')?.textContent).toBe('firstsecond')
  })

  it('retains blank lines next to slots and renders separator math as a math island', async () => {
    const macro: SnlMacro = { ...listAllPeople, name: 'Breaks', kind: 'const', styles: [
      { style_name: 'default', tags: [], template: { mode: 'text', body: 'HEADER\n\n#*\nEND', separator: '\n$x$\n' } },
    ] }
    const { container } = render(<SnlSyntaxTreeView tree={parseSnlSyntaxTree('Breaks(%first%,%second%)')} macro_data_driver={testDriver({ Breaks: macro })} />)
    await waitFor(() => expect(container.querySelector('.snl-text[data-name="Breaks"]')).not.toBeNull())
    expect(container.querySelectorAll('br')).toHaveLength(5)
    expect(container.querySelector('.snl-math-span .katex-html')?.textContent).toBe('x')
    expect(container.querySelector('.katex-error')).toBeNull()
  })
})

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

describe('automatic Style real-component integration', () => {
  it('keeps an unknown explicit selector as a visible error and recovers without contaminating the shared Macro', async () => {
    const f = automaticStyleFixture()
    const bad = parseSnlSyntaxTree('AutoStyle[missing](@x,,x@x)')
    const before = JSON.stringify(bad)
    const pair = (tree: SnlSyntaxTree) => <>
      <section data-case="bad"><SnlSyntaxTreeView tree={tree} macro_data_driver={f.driver} reader_runtime={f.runtime} /></section>
      <section data-case="good"><SnlSyntaxTreeView tree={f.body} macro_data_driver={f.driver} reader_runtime={f.runtime} /></section>
    </>
    const view = render(pair(f.body))
    await waitFor(() => expect(automaticStyleText(view.container.querySelector('[data-case="bad"]')!)).toBe('BODY x = x'))
    view.rerender(pair(bad))
    await waitFor(() => {
      const broken = view.container.querySelector('[data-case="bad"]')!
      expect(broken.querySelector('.katex-error')?.textContent ?? '').toContain('unknown style "missing"')
      expect(broken.textContent).not.toContain('BODY x')
      expect(broken.textContent).not.toContain('FULL x')
      expect(automaticStyleText(view.container.querySelector('[data-case="good"]')!)).toBe('BODY x = x')
    })
    expect(JSON.stringify(bad)).toBe(before)
    view.rerender(pair(f.explicit))
    await waitFor(() => expect(automaticStyleText(view.container.querySelector('[data-case="bad"]')!)).toBe('FULL x : 1 = x'))
    view.rerender(pair(f.body))
    await waitFor(() => expect(automaticStyleText(view.container.querySelector('[data-case="bad"]')!)).toBe('BODY x = x'))
    expect(view.container.querySelector('.katex-error')).toBeNull()
  })

  it('selects per-node slots through one cached Macro across rerenders, languages and explicit overrides without rewriting bindings', async () => {
    const f = automaticStyleFixture()
    const cachedMacro = await f.driver.query_macro({ macro_name: f.macro.name })
    const trees = [f.body, f.full, f.explicit]
    const before = JSON.stringify(trees)
    const serialized = trees.map(serializeSnlSyntaxTree)
    const macroBefore = JSON.stringify(f.macro)
    const pair = (tree: SnlSyntaxTree) => <>
      <section data-case="changing"><SnlSyntaxTreeView tree={tree} macro_data_driver={f.driver} reader_runtime={f.runtime} /></section>
      <section data-case="full"><SnlSyntaxTreeView tree={f.full} macro_data_driver={f.driver} reader_runtime={f.runtime} /></section>
    </>
    const view = render(pair(f.body))
    for (const [tree, language, expected] of [
      [f.body, 'en', 'BODY x = x'],
      [f.full, 'en', 'FULL x : T = x'],
      [f.body, 'en', 'BODY x = x'],
      [f.body, 'zh', '正文 x = x'],
      [f.explicit, 'zh', 'FULL x : 1 = x'],
    ] as const) {
      f.setLanguage(language)
      view.rerender(pair(tree))
      await waitFor(() => {
        const changing = view.container.querySelector<HTMLElement>('[data-case="changing"]')!
        expect(automaticStyleText(changing)).toBe(expected)
        expect(automaticStyleText(view.container.querySelector<HTMLElement>('[data-case="full"]')!)).toBe('FULL x : T = x')
        expect(changing.querySelector('[data-tree-path="0"]')?.getAttribute('data-kind')).toBe('binder')
        expect(changing.querySelector('[data-tree-path="2"]')?.getAttribute('data-kind')).toBe('bvar')
        expect(changing.querySelector('[data-tree-path="2"]')?.getAttribute('data-src')).toBe('x')
        const paths = [...changing.querySelectorAll('[data-tree-path]')].map(node => node.getAttribute('data-tree-path'))
        expect(paths.indexOf('2') < paths.indexOf('0')).toBe(language === 'zh' && tree !== f.explicit)
        expect(changing.querySelector('.katex-error')).toBeNull()
      })
    }
    expect(await f.driver.query_macro({ macro_name: f.macro.name })).toBe(cachedMacro)
    expect(f.requests()).toBe(1)
    expect(JSON.stringify(f.macro)).toBe(macroBefore)
    expect(JSON.stringify(trees)).toBe(before)
    expect(trees.map(serializeSnlSyntaxTree)).toEqual(serialized)
    expect(f.body.style_name).toBeUndefined()
    expect(f.full.style_name).toBeUndefined()
  })

  it.each(['text', 'formula_inline', 'block'] as const)('rejects an unknown explicit descendant under a %s parent', async (mode) => {
    const f = automaticStyleFixture()
    const driver = testDriver({
      AutoStyle: f.macro,
      Wrapper: {
        name: 'Wrapper', description: '', source: { entries: [], urls: [] }, tags: [],
        dynamic_arity: mode === 'block',
        styles: [{ style_name: 'default', tags: [], template: mode === 'block'
          ? { mode, body: '#*', block_template_name: 'enumerate' }
          : { mode, body: '#0' } }],
      },
    })
    const tree = parseSnlSyntaxTree('Wrapper(AutoStyle[missing](@x,,x@x))')
    const before = JSON.stringify(tree)
    const view = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={driver} />)
    await waitFor(() => expect(view.container.querySelector('.katex-error')?.textContent ?? '').toContain('unknown style "missing"'))
    expect(view.container.textContent).not.toContain('BODY x')
    expect(JSON.stringify(tree)).toBe(before)
  })

  it('dispatches an inferred formula_display Style through real KaTeX, retaining canonical binding paths', async () => {
    const f = automaticStyleFixture(true)
    const before = serializeSnlSyntaxTree(f.body)
    const view = render(<SnlSyntaxTreeView tree={f.body} macro_data_driver={f.driver} reader_runtime={f.runtime} />)
    await waitFor(() => {
      expect(view.container.querySelector('.katex-display .katex-html')?.textContent).toContain('BODY')
      expect(view.container.querySelector('.katex-error')).toBeNull()
      expect(view.container.querySelector('[data-tree-path="0"]')?.getAttribute('data-kind')).toBe('binder')
      expect(view.container.querySelector('[data-tree-path="2"]')?.getAttribute('data-kind')).toBe('bvar')
    })
    expect(serializeSnlSyntaxTree(f.body)).toBe(before)
    expect(f.body.style_name).toBeUndefined()
  })
})

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
      expect(container.querySelector('.katex-html.snl-text')).not.toBeNull()
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
