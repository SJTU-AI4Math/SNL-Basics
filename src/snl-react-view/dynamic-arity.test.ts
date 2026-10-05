import { describe, expect, it } from 'vitest'
import { resolveRootLatex, resolveStyle, resolve_style_template } from './render-source'
import { isMacroDocumentV11 } from '../schema/migrate-macro'
import { ReaderRuntime } from '../runtime'
import { testDriver } from './test-helpers'
import { createSnlSyntaxTreeNode } from '../snl-syntax-tree/types'
import type { SnlMacroRecord } from '../snl-macro/types'

describe('dynamic #* + separator expansion', () => {
  const db: SnlMacroRecord = {
    join_comma: {
      name: 'join_comma',
      description: 'Join with comma',
      source: { entries: [], urls: [] },
      dynamic_arity: true,
      tags: [],
      styles: [{ style_name: 'default',  template: { mode: 'formula_inline', body: '#*', separator: ', ' },  tags: [] }],
    },
    wrap_braces: {
      name: 'wrap_braces',
      description: 'Wrap in braces with semicolons',
      source: { entries: [], urls: [] },
      dynamic_arity: true,
      tags: [],
      styles: [{ style_name: 'default',  template: { mode: 'formula_inline', body: '\\{#*\\}', separator: '; ' },  tags: [] }],
    },
    no_sep: {
      name: 'no_sep',
      description: 'Dynamic arity with no separator (default comma)',
      source: { entries: [], urls: [] },
      dynamic_arity: true,
      tags: [],
      styles: [{ style_name: 'default',  template: { mode: 'formula_inline', body: '#*' }, tags: [] }],
    },
  }
  const driver = testDriver(db)

  it('accepts literal default and explicit dynamic styles without consuming tree arguments', async () => {
    const macro: SnlMacroRecord[string] = {
      name: 'literal', description: '', kind: 'const', source: { entries: [], urls: [] },
      dynamic_arity: true, tags: [], styles: [
        { style_name: 'default', tags: [], template: { mode: 'formula_inline', body: '\\mathrm{literal}' } },
        { style_name: 'name', tags: [], template: { mode: 'formula_inline', body: '\\mathrm{name}' } },
        { style_name: 'list', tags: [], template: { mode: 'formula_inline', body: '[#*]', separator: '; ' } },
      ],
    }
    expect(isMacroDocumentV11({ literal: macro })).toBe(true)
    const literalDriver = testDriver({ literal: macro })
    for (const children of [[], [createSnlSyntaxTreeNode('x'), createSnlSyntaxTreeNode('y')]]) {
      for (const [style_name, body] of [[undefined, '\\mathrm{literal}'], ['name', '\\mathrm{name}']] as const) {
        const tree = { ...createSnlSyntaxTreeNode('literal', { children }), style_name }
        expect(resolveStyle(tree, macro).style_name).toBe(style_name ?? 'default')
        const rendered = await resolveRootLatex(tree, literalDriver)
        expect(rendered).toContain(body)
        expect(rendered).not.toContain('{x}')
        expect(rendered).not.toContain('{y}')
        expect(tree.children).toEqual(children)
      }
    }
    const list = await resolveRootLatex({ ...createSnlSyntaxTreeNode('literal', {
      children: [createSnlSyntaxTreeNode('x'), createSnlSyntaxTreeNode('y')],
    }), style_name: 'list' }, literalDriver)
    expect(list).toContain('{x}')
    expect(list).toContain('{y}')
    expect(list).toContain('; ')
  })

  it('accepts localized literal projections and rejects positional dynamic or variadic fixed templates', async () => {
    const macro: SnlMacroRecord[string] = {
      name: 'localizedLiteral', description: '', kind: 'const', source: { entries: [], urls: [] },
      dynamic_arity: true, tags: [], styles: [
        { style_name: 'default', tags: [], template: {
          type: 'i18n', default_language: 'en', values: {
            en: { mode: 'formula_inline', body: '\\mathrm{English}' },
            'zh-CN': { mode: 'formula_inline', body: '\\mathrm{Chinese}' },
          },
        } },
        { style_name: 'list', tags: [], template: { mode: 'formula_inline', body: '#*' } },
      ],
    }
    expect(isMacroDocumentV11({ localizedLiteral: macro })).toBe(true)
    const tree = createSnlSyntaxTreeNode('localizedLiteral', {
      children: [createSnlSyntaxTreeNode('x'), createSnlSyntaxTreeNode('y')],
    })
    const localizedDriver = testDriver({ localizedLiteral: macro })
    for (const [language, body] of [['en', 'English'], ['zh-CN', 'Chinese']] as const) {
      const runtime = new ReaderRuntime({ queries: { query_environment: () => ({ language }) } })
      const rendered = await resolveRootLatex(tree, localizedDriver, undefined, [], runtime)
      expect(rendered).toContain(body)
      expect(rendered).not.toContain('{x}')
      expect(rendered).not.toContain('{y}')
    }
    const positional = { ...macro, styles: [{ style_name: 'default', tags: [], template: {
      mode: 'formula_inline' as const, body: '#0',
    } }] }
    expect(isMacroDocumentV11({ localizedLiteral: positional })).toBe(false)
    expect(() => resolve_style_template(positional.styles[0], undefined, 'en', true)).toThrow()
    const fixed = { ...macro, dynamic_arity: false, styles: [macro.styles[1]] }
    expect(isMacroDocumentV11({ localizedLiteral: fixed })).toBe(false)
    expect(() => resolve_style_template(fixed.styles[0], undefined, 'en', false)).toThrow()
  })

  it('joins children with separator via #*', async () => {
    const tree = createSnlSyntaxTreeNode('join_comma', {
      children: [
        createSnlSyntaxTreeNode('a'),
        createSnlSyntaxTreeNode('b'),
        createSnlSyntaxTreeNode('c'),
      ],
    })
    const latex = await resolveRootLatex(tree, driver)
    // Should contain a, b, c joined by comma separator
    expect(latex).toContain('{a}')
    expect(latex).toContain('{b}')
    expect(latex).toContain('{c}')
    expect(latex).toContain(', ')
  })

  it('template wrapping around #* works', async () => {
    const tree = createSnlSyntaxTreeNode('wrap_braces', {
      children: [
        createSnlSyntaxTreeNode('x'),
        createSnlSyntaxTreeNode('y'),
      ],
    })
    const latex = await resolveRootLatex(tree, driver)
    expect(latex).toContain('\\{')
    expect(latex).toContain('\\}')
    expect(latex).toContain('; ')
  })

  it('uses default separator when none specified', async () => {
    const tree = createSnlSyntaxTreeNode('no_sep', {
      children: [
        createSnlSyntaxTreeNode('a'),
        createSnlSyntaxTreeNode('b'),
      ],
    })
    const latex = await resolveRootLatex(tree, driver)
    // Default separator for formula is ', '
    expect(latex).toContain('{a}')
    expect(latex).toContain('{b}')
  })

  it('single child does not add separator', async () => {
    const tree = createSnlSyntaxTreeNode('join_comma', {
      children: [createSnlSyntaxTreeNode('only')],
    })
    const latex = await resolveRootLatex(tree, driver)
    expect(latex).not.toContain(', ')
    expect(latex).toContain('only')
  })

  it('empty children produces empty #* expansion', async () => {
    const tree = createSnlSyntaxTreeNode('join_comma', { children: [] })
    const latex = await resolveRootLatex(tree, driver)
    // Should render htmlData wrapper around empty content
    expect(latex).toContain('name=join_comma')
  })
})
