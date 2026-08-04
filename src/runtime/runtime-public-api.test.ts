import { describe, expect, it } from 'vitest'
import {
  ReaderRuntime,
  isMacroDocumentV8,
  migrateMacroV7toV8,
  read_localized,
  type I18n,
  type ReaderM,
} from '../snl-react-view'

describe('runtime public API', () => {
  it('exports query-driven Reader and I18n primitives from the package root', () => {
    const runtime = new ReaderRuntime({
      queries: { query_environment: () => ({ language: 'en' as const }) },
    })
    const value: I18n<'en', string> = {
      type: 'i18n',
      default_language: 'en',
      values: { en: 'Ready' },
    }
    const reader: ReaderM<{ language: 'en' }, string> = read_localized(value)
    expect(runtime.run_reader(reader)).toBe('Ready')
  })

  it('exports Macro v8 migration APIs from the package root', () => {
    const migrated = migrateMacroV7toV8({
      name: 'X', description: '', source: { entries: [], urls: [] },
      dynamic_arity: false, tags: [],
      styles: [{ style_name: 'plain', mode: 'text', template: 'X', tags: [] }],
    })
    expect(isMacroDocumentV8({ X: migrated })).toBe(true)
  })
})
