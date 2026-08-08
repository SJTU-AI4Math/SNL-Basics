import { describe, expect, it, test } from 'vitest'
import { SnlSyntaxTreeParseError, parseSnlSyntaxTree } from './parser'
import { isEmptySnlSyntaxTreeNode } from './types'

describe('parseSnlSyntaxTree', () => {
  it('parses nested expression', () => {
    const tree = parseSnlSyntaxTree('a.b(c,d(e))')
    expect(tree.macro_name).toBe('a.b')
    expect(tree.children).toHaveLength(2)
    expect(tree.children[0].macro_name).toBe('c')
    expect(tree.children[1].macro_name).toBe('d')
    expect(tree.children[1].children[0].macro_name).toBe('e')
  })

  it('parses Unicode Macro and style names without ASCII-normalizing them', () => {
    const cases = [
      ['群.是群[默认](对象)', '群.是群', '默认', '对象'],
      ['日本語.写像(値)', '日本語.写像', undefined, '値'],
      ['Ελληνικά.Ομάδα(αντικείμενο)', 'Ελληνικά.Ομάδα', undefined, 'αντικείμενο'],
      ['Théorie.groupe(élément)', 'Théorie.groupe', undefined, 'élément'],
      ['几何.∠(点)', '几何.∠', undefined, '点'],
      ['emoji.猫🐈(鱼)', 'emoji.猫🐈', undefined, '鱼'],
    ] as const
    for (const [source, macroName, styleName, childName] of cases) {
      const tree = parseSnlSyntaxTree(source)
      expect(tree.macro_name).toBe(macroName)
      expect(tree.style_name).toBe(styleName)
      expect(tree.children[0].macro_name).toBe(childName)
    }
  })

  it('rejects Unicode whitespace and format controls at token boundaries', () => {
    for (const char of ['\u00a0', '\u3000', '\u2028', '\ufeff', '\u200b', '\u202e']) {
      expect(() => parseSnlSyntaxTree(`a${char}(b)`), JSON.stringify(char))
        .toThrow(SnlSyntaxTreeParseError)
    }
    expect(parseSnlSyntaxTree('a \t\n(b)').macro_name).toBe('a')
  })

  it('supports empty children list', () => {
    const tree = parseSnlSyntaxTree('x.y()')
    expect(tree.macro_name).toBe('x.y')
    expect(tree.children).toEqual([])
  })

  it('throws with bad syntax', () => {
    expect(() => parseSnlSyntaxTree('a.b(c')).toThrow(SnlSyntaxTreeParseError)
    expect(() => parseSnlSyntaxTree('a.b(c))')).toThrow(SnlSyntaxTreeParseError)
  })

  it('parses an unfilled argument slot as an empty node', () => {
    // Cat 2026-07-25: an author must be able to write "this slot exists but
    // is not filled yet", so arity keeps matching what is written.
    const trailing = parseSnlSyntaxTree('a.b(c,)')
    expect(trailing.children).toHaveLength(2)
    expect(isEmptySnlSyntaxTreeNode(trailing.children[1])).toBe(true)

    const middle = parseSnlSyntaxTree('f(a,,b)')
    expect(middle.children.map((child) => child.macro_name)).toEqual(['a', '', 'b'])
    expect(middle.children.map(isEmptySnlSyntaxTreeNode)).toEqual([false, true, false])

    const bothEmpty = parseSnlSyntaxTree('f(,)')
    expect(bothEmpty.children).toHaveLength(2)
    expect(bothEmpty.children.every(isEmptySnlSyntaxTreeNode)).toBe(true)
  })

  it('keeps f() at zero arguments — an empty slot needs a comma', () => {
    // Consequence: arity 1 with an unfilled slot has no surface form, so it
    // must never be serialized. Guarded by canPersistCanvasForest.
    expect(parseSnlSyntaxTree('f()').children).toEqual([])
    expect(parseSnlSyntaxTree('f( )').children).toEqual([])
    expect(parseSnlSyntaxTree('f').children).toEqual([])
    expect(parseSnlSyntaxTree('f(,)').children).toHaveLength(2)
  })

  it('does not treat a delimited empty node as an unfilled slot', () => {
    // `%%` is an empty TEXT node the author wrote on purpose.
    const tree = parseSnlSyntaxTree('f(%%)')
    expect(tree.children[0].macro_name).toBe('')
    expect(tree.children[0].env_mode).toBe('text')
    expect(isEmptySnlSyntaxTreeNode(tree.children[0])).toBe(false)
  })

  it('parses a [style] bracket without args → sets node.style_name', () => {
    const tree = parseSnlSyntaxTree('foo[bar]')
    expect(tree.macro_name).toBe('foo')
    expect(tree.style_name).toBe('bar')
    expect(tree.children).toEqual([])
  })

  it('parses a [style] bracket with args', () => {
    const tree = parseSnlSyntaxTree('foo[bar](x, y)')
    expect(tree.macro_name).toBe('foo')
    expect(tree.style_name).toBe('bar')
    expect(tree.children).toHaveLength(2)
    expect(tree.children[0].macro_name).toBe('x')
    expect(tree.children[1].macro_name).toBe('y')
  })

  it('leaves node.style_name undefined when no bracket is present', () => {
    const tree = parseSnlSyntaxTree('foo(x)')
    expect(tree.macro_name).toBe('foo')
    expect(tree.style_name).toBeUndefined()
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
    expect(tree.macro_name).toBe('foo.bar.baz')
    expect(tree.children).toHaveLength(2)
  })

  it('supports dotted lean-like name with style suffix', () => {
    const tree = parseSnlSyntaxTree('DivRing.div.frac(a,b)')
    expect(tree.macro_name).toBe('DivRing.div.frac')
    expect(tree.children).toHaveLength(2)
  })

  it('supports camelCase style suffix in name', () => {
    const tree = parseSnlSyntaxTree('DivRing.div.inlineDiv(a,b)')
    expect(tree.macro_name).toBe('DivRing.div.inlineDiv')
    expect(tree.children).toHaveLength(2)
  })

  test('parser accepts hyphen in macro name (2026-07-04-late spec)', () => {
    const t = parseSnlSyntaxTree('foo-bar(x)')
    expect(t.macro_name).toBe('foo-bar')
    expect(t.children).toHaveLength(1)
    expect(t.children[0].macro_name).toBe('x')
  })

  it('uses explicit @ binders without hardcoded Macro names', () => {
    const tree = parseSnlSyntaxTree('quantifier(@x,x)')
    expect(tree.macro_name).toBe('quantifier')
    expect(tree.scope).toBe('binder')
    expect(tree.children[0].kind).toBe('binder')
    expect(tree.children[0].mdata).toMatchObject({ bindRef: 'b1' })
    expect(tree.children[1].kind).toBe('bvar')
    expect(tree.children[1].mdata).toMatchObject({ bindRef: 'b1' })
  })

  it('does not assign binder semantics from an FOL-shaped name', () => {
    const tree = parseSnlSyntaxTree('FOL.forall(x,x)')
    expect(tree.kind).toBe('')
    expect(tree.children[0].kind).toBe('')
    expect(tree.children[1].kind).toBe('')
  })

  it('infers bvar for explicit binders; leaves unbound leaves un-kinded', () => {
    const tree = parseSnlSyntaxTree('quantifier(@x,y)')
    expect(tree.children[1].kind).toBe('')
    expect(tree.children[1].macro_name).toBe('y')

    const bound = parseSnlSyntaxTree('quantifier(@x,x)')
    expect(bound.children[1].kind).toBe('bvar')
    expect(bound.children[1].mdata).toMatchObject({ bindRef: 'b1' })
  })

  it('infers bound/free variables in a generic nested example', () => {
    const tree = parseSnlSyntaxTree(
      'quantifier(@x,implies(app(P,x),paren(or(y,app(Q,x)))))',
    )
    const implies = tree.children[1]
    const app1 = implies.children[0]
    expect(app1.children[0].kind).toBe('')
    expect(app1.children[1].kind).toBe('bvar')
    const orNode = implies.children[1].children[0]
    expect(orNode.children[0].kind).toBe('')
    expect(orNode.children[1].children[0].kind).toBe('')
    expect(orNode.children[1].children[1].kind).toBe('bvar')
  })

  describe('src postfix (cat 2026-07-09 context-entry)', () => {
    it('attaches mdata.src on a bare IDENT', () => {
      const tree = parseSnlSyntaxTree('x@context-linalg-vars')
      expect(tree.macro_name).toBe('x')
      expect((tree.mdata as { src?: string }).src).toBe('context-linalg-vars')
    })

    it('attaches src alongside [style]', () => {
      const tree = parseSnlSyntaxTree('x@ctx[styled]')
      expect(tree.macro_name).toBe('x')
      expect(tree.style_name).toBe('styled')
      expect((tree.mdata as { src?: string }).src).toBe('ctx')
    })

    it('attaches src alongside (args)', () => {
      const tree = parseSnlSyntaxTree('foo@src-entry(a, b)')
      expect(tree.macro_name).toBe('foo')
      expect((tree.mdata as { src?: string }).src).toBe('src-entry')
      expect(tree.children).toHaveLength(2)
    })

    it('carries src across `%…%` and `$…$` delim forms', () => {
      const t1 = parseSnlSyntaxTree('%hello%@ctx')
      expect(t1.env_mode).toBe('text')
      expect((t1.mdata as { src?: string }).src).toBe('ctx')

      const t2 = parseSnlSyntaxTree('$x + y$@formula-ctx')
      expect(t2.env_mode).toBe('formula_inline')
      expect((t2.mdata as { src?: string }).src).toBe('formula-ctx')
    })

    it('a postfix name overrides the name exported by a binder leaf', () => {
      const tree = parseSnlSyntaxTree('@x@ctx')
      expect(tree.macro_name).toBe('x')
      expect(tree.kind).toBe('binder')
      expect(tree.binder_name).toBe('ctx')
      expect(tree.mdata).toBeNull()
    })

    it('rejects postfix `@` with no identifier', () => {
      expect(() => parseSnlSyntaxTree('x@')).toThrow(SnlSyntaxTreeParseError)
    })

    it('nested src inside an arg list', () => {
      const tree = parseSnlSyntaxTree('outer(x@ctx, y)')
      expect(tree.macro_name).toBe('outer')
      expect((tree.children[0].mdata as { src?: string }).src).toBe('ctx')
      expect(tree.children[1].mdata as { src?: string } | null).not.toMatchObject({ src: expect.anything() })
    })
  })
})
