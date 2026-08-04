import { describe, expect, it } from 'vitest'
import type { EntryContent } from '../entry-react/entry-data-driver'
import type { I18n } from '../runtime'
import type { SnlMacro, SnlMacroStyle } from './types'

const localized: I18n<string, string> = {
  type: 'i18n',
  default_language: 'en',
  values: { en: 'Group', 'zh-CN': '群' },
}

describe('localized content schema', () => {
  it('keeps every Macro style template a plain string', () => {
    const style: SnlMacroStyle = {
      style_name: 'prose_en',
      mode: 'text',
      template: 'Group',
      tags: [],
    }
    expect(style.template).toBe('Group')
  })

  it('stores language-dependent default style names at Macro level', () => {
    const macro: SnlMacro = {
      name: 'Group.prose',
      description: '',
      source: { entries: [], urls: [] },
      dynamic_arity: false,
      default_style: { en: 'prose_en', 'zh-CN': 'prose_zh' },
      styles: [
        { style_name: 'prose_en', mode: 'text', template: 'Group', tags: [] },
        { style_name: 'prose_zh', mode: 'text', template: '群', tags: [] },
      ],
      tags: [],
    }
    expect(macro.default_style['zh-CN']).toBe('prose_zh')
  })

  it('continues to accept I18n for non-SNL Entry content', () => {
    const content: EntryContent = {
      snl: 'Group(G)',
      markdown: localized,
      typst: localized,
      latex: localized,
      text: localized,
    }
    expect(content.markdown).toEqual(localized)
  })
})

const _text_style: SnlMacroStyle = {
  style_name: 'text',
  mode: 'text',
  // @ts-expect-error Macro templates are strings; language variants are separate styles
  template: localized,
  tags: [],
}

const _formula_style: SnlMacroStyle = {
  style_name: 'formula',
  mode: 'formula_inline',
  // @ts-expect-error formula templates are language-invariant strings
  template: localized,
  tags: [],
}

const _block_style: SnlMacroStyle = {
  style_name: 'block',
  mode: 'block',
  // @ts-expect-error block templates are language-invariant strings
  template: localized,
  tags: [],
}

const _entry_content: EntryContent = {
  // @ts-expect-error SNL source is language-invariant structured syntax
  snl: localized,
}

void [_text_style, _formula_style, _block_style, _entry_content]
