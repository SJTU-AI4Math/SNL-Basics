import { describe, expect, it, test } from 'vitest'
import { SnlSyntaxTreeParseError, parseSnlSyntaxTree } from './parser'

describe('parseSnlSyntaxTree', () => {
  it('parses nested expression', () => {
    const tree = parseSnlSyntaxTree('a.b(c,d(e))')
    expect(tree.name).toBe('a.b')
    expect(tree.children).toHaveLength(2)
    expect(tree.children[0].name).toBe('c')
    expect(tree.children[1].name).toBe('d')
    expect(tree.children[1].children[0].name).toBe('e')
  })

  it('supports empty children list', () => {
    const tree = parseSnlSyntaxTree('x.y()')
    expect(tree.name).toBe('x.y')
    expect(tree.children).toEqual([])
  })

  it('throws with bad syntax', () => {
    expect(() => parseSnlSyntaxTree('a.b(c,)')).toThrow(SnlSyntaxTreeParseError)
    expect(() => parseSnlSyntaxTree('a.b(c')).toThrow(SnlSyntaxTreeParseError)
  })

  it('parses a [style] bracket without args → sets node.style', () => {
    const tree = parseSnlSyntaxTree('foo[bar]')
    expect(tree.name).toBe('foo')
    expect(tree.style).toBe('bar')
    expect(tree.children).toEqual([])
  })

  it('parses a [style] bracket with args', () => {
    const tree = parseSnlSyntaxTree('foo[bar](x, y)')
    expect(tree.name).toBe('foo')
    expect(tree.style).toBe('bar')
    expect(tree.children).toHaveLength(2)
    expect(tree.children[0].name).toBe('x')
    expect(tree.children[1].name).toBe('y')
  })

  it('leaves node.style undefined when no bracket is present', () => {
    const tree = parseSnlSyntaxTree('foo(x)')
    expect(tree.name).toBe('foo')
    expect(tree.style).toBeUndefined()
  })

  it('rejects an empty style bracket foo[]', () => {
    expect(() => parseSnlSyntaxTree('foo[]')).toThrow(SnlSyntaxTreeParseError)
  })

  it('rejects a double style bracket foo[a][b]', () => {
    expect(() => parseSnlSyntaxTree('foo[a][b]')).toThrow(SnlSyntaxTreeParseError)
  })

  it('rejects an unclosed style bracket foo[a', () => {
    expect(() => parseSnlSyntaxTree('foo[a')).toThrow(SnlSyntaxTreeParseError)
  })

  it('rejects a bracket with no macro name [a](x)', () => {
    expect(() => parseSnlSyntaxTree('[a](x)')).toThrow(SnlSyntaxTreeParseError)
  })

  it('parses a dotted multi-suffix name', () => {
    const tree = parseSnlSyntaxTree('foo.bar.baz(x, y)')
    expect(tree.name).toBe('foo.bar.baz')
    expect(tree.children).toHaveLength(2)
  })

  it('supports dotted lean-like name with style suffix', () => {
    const tree = parseSnlSyntaxTree('DivRing.div.frac(a,b)')
    expect(tree.name).toBe('DivRing.div.frac')
    expect(tree.children).toHaveLength(2)
  })

  it('supports camelCase style suffix in name', () => {
    const tree = parseSnlSyntaxTree('DivRing.div.inlineDiv(a,b)')
    expect(tree.name).toBe('DivRing.div.inlineDiv')
    expect(tree.children).toHaveLength(2)
  })

  test('parser accepts hyphen in macro name (2026-07-04-late spec)', () => {
    const t = parseSnlSyntaxTree('foo-bar(x)')
    expect(t.name).toBe('foo-bar')
    expect(t.children).toHaveLength(1)
    expect(t.children[0].name).toBe('x')
  })

  it('marks the quantifier binding variable and annotates bindRef', () => {
    const tree = parseSnlSyntaxTree('Type.forall.binder(x,y)')
    expect(tree.name).toBe('Type.forall.binder')
    expect(tree.mdata).toMatchObject({ bindRef: 'b1' })
    expect(tree.children[0].name).toBe('x')
    expect(tree.children[0].kind).toBe('binder')
    expect(tree.children[0].mdata).toMatchObject({ bindRef: 'b1' })
  })

  it('infers bvar for bare leaves from binder stack; leaves unbound leaves un-kinded', () => {
    // 2026-07-04-late 猫猫 spec: an unbound bare leaf should NOT be stamped
    // 'fvar' by annotate-bind — leaving it as '' lets the view fall through
    // to the macro's DB-declared kind (e.g. `Type` → 'rule') instead of
    // masking it as fvar. The wrapHtmlData chain still lands on 'fvar' as
    // the ultimate fallback when there's no db entry.
    const tree = parseSnlSyntaxTree('Type.forall.binder(x,y)')
    expect(tree.children[1].kind).toBe('')
    expect(tree.children[1].name).toBe('y')

    const t2 = parseSnlSyntaxTree('Type.forall.binder(x,x)')
    expect(t2.children[1].kind).toBe('bvar')
    expect(t2.children[1].mdata).toMatchObject({ bindRef: 'b1' })
  })

  it('infers bound/free variables in nested FOL example', () => {
    const input =
      'Type.forall.binder(x,FOL.implies.infix(Type.app.apply(P,x),FOL.paren.round(FOL.or.infix(y,Type.app.apply(Q,x)))))'
    const tree = parseSnlSyntaxTree(input)

    const implies = tree.children[1]
    const app1 = implies.children[0]
    expect(app1.name).toBe('Type.app.apply')
    // Unbound leaves now stay kind='' (was: 'fvar') — see contract update
    // in the sibling test above.
    expect(app1.children[0].kind).toBe('')
    expect(app1.children[0].name).toBe('P')
    expect(app1.children[1].kind).toBe('bvar')
    expect(app1.children[1].name).toBe('x')

    const paren = implies.children[1]
    const orNode = paren.children[0]
    expect(orNode.name).toBe('FOL.or.infix')
    expect(orNode.children[0].kind).toBe('')
    expect(orNode.children[0].name).toBe('y')
    expect(orNode.children[1].name).toBe('Type.app.apply')
    expect(orNode.children[1].children[0].kind).toBe('')
    expect(orNode.children[1].children[1].kind).toBe('bvar')
  })

  describe('src postfix (cat 2026-07-09 context-entry)', () => {
    it('attaches mdata.src on a bare IDENT', () => {
      const tree = parseSnlSyntaxTree('x@context-linalg-vars')
      expect(tree.name).toBe('x')
      expect((tree.mdata as { src?: string }).src).toBe('context-linalg-vars')
    })

    it('attaches src alongside [style]', () => {
      const tree = parseSnlSyntaxTree('x@ctx[styled]')
      expect(tree.name).toBe('x')
      expect(tree.style).toBe('styled')
      expect((tree.mdata as { src?: string }).src).toBe('ctx')
    })

    it('attaches src alongside (args)', () => {
      const tree = parseSnlSyntaxTree('foo@src-entry(a, b)')
      expect(tree.name).toBe('foo')
      expect((tree.mdata as { src?: string }).src).toBe('src-entry')
      expect(tree.children).toHaveLength(2)
    })

    it('carries src across `%…%` and `$…$` delim forms', () => {
      const t1 = parseSnlSyntaxTree('%hello%@ctx')
      expect(t1.envMode).toBe('text')
      expect((t1.mdata as { src?: string }).src).toBe('ctx')

      const t2 = parseSnlSyntaxTree('$x + y$@formula-ctx')
      expect(t2.envMode).toBe('formula_inline')
      expect((t2.mdata as { src?: string }).src).toBe('formula-ctx')
    })

    it('src does NOT change binder semantics on a bare @-prefixed decl', () => {
      // `@x` = decl; adding `@ctx` after makes it a decl WITH src (a decl
      // that documents which context entry it originally came from —
      // reserved semantics; renderer just shows the badge).
      const tree = parseSnlSyntaxTree('@x@ctx')
      expect(tree.name).toBe('x')
      expect(tree.kind).toBe('binder')
      expect((tree.mdata as { src?: string }).src).toBe('ctx')
    })

    it('rejects postfix `@` with no identifier', () => {
      expect(() => parseSnlSyntaxTree('x@')).toThrow(SnlSyntaxTreeParseError)
    })

    it('nested src inside an arg list', () => {
      const tree = parseSnlSyntaxTree('outer(x@ctx, y)')
      expect(tree.name).toBe('outer')
      expect((tree.children[0].mdata as { src?: string }).src).toBe('ctx')
      expect(tree.children[1].mdata as { src?: string } | null).not.toMatchObject({ src: expect.anything() })
    })
  })
})
