import { describe, expect, it } from 'vitest'
import { SnlSyntaxTreeParseError, parseSnlSyntaxTree } from './parser'

// Coverage for the 2026-07-04-late delimited-name / `@` / bvar-fvar semantics.

describe('delimited name forms', () => {
  it('parses %text% as a text envMode node', () => {
    const t = parseSnlSyntaxTree('%hello world%')
    expect(t.macro_name).toBe('hello world')
    expect(t.env_mode).toBe('text')
    expect(t.children).toEqual([])
  })

  it('parses $latex$ as a formula_inline envMode node', () => {
    const t = parseSnlSyntaxTree('$x + y$')
    expect(t.macro_name).toBe('x + y')
    expect(t.env_mode).toBe('formula_inline')
  })

  it('parses $$latex$$ as a formula_display envMode node', () => {
    const t = parseSnlSyntaxTree('$$\\int_0^1 x\\,dx$$')
    expect(t.macro_name).toBe('\\int_0^1 x\\,dx')
    expect(t.env_mode).toBe('formula_display')
  })

  it('does NOT parse `$x$` inside `%…%` as a nested subtree', () => {
    // The whole payload is the string; the inner $ is part of the name.
    const t = parseSnlSyntaxTree('%foo $x$ bar%')
    expect(t.macro_name).toBe('foo $x$ bar')
    expect(t.env_mode).toBe('text')
    expect(t.children).toEqual([])
  })

  it('accepts a style bracket and children on a delimited name', () => {
    const t = parseSnlSyntaxTree('$f$[custom](x, y)')
    expect(t.macro_name).toBe('f')
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
    expect(t.macro_name).toBe('\\cdot')
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

  it('is STRUCTURALLY identical to the un-@ form (2026-07-04-late 猫猫 fix)', () => {
    // Only the `kind` field should differ between `f(x)` and `@f(x)` — the
    // envMode / children / name shape must all match, so the render pipeline
    // takes the same path and produces the same LaTeX (just tagged with a
    // different kind in the \htmlData wrap).
    const plain = parseSnlSyntaxTree('f(x)')
    const bound = parseSnlSyntaxTree('@f(x)')
    expect(bound.macro_name).toBe(plain.macro_name)
    expect(bound.env_mode).toBe(plain.env_mode) // both undefined
    expect(bound.children).toHaveLength(plain.children.length)
    expect(bound.children[0].macro_name).toBe(plain.children[0].macro_name)
    // kind is expected to differ:
    expect(plain.kind).not.toBe('binder')
    expect(bound.kind).toBe('binder')
  })

  it('recursively marks every descendant as binder', () => {
    const t = parseSnlSyntaxTree('@Tuple(a, b)')
    expect(t.kind).toBe('binder')
    expect(t.children[0].kind).toBe('binder')
    expect(t.children[1].kind).toBe('binder')
  })

  it('composes with $…$ delimited name', () => {
    const t = parseSnlSyntaxTree('@$x + y$(a)')
    expect(t.macro_name).toBe('x + y')
    expect(t.env_mode).toBe('formula_inline')
    expect(t.kind).toBe('binder')
    expect(t.children[0].macro_name).toBe('a')
    expect(t.children[0].kind).toBe('binder')
  })

  it('composes with %…% delimited name', () => {
    const t = parseSnlSyntaxTree('@%my binder%(a)')
    expect(t.macro_name).toBe('my binder')
    expect(t.env_mode).toBe('text')
    expect(t.kind).toBe('binder')
    expect(t.children[0].kind).toBe('binder')
  })
})

describe('binder scoping — @ contributes names to later siblings', () => {
  it('scopes an @-marked child so a later delimited leaf becomes bvar', () => {
    // FooScope(@x, $x$) — parser sees @x as a binder in the scope; the
    // later $x$ sibling looks up "x" and resolves to bvar.
    const t = parseSnlSyntaxTree('FooScope(@x, $x$)')
    expect(t.children[0].kind).toBe('binder')
    expect(t.children[1].macro_name).toBe('x')
    expect(t.children[1].kind).toBe('bvar')
    // Later child should carry the fresh bindRef stamped by annotate-bind.
    const bref = (t.children[1].mdata as { bindRef?: string } | null)?.bindRef
    expect(typeof bref).toBe('string')
    expect(bref?.length).toBeGreaterThan(0)
  })

  it('a complex @-delimited binder rarely matches — usually fvar', () => {
    // The whole delim payload is the name. Complex payloads seldom match a
    // later leaf, so those leaves default to fvar.
    const t = parseSnlSyntaxTree('FooScope(@$x + y$, $x$)')
    expect(t.children[1].macro_name).toBe('x')
    expect(t.children[1].kind).toBe('fvar')
  })

  it('@Tuple(a, b) contributes ALL of Tuple, a, b as active binders', () => {
    const t = parseSnlSyntaxTree('FooScope(@Tuple(a, b), Body($a$, $b$, $c$))')
    const body = t.children[1]
    expect(body.children[0].macro_name).toBe('a')
    expect(body.children[0].kind).toBe('bvar')
    expect(body.children[1].macro_name).toBe('b')
    expect(body.children[1].kind).toBe('bvar')
    expect(body.children[2].macro_name).toBe('c')
    expect(body.children[2].kind).toBe('fvar')
  })
})

describe('parseSnlSyntaxTree options.activeBinderIds', () => {
  it('threads pre-existing binders through to bvar/fvar resolution', () => {
    // Parsing a fragment: caller knows `x` is already in scope.
    const t = parseSnlSyntaxTree('P($x$, $y$)', { activeBinderIds: ['x'] })
    expect(t.children[0].kind).toBe('bvar')
    expect(t.children[1].kind).toBe('fvar')
  })

  it('defaults to empty (context-free) when not provided', () => {
    const t = parseSnlSyntaxTree('P($x$)')
    expect(t.children[0].kind).toBe('fvar')
  })
})

describe('deep-nested binder scoping (2026-07-04-late bug 1)', () => {
  it('@T buried inside Type.judge(@T, ...) is visible to Type.judge\'s later siblings', () => {
    // 猫猫 repro: def-hyp(hyp-list(Type.judge(@T,Type), ...), Set.union(A,B), ...)
    // @T is nested 3 levels deep inside def-hyp's FIRST child. Later
    // siblings of def-hyp (Set.union, ...) must still see T as a binder.
    const t = parseSnlSyntaxTree(
      'def-hyp(hyp-list(Type.judge(@T,Type)), Set.union(T))'
    )
    // Walk to the last leaf: def-hyp > Set.union > T
    const setUnion = t.children[1]
    expect(setUnion.macro_name).toBe('Set.union')
    expect(setUnion.children[0].macro_name).toBe('T')
    expect(setUnion.children[0].kind).toBe('bvar')
  })

  it('multiple deep @-binders at various depths all contribute to sibling scope', () => {
    const t = parseSnlSyntaxTree(
      'wrap(inner(@T, deeper(@A, @B)), use(T, A, B))'
    )
    const use = t.children[1]
    expect(use.macro_name).toBe('use')
    expect(use.children[0].kind).toBe('bvar') // T
    expect(use.children[1].kind).toBe('bvar') // A
    expect(use.children[2].kind).toBe('bvar') // B
  })
})

describe('bare-leaf kind fallback (2026-07-04-late bug 2)', () => {
  it('unbound bare leaf leaves kind="" (not "fvar") so wrapHtmlData can fall through to dbKind', () => {
    // `Type` in `Type.judge(@T, Type)` should NOT be stamped fvar by
    // annotate-bind — it stays '' so the view later resolves it against
    // queried Type macro kind (typically 'rule').
    const t = parseSnlSyntaxTree('Type.judge(@T, Type)')
    expect(t.children[1].macro_name).toBe('Type')
    expect(t.children[1].kind).toBe('')
  })

  it('but delimited-leaf (envMode) still gets fvar when unbound', () => {
    // env_mode nodes bypass macro queries, so annotate-bind DOES stamp fvar for
    // them (no db entry to fall through to).
    const t = parseSnlSyntaxTree('$x$')
    expect(t.kind).toBe('fvar')
  })
})
