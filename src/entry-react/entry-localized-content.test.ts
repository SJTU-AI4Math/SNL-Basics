import { describe, expect, it } from 'vitest'
import type { I18n } from '../runtime'
import {
  read_entry_content,
  resolve_entry_content,
  type EntryContent,
} from './entry-data-driver'

const zh: I18n<string, string> = {
  type: 'i18n',
  default_language: 'en',
  values: { en: 'A group', 'zh-CN': '群' },
}

describe('read_entry_content', () => {
  it('resolves every non-SNL channel and preserves SNL', () => {
    const content: EntryContent = {
      snl: 'Group(G)',
      markdown: zh,
      typst: zh,
      latex: zh,
      text: zh,
    }
    const resolved = read_entry_content(content)({ language: 'zh-CN' })
    expect(resolved).toEqual({
      snl: 'Group(G)',
      markdown: '群',
      typst: '群',
      latex: '群',
      text: '群',
    })
  })

  it('requires an injected runtime only when localized data is present', () => {
    expect(resolve_entry_content({ markdown: 'Invariant' })).toEqual({
      markdown: 'Invariant',
    })
    expect(() => resolve_entry_content({ markdown: zh })).toThrow(/reader_runtime/)
  })
})
