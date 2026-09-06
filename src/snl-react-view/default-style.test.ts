import { describe, expect, it } from 'vitest'
import type { SnlMacro } from '../snl-macro/types'
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'
import { resolveStyle, resolveRootLatex } from './render-source'
import { parseSnlSyntaxTree } from '../snl-syntax-tree/parser'
import { MacroDataDriver } from '../snl-macro/macro-data-driver'
import { serializeSnlSyntaxTree } from './serialize'

function macro(): SnlMacro {
  return {
    name: 'Example.macro',
    description: '',
    source: { entries: [], urls: [] },
    dynamic_arity: false,
    styles: [
      { style_name: 'first',  template: { mode: 'formula_inline', body: 'FIRST' }, tags: [] },
      { style_name: 'other',  template: { mode: 'text', body: 'OTHER' }, tags: [] },
    ],
    tags: [],
  }
}

const implicitNode: SnlSyntaxTree = {
  macro_name: 'Example.macro',
  kind: '',
  mdata: null,
  children: [],
}

function selectionMacro(): SnlMacro {
  return { ...macro(), styles: [
    { style_name: 'full', tags: [], template: { mode: 'formula_inline', body: '#0 : #1 = #2' } },
    { style_name: 'body', tags: [], template: { mode: 'text', body: 'BODY #0 = #2' } },
  ] }
}

describe('automatic filled-slot style selection', () => {
  it('matches the exact filled positions in a shared pure renderer without rewriting source', async () => {
    const data = selectionMacro()
    const tree = parseSnlSyntaxTree('Example.macro(x,,y)')
    const before = serializeSnlSyntaxTree(tree)
    expect(resolveStyle(tree, data).style_name).toBe('body')
    const driver = new MacroDataDriver({ queries: { query_macro: async ({ macro_name }) => macro_name === data.name ? data : null } })
    const latex = await resolveRootLatex(tree, driver)
    expect(latex).toContain('BODY')
    expect(latex).not.toContain('snlArgPlaceholder')
    expect(serializeSnlSyntaxTree(tree)).toBe(before)
    expect(tree.style_name).toBeUndefined()
  })
})

