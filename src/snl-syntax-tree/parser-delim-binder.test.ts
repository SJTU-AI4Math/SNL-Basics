import { describe, expect, it } from 'vitest'
import { SnlSyntaxTreeParseError, parseSnlSyntaxTree } from './parser'

// Coverage for the 2026-07-04-late delimited-name / `@` / bvar-fvar semantics.

describe('delimited name forms', () => {
  it('parses %text% as a text envMode node', () => {
    const t = parseSnlSyntaxTree('%hello world%')
    expect(t.macro_name).toBe('#')
    expect(t.temporary_source).toBe('hello world')
    expect(t.env_mode).toBe('text')
    expect(t.children).toEqual([])
  })

  it('parses $latex$ as a formula_inline envMode node', () => {
    const t = parseSnlSyntaxTree('$x + y$')
    expect(t.macro_name).toBe('#')
    expect(t.temporary_source).toBe('x + y')
    expect(t.env_mode).toBe('formula_inline')
  })

  it('parses $$latex$$ as a formula_display envMode node', () => {
    const t = parseSnlSyntaxTree('$$\\int_0^1 x\\,dx$$')
    expect(t.macro_name).toBe('#')
    expect(t.temporary_source).toBe('\\int_0^1 x\\,dx')
    expect(t.env_mode).toBe('formula_display')
  })

  it('does NOT parse `$x$` inside `%…%` as a nested subtree', () => {
    // The whole payload is the string; the inner $ is part of the name.
    const t = parseSnlSyntaxTree('%foo $x$ bar%')
    expect(t.macro_name).toBe('#')
    expect(t.temporary_source).toBe('foo $x$ bar')
    expect(t.env_mode).toBe('text')
    expect(t.children).toEqual([])
  })

  it('accepts a style bracket and children on a delimited name', () => {
    const t = parseSnlSyntaxTree('$f$[custom](x, y)')
    expect(t.macro_name).toBe('#')
    expect(t.temporary_source).toBe('f')
    expect(t.env_mode).toBe('formula_inline')
    expect(t.style_name).toBe('custom')
    expect(t.children.map((c) => c.macro_name)).toEqual(['x', 'y'])
  })

  it('rejects unclosed %', () => {
    expect(() => parseSnlSyntaxTree('%hello')).toThrow(SnlSyntaxTreeParseError)
  })
  it('rejects unclosed $', () => {
    expect(() => parseSnlSyntaxTree('$hello')).toThrow(SnlSyntaxTreeParseError)
  })
  it('rejects unclosed $$', () => {
    expect(() => parseSnlSyntaxTree('$$hello')).toThrow(SnlSyntaxTreeParseError)
  })

  // Regression (cat 2026-07-11): annotate-bind's envMode-leaf branch used
  // to unconditionally overwrite kind='binder' with 'fvar' because the
  // guard only checked `!node.kind || node.env_mode` — an @-prefixed
  // delimited leaf like `@$\cdot$` hit BOTH the parser's binder stamp AND
  // the annotate-bind fvar stamp, and the second won. Symptom: `@$\cdot$`
  // rendered red (fvar) instead of the binder color, and any entry
  // exporting `@$foo$` as a top-level decl was invisible to the
  // extension's cross-entry `x@ctx` context lookup (extractExportedBinders
  // saw no binder child), so `$…$@ctx` postfix links stayed red too.
  it('preserves kind=binder on @-prefixed delimited leaves', () => {
    const t = parseSnlSyntaxTree('@$\\cdot$')
    expect(t.macro_name).toBe('#')
    expect(t.temporary_source).toBe('\\cdot')
    expect(t.env_mode).toBe('formula_inline')
    expect(t.kind).toBe('binder')
  })

  it('preserves kind=binder on nested @-prefixed delimited children', () => {
    const t = parseSnlSyntaxTree('ctx(@$\\cdot$, @%plus%)')
    expect(t.children.map((c) => c.kind)).toEqual(['binder', 'binder'])
  })
})

describe('@ binder prefix', () => {
  it('marks the node as kind=binder', () => {
    const t = parseSnlSyntaxTree('@foo')
    expect(t.macro_name).toBe('foo')
    expect(t.kind).toBe('binder')
  })

  it('is structurally identical to an unprefixed leaf except for binder metadata', () => {
    const plain = parseSnlSyntaxTree('x')
    const bound = parseSnlSyntaxTree('@x')
    expect(bound.macro_name).toBe(plain.macro_name)
    expect(bound.env_mode).toBe(plain.env_mode)
    expect(bound.children).toEqual(plain.children)
    expect(plain.kind).not.toBe('binder')
    expect(bound.kind).toBe('binder')
  })

  it('composes with a leaf $…$ delimited name', () => {
    const t = parseSnlSyntaxTree('@$x + y$')
    expect(t.macro_name).toBe('#')
    expect(t.temporary_source).toBe('x + y')
    expect(t.env_mode).toBe('formula_inline')
    expect(t.kind).toBe('binder')
    expect(t.children).toEqual([])
  })

  it('composes with a leaf %…% delimited name', () => {
    const t = parseSnlSyntaxTree('@%my binder%')
    expect(t.macro_name).toBe('#')
    expect(t.temporary_source).toBe('my binder')
    expect(t.env_mode).toBe('text')
    expect(t.kind).toBe('binder')
    expect(t.children).toEqual([])
  })
})

describe('parser/resolver boundary', () => {
  it('parses binder syntax but does not allocate bindRef or classify later uses', () => {
    const tree = parseSnlSyntaxTree('FooScope(@x, $x$)')
    expect(tree.children[0]).toMatchObject({ kind: 'binder', binder_name: 'x' })
    expect(tree.children[0].mdata).toBeNull()
    expect(tree.children[1]).toMatchObject({ macro_name: '#1', temporary_source: 'x', kind: '' })
    expect(tree.children[1].mdata).toBeNull()
  })

  it('leaves nested source selection to the Macro-aware semantic resolver', () => {
    const tree = parseSnlSyntaxTree('wrap(inner(@T, deeper(@A, @B)), use(T, A, B))')
    expect(tree.children[1].children.map((node) => node.kind)).toEqual(['', '', ''])
    expect(tree.children[0].children[0].kind).toBe('binder')
  })

  it('accepts legacy activeBinderIds as a no-op parser option without creating IDs', () => {
    const tree = parseSnlSyntaxTree('P($x$, $y$)', { activeBinderIds: ['x'] })
    expect(tree.children.map((node) => node.kind)).toEqual(['', ''])
    expect(JSON.stringify(tree)).not.toContain('bindRef')
  })
})
