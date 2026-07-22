import { describe, expect, it } from 'vitest'
import type { EntryContent } from '../entry-react/entry-data-driver'
import type { I18n } from '../runtime'
import type { SnlMacroStyle } from './types'

const localized: I18n<string, string> = {
  type: 'i18n',
  default_language: 'en',
  values: { en: 'Group', 'zh-CN': '群' },
}

describe('localized content schema', () => {
  it('accepts I18n only for text Macro templates', () => {
    const style: SnlMacroStyle = {
      style_name: 'prose',
      mode: 'text',
      template: localized,
      tags: [],
    }
    expect(style.template).toEqual(localized)
  })

  it('accepts I18n for non-SNL Entry content', () => {
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

// Formula and block templates are language-invariant render programs.
// @ts-expect-error formula templates cannot be localized
const _formula_style: SnlMacroStyle = {
  style_name: 'formula',
  mode: 'formula_inline',
  template: localized,
  tags: [],
}

// @ts-expect-error block renderer templates cannot be localized
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

void [_formula_style, _block_style, _entry_content]
