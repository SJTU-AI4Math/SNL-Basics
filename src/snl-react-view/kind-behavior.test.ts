import { describe, expect, it } from 'vitest'
import type { SnlMacro } from '../snl-macro/types'
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'
import { behaviorKind, resolveRenderedKind } from './kind-behavior'

const node: SnlSyntaxTree = { macro_name: 'Demo', kind: '', mdata: null, children: [] }
const macro: SnlMacro = {
  name: 'Demo', description: '', source: { entries: [], urls: [] }, kind: 'custom-skin',
  dynamic_arity: false,
  styles: [{ style_name: 'default',  template: { mode: 'formula_inline', body: 'D' }, tags: [] }],
  tags: [],
}

describe('custom Macro kind compatibility', () => {
  it('preserves the custom display kind and falls back to const behavior', () => {
    expect(resolveRenderedKind(node, macro, true)).toBe('custom-skin')
    expect(behaviorKind('custom-skin')).toBe('const')
    expect(behaviorKind('rule')).toBe('const')
  })
})
