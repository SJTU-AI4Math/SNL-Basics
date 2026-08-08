import { describe, expect, it } from 'vitest'
import { ReaderRuntime, type I18n } from '../runtime'
import { MacroDataDriver } from '../snl-macro/macro-data-driver'
import { read_style_template, resolveNodeLatex, resolveRootLatex } from './render-source'
import type { SnlMacroStyle } from '../snl-macro/types'

const localized: I18n<string, string> = {
  type: 'i18n',
  default_language: 'en',
  values: { en: '#0 is a group', 'zh-CN': '#0 是群' },
}

const proseStyle: SnlMacroStyle = {
  style_name: 'prose',
  mode: 'text',
  template: localized,
  tags: [],
}

describe('localized text-style templates', () => {
  it('reads the current language projection inside one semantic style', () => {
    const runtime = new ReaderRuntime({
      queries: { query_environment: () => ({ language: 'zh-CN' }) },
    })
    expect(runtime.run_reader(read_style_template(proseStyle))).toBe('#0 是群')
  })

  it('rejects an inherited declared default projection at the renderer boundary', () => {
    const values = Object.assign(Object.create({ fr: 'Inherited' }), { en: 'English' })
    const style: SnlMacroStyle = {
      style_name: 'prose', mode: 'text', tags: [],
      template: { type: 'i18n', default_language: 'fr', values },
    }
    const runtime = new ReaderRuntime({
      queries: { query_environment: () => ({ language: 'de' }) },
    })
    expect(() => runtime.run_reader(read_style_template(style))).toThrow(/malformed localized template/)
  })

  it('ignores prototype properties when resolving a locale', () => {
    const runtime = new ReaderRuntime({
      queries: { query_environment: () => ({ language: 'toString' }) },
    })
    expect(runtime.run_reader(read_style_template(proseStyle))).toBe('#0 is a group')
  })

  it('renders the localized template without changing the selected style', async () => {
    const runtime = new ReaderRuntime({
      queries: { query_environment: () => ({ language: 'zh-CN' }) },
    })
    const driver = new MacroDataDriver({
      queries: {
        query_macro: async ({ macro_name }) => macro_name === 'Group.prose'
          ? {
              name: macro_name,
              description: '',
              source: { entries: [], urls: [] },
              dynamic_arity: false,
              styles: [proseStyle],
              tags: [],
            }
          : null,
      },
    })
    const rendered = await resolveRootLatex(
      { macro_name: 'Group.prose', kind: '', mdata: null, children: [] },
      driver,
      undefined,
      [],
      runtime,
    )
    expect(rendered).toContain('是群')
  })

  it('samples a direct resolveNodeLatex call only once', async () => {
    let reads = 0
    const runtime = new ReaderRuntime({
      queries: { query_environment: () => ({ language: reads++ === 0 ? 'en' : 'zh-CN' }) },
    })
    const driver = new MacroDataDriver({
      queries: { query_macro: async () => ({
        name: 'Group.prose', description: '', source: { entries: [], urls: [] },
        dynamic_arity: false, styles: [proseStyle], tags: [],
      }) },
    })
    const rendered = await resolveNodeLatex(
      { macro_name: 'Group.prose', kind: '', mdata: null, children: [] },
      driver,
      [],
      undefined,
      runtime,
    )
    expect(rendered).toContain('is a group')
    expect(rendered).not.toContain('是群')
    expect(reads).toBe(1)
  })

  it('rejects unvalidated localized templates outside text mode', () => {
    const malformed = {
      style_name: 'formula', mode: 'formula_inline', template: localized, tags: [],
    } as unknown as SnlMacroStyle
    expect(() => read_style_template(malformed)).toThrow(/only in text mode/)
  })

  it('samples language once so one async tree cannot mix locales', async () => {
    let reads = 0
    const runtime = new ReaderRuntime({
      queries: {
        query_environment: () => ({ language: reads++ % 2 === 0 ? 'en' : 'zh-CN' }),
      },
    })
    const makeMacro = (name: string, en: string, zh: string) => ({
      name, description: '', source: { entries: [], urls: [] },
      dynamic_arity: false,
      tags: [],
      styles: [{
        style_name: 'default', mode: 'text' as const, tags: [],
        template: { type: 'i18n' as const, default_language: 'en', values: { en, 'zh-CN': zh } },
      }],
    })
    const macros = {
      Parent: makeMacro('Parent', 'EN(#0)', 'ZH(#0)'),
      Child: makeMacro('Child', 'EN_CHILD', 'ZH_CHILD'),
    }
    const driver = new MacroDataDriver({
      queries: { query_macro: async ({ macro_name }) => macros[macro_name as keyof typeof macros] ?? null },
    })
    const rendered = await resolveRootLatex({
      macro_name: 'Parent', kind: '', mdata: null,
      children: [{ macro_name: 'Child', kind: '', mdata: null, children: [] }],
    }, driver, undefined, [], runtime)
    expect(rendered).toContain('EN_CHILD')
    expect(rendered).not.toContain('ZH_CHILD')
    expect(reads).toBe(1)
  })
})
