// Tests for cat 2026-07-14 spec additions:
//   §numeral               — pure-digit tokens are legal SNL leaves;
//                              render bare in math mode.
//   §dynamic_arity-no-template — dynamic_arity macros render purely from
//                              variadic_left/join/right; template is
//                              ignored.
import { describe, expect, it } from 'vitest'
import { parseSnlSyntaxTree } from '../snl-syntax-tree/parser'
import { resolveRootLatex } from './render-source'
import type { SnlMacroDb } from '../snl-macro/types'
import type { SnlMacroTemplateQuery } from '../snl-syntax-tree/query'

const db: SnlMacroDb = {
  Type: {
    name: 'Type',
    description: '',
    source: { entries: [], urls: [] },
    dynamic_arity: false,
    styles: [{ tag: 'default', mode: 'formula_inline', template: '\\mathbb{T}(#0)' }],
  },
  // Dynamic-arity macro with a NON-EMPTY template that should be ignored.
  or: {
    name: 'or',
    description: '',
    source: { entries: [], urls: [] },
    dynamic_arity: true,
    styles: [
      {
        tag: 'default',
        mode: 'formula_inline',
        template: 'GARBAGE_SHOULD_NOT_APPEAR',
        variadic_join: ' \\vee ',
      },
    ],
  },
  // Dynamic-arity with delimiters and empty template.
  set: {
    name: 'set',
    description: '',
    source: { entries: [], urls: [] },
    dynamic_arity: true,
    styles: [
      {
        tag: 'default',
        mode: 'formula_inline',
        template: '',
        variadic_left: '\\{',
        variadic_join: ', ',
        variadic_right: '\\}',
      },
    ],
  },
}

const query: SnlMacroTemplateQuery = async ({ name, node }) => {
  const m = db[name]
  if (m && m.styles.length > 0) {
    const s = node.style == null ? m.styles[0] : m.styles.find((x) => x.tag === node.style) ?? m.styles[0]
    if (s?.template) return s.template
  }
  if (/^[A-Za-z]+$/.test(name)) return name
  if (/^-?\d+(\.\d+)?$/.test(name)) return name
  return `\\mathrm{${name}}`
}

describe('cat 2026-07-14 spec: numeral literal', () => {
  it('tokenizer accepts pure-digit identifier', () => {
    const t = parseSnlSyntaxTree('3')
    expect(t.name).toBe('3')
    expect(t.children.length).toBe(0)
  })

  it('accepts numeral inside macro call', () => {
    const t = parseSnlSyntaxTree('Type(3)')
    expect(t.name).toBe('Type')
    expect(t.children[0]?.name).toBe('3')
  })

  it('accepts decimal numeral', () => {
    const t = parseSnlSyntaxTree('1.5')
    expect(t.name).toBe('1.5')
  })

  it('renders numeral bare (no \\mathrm wrap)', async () => {
    const t = parseSnlSyntaxTree('3')
    const src = await resolveRootLatex(t, query, new Map(), db)
    expect(src).toContain('{3}')
    expect(src).not.toContain('\\mathrm')
  })
})

describe('cat 2026-07-14 spec: dynamic_arity ignores template', () => {
  it('template body does not appear in output', async () => {
    // or(a, b, c) — dynamic_arity=true with template='GARBAGE_...'
    const t = parseSnlSyntaxTree('or(a,b,c)')
    const src = await resolveRootLatex(t, query, new Map(), db)
    expect(src).not.toContain('GARBAGE')
    expect(src).toContain('\\vee')
  })

  it('delimiters wrap the joined children', async () => {
    const t = parseSnlSyntaxTree('set(a,b,c)')
    const src = await resolveRootLatex(t, query, new Map(), db)
    // set with left='\{' , join=', ', right='\}'
    expect(src).toMatch(/\\\{.*a.*,.*b.*,.*c.*\\\}/)
  })

  it('wraps the whole variadic call in one \\htmlData so hover snaps to the macro (not a grandparent)', async () => {
    // `or(a, b)` — dynamic_arity with variadic_join=' \vee '. Hovering
    // on the `\vee` glyph MUST walk up to `Type.or`, not to whatever
    // wraps this call. That means the joined body has to sit INSIDE a
    // \htmlData{name=or,...}{ ... } group.
    const t = parseSnlSyntaxTree('or(a,b)')
    const src = await resolveRootLatex(t, query, new Map(), db)
    // Outermost wrapper must be \htmlData{name=or,...}{...}. Both the
    // \vee separator and the child names must sit INSIDE that group.
    expect(src).toMatch(/^\\htmlData\{name=or,/)
    expect(src).toContain('\\vee')
  })
})
