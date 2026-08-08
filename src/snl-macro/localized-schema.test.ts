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
  it('stores localized text in one semantic Macro style', () => {
    const style: SnlMacroStyle = {
      style_name: 'prose',
      mode: 'text',
      template: localized,
      tags: [],
    }
    expect(style.template).toEqual(localized)
  })

  it('uses styles[0] as the only implicit default without a language-to-style map', () => {
    const macro: SnlMacro = {
      name: 'Group.prose',
      description: '',
      source: { entries: [], urls: [] },
      dynamic_arity: false,
      styles: [
        { style_name: 'prose', mode: 'text', template: localized, tags: [] },
        { style_name: 'compact', mode: 'text', template: 'Group', tags: [] },
      ],
      tags: [],
    }
    expect(macro.styles[0].style_name).toBe('prose')
    expect(macro).not.toHaveProperty('default_style')
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
  template: localized,
  tags: [],
}

// @ts-expect-error formula templates are language-invariant strings
const _formula_style: SnlMacroStyle = {
  style_name: 'formula',
  mode: 'formula_inline',
  template: localized,
  tags: [],
}

// @ts-expect-error block templates are language-invariant strings
const _block_style: SnlMacroStyle = {
  style_name: 'block',
  mode: 'block',
  template: localized,
  tags: [],
}

const _entry_content: EntryContent = {
  // @ts-expect-error SNL source is language-invariant structured syntax
  snl: localized,
}

void [_text_style, _formula_style, _block_style, _entry_content]
