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

  test('parser rejects hyphen in macro name', () => {
    expect(() => parseSnlSyntaxTree('foo-bar(x)')).toThrow(SnlSyntaxTreeParseError)
  })

  it('marks the quantifier binding variable and annotates bindRef', () => {
    const tree = parseSnlSyntaxTree('FOL.forall.binder(x,y)')
    expect(tree.name).toBe('FOL.forall.binder')
    expect(tree.mdata).toMatchObject({ bindRef: 'b1' })
    expect(tree.children[0].name).toBe('x')
    expect(tree.children[0].kind).toBe('binder')
    expect(tree.children[0].mdata).toMatchObject({ bindRef: 'b1' })
  })

  it('infers bvar/fvar for bare leaves from binder stack', () => {
    const tree = parseSnlSyntaxTree('FOL.forall.binder(x,y)')
    expect(tree.children[1].kind).toBe('fvar')
    expect(tree.children[1].name).toBe('y')

    const t2 = parseSnlSyntaxTree('FOL.forall.binder(x,x)')
    expect(t2.children[1].kind).toBe('bvar')
    expect(t2.children[1].mdata).toMatchObject({ bindRef: 'b1' })
  })

  it('infers bound/free variables in nested FOL example', () => {
    const input =
      'FOL.forall.binder(x,FOL.implies.infix(FOL.app.apply(P,x),FOL.paren.round(FOL.or.infix(y,FOL.app.apply(Q,x)))))'
    const tree = parseSnlSyntaxTree(input)

    const implies = tree.children[1]
    const app1 = implies.children[0]
    expect(app1.name).toBe('FOL.app.apply')
    expect(app1.children[0].kind).toBe('fvar')
    expect(app1.children[0].name).toBe('P')
    expect(app1.children[1].kind).toBe('bvar')
    expect(app1.children[1].name).toBe('x')

    const paren = implies.children[1]
    const orNode = paren.children[0]
    expect(orNode.name).toBe('FOL.or.infix')
    expect(orNode.children[0].kind).toBe('fvar')
    expect(orNode.children[0].name).toBe('y')
    expect(orNode.children[1].name).toBe('FOL.app.apply')
    expect(orNode.children[1].children[0].kind).toBe('fvar')
    expect(orNode.children[1].children[1].kind).toBe('bvar')
  })
})
