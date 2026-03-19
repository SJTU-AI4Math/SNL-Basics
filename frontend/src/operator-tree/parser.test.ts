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

  it('supports dotted lean-like name', () => {
    const tree = parseOperatorTree('DivRing.div[frac](a,b)')
    expect(tree.name).toBe('DivRing.div')
    expect(tree.style).toBe('frac')
    expect(tree.children).toHaveLength(2)
  })
})
