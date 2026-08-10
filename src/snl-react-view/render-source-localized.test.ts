import { describe, expect, it } from 'vitest'
import { ReaderRuntime, type I18n } from '../runtime'
import { MacroDataDriver } from '../snl-macro/macro-data-driver'
import {
  read_style_template,
  resolve_style_template,
  resolveNodeLatex,
  resolveRootLatex
} from './render-source'
import type { SnlMacroStyle, SnlMacroTemplate } from '../snl-macro/types'

const localized: I18n<string, SnlMacroTemplate> = {
  type: 'i18n',
  default_language: 'en',
  values: {
    en: { mode: 'text', body: '#0 is a group' },
    'zh-CN': { mode: 'text', body: '#0 是群' },
  },
}

const proseStyle: SnlMacroStyle = {
  style_name: 'prose',
  template: localized,
  tags: [],
}

describe('localized text-style templates', () => {
  it('reads the current language projection inside one semantic style', () => {
    const runtime = new ReaderRuntime({
      queries: { query_environment: () => ({ language: 'zh-CN' }) },
    })
    expect(runtime.run_reader(read_style_template(proseStyle))).toEqual({
      mode: 'text', body: '#0 是群',
    })
  })

  it('rejects an inherited declared default projection at the renderer boundary', () => {
    const values = Object.assign(Object.create({
      fr: { mode: 'text', body: 'Inherited' },
    }), { en: { mode: 'text', body: 'English' } })
    const style: SnlMacroStyle = {
      style_name: 'prose', tags: [],
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
    expect(runtime.run_reader(read_style_template(proseStyle))).toEqual({
      mode: 'text', body: '#0 is a group',
    })
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

  it('resolves one whole template projection without mixing fields across languages', () => {
    const style = {
      style_name: 'localized',
      tags: [],
      template: {
        type: 'i18n',
        default_language: 'en',
        values: {
          en: { mode: 'text', body: '#*', separator: ', ', backend: 'english' },
          'zh-CN': {
            mode: 'block', body: '#*', separator: '、', block_template_name: 'enumerate',
            backend: 'chinese'
          }
        }
      }
    } as unknown as SnlMacroStyle

    expect(resolve_style_template(style, undefined, 'zh-CN')).toEqual({
      mode: 'block', body: '#*', separator: '、', block_template_name: 'enumerate',
      backend: 'chinese'
    })
    expect(resolve_style_template(style, undefined, 'fr')).toEqual({
      mode: 'text', body: '#*', separator: ', ', backend: 'english'
    })
  })

  it('rejects localized projections with different arity contracts', () => {
    const style = {
      style_name: 'bad', tags: [],
      template: {
        type: 'i18n', default_language: 'en',
        values: {
          en: { mode: 'text', body: '#0' },
          'zh-CN': { mode: 'text', body: '#0 与 #1' },
        },
      },
    } as unknown as SnlMacroStyle
    expect(() => resolve_style_template(style, undefined, 'en')).toThrow(/inconsistent arity/)
  })

  it('uses escape-aware arity and macro-level variadic validation', () => {
    const localizedStyle = {
      style_name: 'bad', tags: [],
      template: {
        type: 'i18n', default_language: 'en',
        values: {
          en: { mode: 'text', body: '\\#1 #0' },
          'zh-CN': { mode: 'text', body: '#1' },
        },
      },
    } as unknown as SnlMacroStyle
    expect(() => resolve_style_template(localizedStyle, undefined, 'en')).toThrow(/inconsistent arity/)

    const escapedVariadic = {
      style_name: 'escaped', tags: [], template: { mode: 'text', body: '\\#*' },
    } as unknown as SnlMacroStyle
    expect(() => resolve_style_template(
      escapedVariadic, undefined, 'en', true,
    )).toThrow(/variadic marker/)
  })

  it('rejects every retired Style field and the reserved discriminator hybrid', () => {
    for (const field of [
      'tag', 'mode', 'separator', 'block_template_name',
      'variadic_left', 'variadic_join', 'variadic_right', 'react_renderer_key',
    ]) {
      const style = {
        style_name: 'bad', tags: [], template: { mode: 'text', body: '#0' },
        [field]: 'legacy',
      } as unknown as SnlMacroStyle
      expect(() => resolve_style_template(style)).toThrow(/retired template fields/)
    }
    const hybrid = {
      style_name: 'bad', tags: [],
      template: {
        type: 'i18n', default_language: 'en',
        values: { en: { mode: 'text', body: '#0' } },
        mode: 'block', body: 'IGNORED', separator: 'DROP',
        block_template_name: 'ignored',
      },
    } as unknown as SnlMacroStyle
    expect(() => resolve_style_template(hybrid)).toThrow(/malformed localized template/)

    const misplacedExtension = {
      style_name: 'bad', tags: [], template: { mode: 'text', body: '#0' },
      consumer_backend: { ignored: true },
    } as unknown as SnlMacroStyle
    expect(() => resolve_style_template(misplacedExtension)).toThrow(/outside the schema v11 Style boundary/)
  })

  it('rejects the retired field-level template shape', () => {
    const malformed = {
      style_name: 'formula', mode: 'formula_inline', template: localized, tags: [],
    } as unknown as SnlMacroStyle
    expect(() => read_style_template(malformed)).toThrow(/retired template fields/)
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
        style_name: 'default', tags: [],
        template: {
          type: 'i18n' as const,
          default_language: 'en',
          values: {
            en: { mode: 'text' as const, body: en },
            'zh-CN': { mode: 'text' as const, body: zh },
          },
        },
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
