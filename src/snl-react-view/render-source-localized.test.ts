import { describe, expect, it } from 'vitest'
import { ReaderRuntime, type I18n } from '../runtime'
import { MacroDataDriver } from '../snl-macro/macro-data-driver'
import { read_style_template, resolveRootLatex } from './render-source'
import type { SnlMacroStyle } from '../snl-macro/types'

const template: I18n<string, string> = {
  type: 'i18n',
  default_language: 'en',
  values: { en: '#0 is a group', 'zh-CN': '#0 是群' },
}

const style: SnlMacroStyle = {
  style_name: 'prose',
  mode: 'text',
  template,
  tags: [],
}

describe('read_style_template', () => {
  it('returns a ReaderM resolved by the consumer query runtime', () => {
    let language = 'en'
    const runtime = new ReaderRuntime({
      queries: { query_environment: () => ({ language }) },
    })
    const reader = read_style_template(style)
    expect(runtime.run_reader(reader)).toBe('#0 is a group')
    language = 'zh-CN'
    expect(runtime.run_reader(reader)).toBe('#0 是群')
  })

  it('keeps formula templates invariant under language changes', () => {
    const formula: SnlMacroStyle = {
      style_name: 'default',
      mode: 'formula_inline',
      template: '#0 + #1',
      tags: [],
    }
    expect(read_style_template(formula)({ language: 'zh-CN' })).toBe('#0 + #1')
  })

  it('renders localized text Macro templates through an injected runtime', async () => {
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
              styles: [style],
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
})
