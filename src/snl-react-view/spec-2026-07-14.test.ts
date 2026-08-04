// Tests for cat 2026-07-14 spec additions:
//   §numeral               — pure-digit tokens are legal SNL leaves;
//                              render bare in math mode.
//   §dynamic_arity-no-template — dynamic_arity macros render purely from
//                              #* + separator; template is ignored.
import { describe, expect, it } from 'vitest'
import { parseSnlSyntaxTree } from '../snl-syntax-tree/parser'
import { resolveRootLatex } from './render-source'
import type { SnlMacroRecord } from '../snl-macro/types'
import { testDriver } from './test-helpers'

const db: SnlMacroRecord = {
  Type: {
    name: 'Type', description: '',
    source: { entries: [], urls: [] },
    dynamic_arity: false,
    tags: [],
    default_style: { en: 'default' },
    styles: [{ style_name: 'default', mode: 'formula_inline', template: '\\mathbb{T}(#0)', tags: [] }],
  },
  // Dynamic-arity macro — template MUST contain #* per v0.10.0 contract.
  // separator is used to join children at the #* slot.
  or: {
    name: 'or', description: '',
    source: { entries: [], urls: [] },
    dynamic_arity: true,
    tags: [],
    default_style: { en: 'default' },
    styles: [
      {
        style_name: 'default',
        mode: 'formula_inline',
        template: '#*',
        separator: ' \\vee ', tags: [] },
    ],
  },
  // Dynamic-arity with delimiters and empty template.
  set: {
    name: 'set', description: '',
    source: { entries: [], urls: [] },
    dynamic_arity: true,
    tags: [],
    default_style: { en: 'default' },
    styles: [
      {
        style_name: 'default',
        mode: 'formula_inline',
        template: '#*',
        separator: ', ', tags: [] },
    ],
  },
}

const driver = testDriver(db)

describe('cat 2026-07-14 spec: numeral literal', () => {
  it('tokenizer accepts pure-digit identifier', () => {
    const t = parseSnlSyntaxTree('3')
    expect(t.macro_name).toBe('3')
    expect(t.children.length).toBe(0)
  })

  it('accepts numeral inside macro call', () => {
    const t = parseSnlSyntaxTree('Type(3)')
    expect(t.macro_name).toBe('Type')
    expect(t.children[0]?.macro_name).toBe('3')
  })

  it('accepts decimal numeral', () => {
    const t = parseSnlSyntaxTree('1.5')
    expect(t.macro_name).toBe('1.5')
  })

  it('renders numeral bare (no \\mathrm wrap)', async () => {
    const t = parseSnlSyntaxTree('3')
    const src = await resolveRootLatex(t, driver)
    expect(src).toContain('{3}')
    expect(src).not.toContain('\\mathrm')
  })
})

describe('cat 2026-07-14 spec: dynamic_arity expands #* with separator', () => {
  it('separator joins children at #* slot', async () => {
    // or(a, b, c) — dynamic_arity=true with template='#*', separator=' \vee '
    const t = parseSnlSyntaxTree('or(a,b,c)')
    const src = await resolveRootLatex(t, driver)
    expect(src).toContain('\\vee')
  })

  it('delimiters wrap the joined children', async () => {
    const t = parseSnlSyntaxTree('set(a,b,c)')
    const src = await resolveRootLatex(t, driver)
    // set with separator=', '
    expect(src).toMatch(/a.*,.*b.*,.*c/)
  })

  it('wraps the whole variadic call in one \\htmlData so hover snaps to the macro (not a grandparent)', async () => {
    // `or(a, b)` — dynamic_arity with separator=' \vee '. Hovering
    // on the `\vee` glyph MUST walk up to `Type.or`, not to whatever
    // wraps this call. That means the joined body has to sit INSIDE a
    // \htmlData{name=or,...}{ ... } group.
    const t = parseSnlSyntaxTree('or(a,b)')
    const src = await resolveRootLatex(t, driver)
    // Outermost wrapper must be \htmlData{name=or,...}{...}. Both the
    // \vee separator and the child names must sit INSIDE that group.
    expect(src).toMatch(/^\\htmlData\{.*name=or/)
    expect(src).toContain('\\vee')
  })
})