describe('automatic selection boundaries', () => {
  it.each([
    ['Example.macro(x,T,y)', '#0 = #2', 'full'],
    ['Example.macro(x,,y)', '#0', 'full'],
    ['Example.macro(x)', '#0', 'body'],
    ['Example.macro(x,)', '#0', 'body'],
    ['Example.macro(x,%%)', '#0', 'full'],
    ['Example.macro(x,,y)', '#2 + #2 + #00', 'body'],
    ['Example.macro(,x)', '#01', 'body'],
    ['Example.macro(,x)', '\\#0 #1', 'body'],
    ['Example.macro(,)', 'constant', 'body'],
  ])('resolves %s using exact slots in %s', (source, body, expected) => {
    const data = selectionMacro()
    data.styles[1].template = { mode: 'text', body }
    expect(resolveStyle(parseSnlSyntaxTree(source), data).style_name).toBe(expected)
  })

  it('preserves ordered ties, explicit overrides and their errors', () => {
    const data = selectionMacro()
    data.styles.push({ ...data.styles[1], style_name: 'later' })
    const tree = parseSnlSyntaxTree('Example.macro(x,,y)')
    expect(resolveStyle(tree, data).style_name).toBe('body')
    expect(resolveStyle({ ...tree, style_name: 'full' }, data).style_name).toBe('full')
    for (const style_name of ['', 'missing']) {
      expect(() => resolveStyle({ ...tree, style_name }, data)).toThrow(/unknown style/)
    }
  })

  it('includes every filled slot, distinguishes sparse holes, and handles slot 99', () => {
    const data = selectionMacro()
    const tree = parseSnlSyntaxTree('Example.macro(x,,y)')
    delete tree.children[1]
    expect(resolveStyle(tree, data).style_name).toBe('body')
    data.styles[1].template = { mode: 'formula_inline', body: '#99' }
    tree.children = []
    tree.children[99] = parseSnlSyntaxTree('x')
    expect(resolveStyle(tree, data).style_name).toBe('body')
    tree.children[100] = parseSnlSyntaxTree('z')
    expect(resolveStyle(tree, data).style_name).toBe('full')
  })

  it('validates all templates before selection, including malformed unselected styles', () => {
    const data = selectionMacro()
    data.styles.push({ style_name: 'bad', tags: [], template: { mode: 'text', body: '#100' } })
    expect(() => resolveStyle(parseSnlSyntaxTree('Example.macro(x,,y)'), data)).toThrow(/malformed/)
  })

  it('requires identical exact usage across every language, not identical maximum arity', () => {
    const data = selectionMacro()
    const tree = parseSnlSyntaxTree('Example.macro(x,,y)')
    const values = {
      en: { mode: 'text' as const, body: 'BODY #0 #2' },
      zh: { mode: 'formula_display' as const, body: '#2 = #0' },
    }
    data.styles[1].template = { type: 'i18n', default_language: 'en', values }
    for (const language of ['en', 'zh', 'missing']) expect(resolveStyle(tree, data, language).style_name).toBe('body')
    values.zh.body = '#0 #1 #2'
    for (const language of ['en', 'zh', 'missing']) expect(resolveStyle(tree, data, language).style_name).toBe('full')
  })

  it.each(['block', 'opaque', 'localized-block', 'localized-opaque', 'empty-text'])('does not infer %s operand use', kind => {
    const data = selectionMacro()
    let tree = parseSnlSyntaxTree('Example.macro(x,,y)')
    const clean = { mode: 'text' as const, body: '#0 #2' }
    if (kind === 'block') data.styles[1].template = { mode: 'block', body: '#0 #2', block_template_name: 'custom' }
    if (kind === 'opaque') data.styles[1].template = { ...clean, latex: '' }
    if (kind === 'localized-block') data.styles[1].template = { type: 'i18n', default_language: 'en', values: { en: clean, zh: { mode: 'block', body: '#0 #2' } } }
    if (kind === 'localized-opaque') data.styles[1].template = { type: 'i18n', default_language: 'en', values: { en: clean, zh: { ...clean, future_backend: {} } } }
    if (kind === 'empty-text') {
      data.styles[1].template = { mode: 'text', body: '' }
      tree = parseSnlSyntaxTree('Example.macro(,)')
    }
    expect(resolveStyle(tree, data, 'en').style_name).toBe('full')
    expect(resolveStyle({ ...tree, style_name: 'body' }, data, 'en').style_name).toBe('body')
    data.styles.push({ style_name: 'eligible', tags: [], template: kind === 'empty-text' ? { mode: 'text', body: 'constant' } : clean })
    expect(resolveStyle(tree, data, 'en').style_name).toBe('eligible')
  })

  it('preserves dynamic and legacy-map paths, including empty maps and unknown mapped names', () => {
    const data = selectionMacro()
    const tree = parseSnlSyntaxTree('Example.macro(x,,y)')
    for (const default_style of [{}, { en: 'full' }, { en: 'full', zh: 'body' }] as Record<string, string>[]) {
      const legacy = { ...data, default_style }
      expect(resolveStyle(tree, legacy, 'en').style_name).toBe('full')
      expect(resolveStyle({ ...tree, style_name: 'body' }, legacy).style_name).toBe('body')
    }
    expect(() => resolveStyle(tree, { ...data, default_style: { en: 'missing' } })).toThrow(/unknown style/)
    data.dynamic_arity = true
    for (const style of data.styles) style.template = { mode: 'text', body: '#*' }
    expect(resolveStyle(tree, data).style_name).toBe('full')
  })

  it('does not mutate frozen trees, bindings or a shared cached Macro', async () => {
    const freeze = <T>(value: T): T => {
      if (value && typeof value === 'object') {
        Object.values(value).forEach(freeze)
        Object.freeze(value)
      }
      return value
    }
    const data = freeze(selectionMacro())
    const tree = freeze(parseSnlSyntaxTree('Example.macro(@x,,x@x)'))
    const snapshot = JSON.stringify(tree)
    const requests: unknown[] = []
    const driver = new MacroDataDriver({ queries: { query_macro: async args => {
      requests.push(args)
      return args.macro_name === data.name ? data : null
    } } })
    const cached = await driver.query_macro({ macro_name: data.name })
    expect(resolveStyle(tree, cached!).style_name).toBe('body')
    expect(resolveStyle(parseSnlSyntaxTree('Example.macro(x,T,y)'), cached!).style_name).toBe('full')
    expect(await driver.query_macro({ macro_name: data.name })).toBe(cached)
    expect(requests).toEqual([{ macro_name: data.name, signal: undefined }])
    expect(JSON.stringify(tree)).toBe(snapshot)
  })
})

describe('implicit default style', () => {
  it('uses styles[0] to break an implicit exact-slot tie', () => {
    expect(resolveStyle(implicitNode, macro(), 'zh-CN').style_name).toBe('first')
    expect(resolveStyle(implicitNode, macro(), 'en').style_name).toBe('first')
  })

  it('honors a legacy 0.1.5 default_style map without weakening explicit selection', () => {
    const legacy = { ...macro(), default_style: { en: 'first', 'zh-CN': 'other' } }
    expect(resolveStyle(implicitNode, legacy, 'zh-CN').style_name).toBe('other')
    expect(resolveStyle(implicitNode, legacy, 'fr').style_name).toBe('first')
    expect(resolveStyle({ ...implicitNode, style_name: 'first' }, legacy, 'zh-CN').style_name).toBe('first')
  })

  it('ignores inherited prototype names in a legacy default_style map', () => {
    const legacy = { ...macro(), default_style: { en: 'first' } }
    for (const language of ['toString', 'constructor', '__proto__']) {
      expect(resolveStyle(implicitNode, legacy, language).style_name).toBe('first')
    }
  })

  it('keeps an explicit [style] authoritative', () => {
    const explicitNode = { ...implicitNode, style_name: 'other' }
    expect(resolveStyle(explicitNode, macro(), 'zh-CN').style_name).toBe('other')
  })

  it('reports an explicit style name that does not exist', () => {
    const explicitNode = { ...implicitNode, style_name: 'missing' }
    expect(() => resolveStyle(explicitNode, macro(), 'en'))
      .toThrow(/unknown style.*missing.*Example\.macro/i)
  })
})
