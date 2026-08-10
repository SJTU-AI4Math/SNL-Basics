import { describe, expect, it } from 'vitest'
import type { EntryContent } from '../entry-react/entry-data-driver'
import type { I18n } from '../runtime'
import type { SnlMacro, SnlMacroStyle, SnlMacroTemplate } from './types'

const localizedText: I18n<string, string> = {
  type: 'i18n',
  default_language: 'en',
  values: { en: 'Group', 'zh-CN': '群' },
}

const localizedTemplate: I18n<string, SnlMacroTemplate> = {
  type: 'i18n',
  default_language: 'en',
  values: {
    en: { mode: 'text', body: '#0 is a group', separator: ', ' },
    'zh-CN': { mode: 'text', body: '#0 是群', separator: '、' },
  },
}

describe('localized content schema', () => {
  it('stores whole localized templates in one semantic Macro style', () => {
    const style: SnlMacroStyle = {
      style_name: 'prose',
      template: localizedTemplate,
      tags: [],
    }
    expect(style.template).toEqual(localizedTemplate)
  })

  it('uses styles[0] as the only implicit default without a language-to-style map', () => {
    const macro: SnlMacro = {
      name: 'Group.prose',
      description: '',
      source: { entries: [], urls: [] },
      dynamic_arity: false,
      styles: [
        { style_name: 'prose', template: localizedTemplate, tags: [] },
        { style_name: 'compact', template: { mode: 'text', body: 'Group' }, tags: [] },
      ],
      tags: [],
    }
    expect(macro.styles[0].style_name).toBe('prose')
    expect(macro).not.toHaveProperty('default_style')
  })

  it('allows a language projection to change render mode atomically', () => {
    const style: SnlMacroStyle = {
      style_name: 'mixed',
      tags: [],
      template: {
        type: 'i18n',
        default_language: 'en',
        values: {
          en: { mode: 'formula_inline', body: '#0' },
          'zh-CN': { mode: 'block', body: '#*', block_template_name: 'enumerate' },
        },
      },
    }
    expect(style.template).toHaveProperty('values.zh-CN.block_template_name', 'enumerate')
  })

  it('continues to accept I18n for non-SNL Entry content', () => {
    const content: EntryContent = {
      snl: 'Group(G)',
      markdown: localizedText,
      typst: localizedText,
      latex: localizedText,
      text: localizedText,
    }
    expect(content.markdown).toEqual(localizedText)
  })
})

const _entry_content: EntryContent = {
  // @ts-expect-error SNL source is language-invariant structured syntax
  snl: localizedText,
}
void _entry_content
