import { describe, expect, it } from 'vitest'
import { OperatorTreeParseError, parseOperatorTree } from './parser'

describe('parseOperatorTree', () => {
  it('parses nested expression', () => {
    const tree = parseOperatorTree('a[b](c,d(e))')
    expect(tree.name).toBe('a')
    expect(tree.style).toBe('b')
    expect(tree.children).toHaveLength(2)
    expect(tree.children[0].name).toBe('c')
    expect(tree.children[1].name).toBe('d')
    expect(tree.children[1].children[0].name).toBe('e')
  })

  it('supports empty children list', () => {
    const tree = parseOperatorTree('x[y]()')
    expect(tree.name).toBe('x')
    expect(tree.style).toBe('y')
    expect(tree.children).toEqual([])
  })

  it('throws with bad syntax', () => {
    expect(() => parseOperatorTree('a[b](c,)')).toThrow(OperatorTreeParseError)
    expect(() => parseOperatorTree('a[b')).toThrow(OperatorTreeParseError)
  })

  it('allows omitting empty brackets: name(args) without []', () => {
    const tree = parseOperatorTree('FOL.forall(x[binder],y)')
    expect(tree.name).toBe('FOL.forall')
    expect(tree.style).toBe('')
    expect(tree.children).toHaveLength(2)
  })

  it('supports dotted lean-like name', () => {
    const tree = parseOperatorTree('DivRing.div[frac](a,b)')
    expect(tree.name).toBe('DivRing.div')
    expect(tree.style).toBe('frac')
    expect(tree.children).toHaveLength(2)
  })

  it('parses style metadata and annotates bindRef', () => {
    const tree = parseOperatorTree('FOL.forall[binder](x[binder],y)')
    expect(tree.name).toBe('FOL.forall')
    expect(tree.style).toBe('binder')
    expect(tree.kind).toBe('binder')
    expect(tree.mdata).toMatchObject({ bindRef: 'b1' })
    expect(tree.children[0].name).toBe('x')
    expect(tree.children[0].style).toBe('binder')
    expect(tree.children[0].kind).toBe('binder')
    expect(tree.children[0].mdata).toMatchObject({ bindRef: 'b1' })
  })

  it('infers bvar/fvar for bare leaves from binder stack', () => {
    const tree = parseOperatorTree('FOL.forall(x[binder],y)')
    expect(tree.children[1].kind).toBe('fvar')
    expect(tree.children[1].name).toBe('y')

    const t2 = parseOperatorTree('FOL.forall(x[binder],x)')
    expect(t2.children[1].kind).toBe('bvar')
    expect(t2.children[1].mdata).toMatchObject({ bindRef: 'b1' })
  })

  it('infers bound/free variables in nested FOL example without [bvar]', () => {
    const input =
      'FOL.forall(x[binder],FOL.implies(FOL.app(P,x),FOL.paren(FOL.or(y,FOL.app(Q,x)))))'
    const tree = parseOperatorTree(input)

    const implies = tree.children[1]
    const app1 = implies.children[0]
    expect(app1.name).toBe('FOL.app')
    expect(app1.children[0].kind).toBe('fvar')
    expect(app1.children[0].name).toBe('P')
    expect(app1.children[1].kind).toBe('bvar')
    expect(app1.children[1].name).toBe('x')

    const paren = implies.children[1]
    const orNode = paren.children[0]
    expect(orNode.name).toBe('FOL.or')
    expect(orNode.children[0].kind).toBe('fvar')
    expect(orNode.children[0].name).toBe('y')
    expect(orNode.children[1].name).toBe('FOL.app')
    expect(orNode.children[1].children[0].kind).toBe('fvar')
    expect(orNode.children[1].children[1].kind).toBe('bvar')
  })
})
