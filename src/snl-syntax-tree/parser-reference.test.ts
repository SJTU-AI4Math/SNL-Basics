import { describe, expect, it } from 'vitest'
import { SnlDslFormatter } from './formatter'
import { SnlSyntaxTreeParseError, parseSnlSyntaxTree } from './parser'

describe('0.2 postfix references', () => {
  it('parses @#digits.digits as a tree-path source', () => {
    const tree = parseSnlSyntaxTree('x@#0.1.2')
    expect(tree.postfix).toEqual({ type: 'tree_path', path: [0, 1, 2] })
  })

  it('parses @#name as a binder-name source', () => {
    const tree = parseSnlSyntaxTree('x@#xy')
    expect(tree.postfix).toEqual({ type: 'binder_name', name: 'xy' })
  })

  it('preserves the existing @entry spelling as an unresolved name postfix', () => {
    const tree = parseSnlSyntaxTree('x@context.entry')
    expect(tree.postfix).toEqual({ type: 'name', name: 'context.entry' })
  })

  it('uses a plain postfix name to override a binder name', () => {
    const tree = parseSnlSyntaxTree('@x@xy')
    expect(tree.kind).toBe('binder')
    expect(tree.binder_name).toBe('xy')
    expect(tree.postfix).toBeUndefined()
  })
})

describe('0.2 leaf-only binders', () => {
  it('rejects a prefixed binder with children', () => {
    expect(() => parseSnlSyntaxTree('@Pair(x,y)')).toThrow(SnlSyntaxTreeParseError)
    expect(() => parseSnlSyntaxTree('@Pair(x,y)')).toThrow(/Binder must be a leaf/)
  })

  it('does not recursively stamp siblings or ancestors', () => {
    const tree = parseSnlSyntaxTree('scope(@x,y)')
    expect(tree.children[0].kind).toBe('binder')
    expect(tree.children[1].kind).not.toBe('binder')
    expect(tree.kind).not.toBe('binder')
  })
})

describe('0.2 postfix formatting', () => {
  it('round trips tree-path, binder-name, Entry, and binder override postfixes', () => {
    const formatter = new SnlDslFormatter()
    expect(formatter.format('F(x@#0.1.2,y@#name,z@entry,@w@other)'))
      .toBe('F(x@#0.1.2, y@#name, z@entry, @w@other)')
  })
})
