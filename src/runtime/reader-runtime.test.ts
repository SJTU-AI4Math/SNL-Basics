import { describe, expect, it, vi } from 'vitest'
import {
  ReaderRuntime,
  map_reader,
  read_localized,
  type I18n,
  type ReaderM,
} from './reader-runtime'

interface Preferences {
  language: 'en' | 'zh-CN'
  theme: 'light' | 'dark'
}

describe('ReaderRuntime', () => {
  it('runs a ReaderM against a freshly queried environment', () => {
    let preferences: Preferences = { language: 'en', theme: 'light' }
    const query_environment = vi.fn(() => preferences)
    const runtime = new ReaderRuntime({ queries: { query_environment } })
    const label: ReaderM<Preferences, string> = ({ language, theme }) => `${language}:${theme}`

    expect(runtime.run_reader(label)).toBe('en:light')
    preferences = { language: 'zh-CN', theme: 'dark' }
    expect(runtime.run_reader(label)).toBe('zh-CN:dark')
    expect(query_environment).toHaveBeenCalledTimes(2)
  })

  it('maps readers without choosing an environment source', () => {
    const read_count: ReaderM<{ count: number }, number> = ({ count }) => count
    expect(map_reader(read_count, (count) => `#${count}`)({ count: 3 })).toBe('#3')
  })
})

describe('read_localized', () => {
  const text: I18n<'en' | 'zh-CN', string> = {
    type: 'i18n',
    default_language: 'en',
    values: { en: 'Save', 'zh-CN': '保存' },
  }

  it('keeps invariant values unchanged and resolves the queried language', () => {
    expect(read_localized<'en' | 'zh-CN', string>('SNL')({ language: 'zh-CN' })).toBe('SNL')
    expect(read_localized(text)({ language: 'zh-CN' })).toBe('保存')
  })

  it('falls back deterministically to default_language', () => {
    const partial: I18n<'en' | 'zh-CN', string> = {
      type: 'i18n',
      default_language: 'en',
      values: { en: 'Entry' },
    }
    expect(read_localized(partial)({ language: 'zh-CN' })).toBe('Entry')
  })

  it('rejects an empty or internally invalid I18n map', () => {
    const empty: I18n<'en' | 'zh-CN', string> = {
      type: 'i18n',
      default_language: 'en',
      values: {},
    }
    expect(() => read_localized(empty)({ language: 'zh-CN' })).toThrow(/no values/)
  })
})
