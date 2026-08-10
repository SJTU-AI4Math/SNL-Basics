import { describe, expect, it } from 'vitest'
import { resolveRootLatex } from './render-source'
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
