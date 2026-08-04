import { describe, expect, it } from 'vitest'
import { ReaderRuntime } from '../runtime'
import { MacroDataDriver } from '../snl-macro/macro-data-driver'
import { read_style_template, resolveRootLatex } from './render-source'
import type { SnlMacroStyle } from '../snl-macro/types'

const englishStyle: SnlMacroStyle = {
  style_name: 'english',
  mode: 'text',
  template: '#0 is a group',
  tags: [],
}

const chineseStyle: SnlMacroStyle = {
  style_name: 'chinese',
  mode: 'text',
  template: '#0 是群',
  tags: [],
}

describe('language-dependent style resolution', () => {
  it('keeps every individual style template language-invariant', () => {
    const runtime = new ReaderRuntime({
      queries: { query_environment: () => ({ language: 'zh-CN' }) },
    })
    expect(runtime.run_reader(read_style_template(englishStyle))).toBe('#0 is a group')
  })

  it('renders the current language default style through an injected runtime', async () => {
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
              default_style: { en: 'english', 'zh-CN': 'chinese' },
              styles: [englishStyle, chineseStyle],
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
      default_style: { en: 'en', 'zh-CN': 'zh' },
      tags: [],
      styles: [
        { style_name: 'en', mode: 'formula_inline' as const, template: en, tags: [] },
        { style_name: 'zh', mode: 'formula_inline' as const, template: zh, tags: [] },
      ],
    })
    const macros = {
      Parent: makeMacro('Parent', String.raw`\\operatorname{EN}(#0)`, String.raw`\\operatorname{ZH}(#0)`),
      Child: makeMacro('Child', String.raw`\\mathrm{EN_CHILD}`, String.raw`\\mathrm{ZH_CHILD}`),
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
