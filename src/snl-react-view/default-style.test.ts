import { describe, expect, it } from 'vitest'
import type { SnlMacro } from '../snl-macro/types'
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'
import { resolveStyle } from './render-source'

function macro(default_style: Record<string, string>): SnlMacro {
  return {
    name: 'Example.macro',
    description: '',
    source: { entries: [], urls: [] },
    dynamic_arity: false,
    default_style,
    styles: [
      { style_name: 'first', mode: 'formula_inline', template: 'FIRST', tags: [] },
      { style_name: 'english', mode: 'text', template: 'ENGLISH', tags: [] },
      { style_name: 'chinese', mode: 'text', template: '中文', tags: [] },
    ],
    tags: [],
  } as SnlMacro
}

const implicitNode: SnlSyntaxTree = {
  macro_name: 'Example.macro',
  kind: '',
  mdata: null,
  children: [],
}

describe('language-dependent default styles', () => {
  it('uses the current language mapping when the source omits [style]', () => {
    expect((resolveStyle as any)(implicitNode, macro({ en: 'english', 'zh-CN': 'chinese' }), 'zh-CN').style_name)
      .toBe('chinese')
  })

  it('falls back to the English mapping when the current language is absent', () => {
    expect((resolveStyle as any)(implicitNode, macro({ en: 'english' }), 'fr-FR').style_name)
      .toBe('english')
  })

  it('falls back to styles[0] when both current language and English are absent', () => {
    expect((resolveStyle as any)(implicitNode, macro({ ja: 'chinese' }), 'fr-FR').style_name)
      .toBe('first')
  })

  it('keeps an explicit [style] authoritative over language defaults', () => {
    const explicitNode = { ...implicitNode, style_name: 'first' }
    expect((resolveStyle as any)(explicitNode, macro({ en: 'english', 'zh-CN': 'chinese' }), 'zh-CN').style_name)
      .toBe('first')
  })

  it('reports a mapped style name that does not exist', () => {
    expect(() => (resolveStyle as any)(implicitNode, macro({ en: 'missing' }), 'en'))
      .toThrow(/default style.*missing.*Example\.macro/i)
  })
})
