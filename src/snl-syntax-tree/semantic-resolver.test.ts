import { describe, expect, it } from 'vitest'
import type { SnlMacro, SnlMacroRecord } from '../snl-macro/types'
import { parseSnlSyntaxTree } from './parser'
import { resolveSnlSemantics } from './semantic-resolver'

const macro = (name: string, kind: 'const' | 'sub' = 'const'): SnlMacro => ({
  name,
  description: '',
  source: { entries: [], urls: [] },
  kind,
  dynamic_arity: false,
  tags: [],
  styles: [{ style_name: 'default', mode: 'formula_inline', template: name, tags: [] }],
})

const db = (...entries: Array<[string, ('const' | 'sub')?]>): SnlMacroRecord => Object.fromEntries(
  entries.map(([name, kind]) => [name, macro(name, kind)]),
)

describe('Macro-aware SNL semantic resolution', () => {
  it('lets a registered const win over implicit binder-name matching', () => {
    const parsed = parseSnlSyntaxTree('scope(@x,x)')
    const result = resolveSnlSemantics(parsed, db(['scope'], ['x']))
    expect(result.tree.children[1].kind).toBe('const')
    expect(result.tree.children[1].source).toBeUndefined()
    expect(parsed.children[1].kind).not.toBe('const')
  })

  it('resolves an unknown name to the nearest prior binder source', () => {
    const result = resolveSnlSemantics(parseSnlSyntaxTree('scope(@x,x)'), db(['scope']))
    expect(result.tree.children[1]).toMatchObject({
      kind: 'bvar',
      source: { type: 'tree_path', path: [0] },
    })
  })

  it('lets a const postfix export a binder name without changing const behavior', () => {
    const result = resolveSnlSemantics(parseSnlSyntaxTree('scope(C@x,x)'), db(['scope'], ['C']))
    expect(result.tree.children[0]).toMatchObject({ kind: 'const', binder_name: 'x' })
    expect(result.tree.children[1]).toMatchObject({
      kind: 'bvar',
      source: { type: 'tree_path', path: [0] },
    })
  })

  it('uses deepest LCA then nearest prior source for duplicate binder names', () => {
    const result = resolveSnlSemantics(
      parseSnlSyntaxTree('root(@x,inner(@x,x),x)'),
      db(['root'], ['inner']),
    )
    expect(result.tree.children[1].children[1].source).toEqual({ type: 'tree_path', path: [1, 0] })
    expect(result.tree.children[2].source).toEqual({ type: 'tree_path', path: [1, 0] })
  })

  it('supports explicit tree-path, binder-name, and Entry sources', () => {
    const result = resolveSnlSemantics(
      parseSnlSyntaxTree('root(@x,y@#0,z@#x,w@ctx)'),
      db(['root']),
    )
    expect(result.tree.children[1].source).toEqual({ type: 'tree_path', path: [0] })
    expect(result.tree.children[2].source).toEqual({ type: 'tree_path', path: [0] })
    expect(result.tree.children[3].source).toEqual({ type: 'entry', entry_id: 'ctx' })
    expect(result.tree.children.slice(1).map((node) => node.kind)).toEqual(['bvar', 'bvar', 'bvar'])
  })

  it('allows an explicit tree path to reference an arbitrary non-sub node', () => {
    const result = resolveSnlSemantics(
      parseSnlSyntaxTree('root(C,y@#0)'),
      db(['root'], ['C']),
    )
    expect(result.tree.children[0].kind).toBe('const')
    expect(result.tree.children[0].binder_name).toBeUndefined()
    expect(result.tree.children[1]).toMatchObject({
      kind: 'bvar',
      source: { type: 'tree_path', path: [0] },
    })
  })

  it('falls back to fvar and reports dangling explicit sources', () => {
    const implicit = resolveSnlSemantics(parseSnlSyntaxTree('missing'), {})
    expect(implicit.tree.kind).toBe('fvar')

    const explicit = resolveSnlSemantics(parseSnlSyntaxTree('x@#9.9'), {})
    expect(explicit.tree.kind).toBe('fvar')
    expect(explicit.diagnostics).toContainEqual(expect.objectContaining({
      code: 'SNL_DANGLING_TREE_SOURCE',
      severity: 'warning',
      tree_path: [],
    }))
  })

  it('forces root temporary text and registered sub Macros to sub and warns on ignored postfix', () => {
    expect(resolveSnlSemantics(parseSnlSyntaxTree('%text%'), {}).tree.kind).toBe('sub')

    const result = resolveSnlSemantics(parseSnlSyntaxTree('Child@x'), db(['Child', 'sub']))
    expect(result.tree.kind).toBe('sub')
    expect(result.tree.binder_name).toBeUndefined()
    expect(result.tree.source).toBeUndefined()
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'SNL_SUB_IGNORES_BINDER_SUFFIX',
    }))
  })

  it('falls back to the first style with a diagnostic when an explicit style is missing', () => {
    const result = resolveSnlSemantics(parseSnlSyntaxTree('C[missing]'), db(['C']))
    expect(result.tree.kind).toBe('const')
    expect(result.tree.style_name).toBeUndefined()
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'SNL_STYLE_NOT_FOUND',
      tree_path: [],
    }))
  })
})
