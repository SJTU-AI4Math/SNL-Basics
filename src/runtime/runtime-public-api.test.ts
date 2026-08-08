import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  ReaderRuntime,
  isMacroDocumentV9,
  isSnlIdentifier,
  migrateMacroV7toV9,
  read_localized,
  type I18n,
  type MacroV8Style,
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
    expect(isSnlIdentifier('群.是群')).toBe(true)
  })

  it('exports a v8 Style type whose Template is invariant and block renderer key is block-only', () => {
    expectTypeOf<MacroV8Style['template']>().toEqualTypeOf<string>()
    // @ts-expect-error formula styles cannot carry a block renderer dispatch key
    const invalidFormula: MacroV8Style = {
      style_name: 'formula', mode: 'formula_inline', template: '#0', tags: [],
      block_template_name: 'list',
    }
    void invalidFormula
  })

  it('exports Macro v9 migration APIs from the package root', () => {
    const migrated = migrateMacroV7toV9({
      name: 'X', description: '', source: { entries: [], urls: [] },
      dynamic_arity: false, tags: [],
      styles: [{ style_name: 'plain', mode: 'text', template: 'X', tags: [] }],
    })
    expect(isMacroDocumentV9({ X: migrated })).toBe(true)
  })
})
