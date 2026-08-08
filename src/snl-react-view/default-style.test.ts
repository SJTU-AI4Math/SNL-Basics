import { describe, expect, it } from 'vitest'
import type { SnlMacro } from '../snl-macro/types'
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'
import { resolveStyle } from './render-source'

function macro(): SnlMacro {
  return {
    name: 'Example.macro',
    description: '',
    source: { entries: [], urls: [] },
    dynamic_arity: false,
    styles: [
      { style_name: 'first', mode: 'formula_inline', template: 'FIRST', tags: [] },
      { style_name: 'other', mode: 'text', template: 'OTHER', tags: [] },
    ],
    tags: [],
  }
}

const implicitNode: SnlSyntaxTree = {
  macro_name: 'Example.macro',
  kind: '',
  mdata: null,
  children: [],
}

describe('implicit default style', () => {
  it('always uses styles[0] when source omits [style]', () => {
    expect(resolveStyle(implicitNode, macro(), 'zh-CN').style_name).toBe('first')
    expect(resolveStyle(implicitNode, macro(), 'en').style_name).toBe('first')
  })

  it('keeps an explicit [style] authoritative', () => {
    const explicitNode = { ...implicitNode, style_name: 'other' }
    expect(resolveStyle(explicitNode, macro(), 'zh-CN').style_name).toBe('other')
  })

  it('reports an explicit style name that does not exist', () => {
    const explicitNode = { ...implicitNode, style_name: 'missing' }
    expect(() => resolveStyle(explicitNode, macro(), 'en'))
      .toThrow(/unknown style.*missing.*Example\.macro/i)
  })
})
