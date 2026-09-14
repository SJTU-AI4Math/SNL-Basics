import { describe, expect, it } from 'vitest'
import type { SnlMacroStyle } from '../snl-macro/types'
import { assert_valid_style_template } from './render-source'

const style = (template: unknown): SnlMacroStyle => ({
  style_name: 'default', tags: [], template: template as SnlMacroStyle['template'],
})
const block = (block_width_px?: unknown) => ({
  mode: 'block', body: '#0', block_template_name: 'custom-svg',
  svg_template: { block_width_px, consumer_extension: { preserve: true } },
})

describe('SVG block width at the render-time template boundary', () => {
  it('admits default, fractional and maximum widths without changing opaque consumer fields', () => {
    for (const width of [undefined, 0.5, 340, 4096]) {
      const template = block(width)
      const before = structuredClone(template)
      expect(() => assert_valid_style_template(style(template), false)).not.toThrow()
      expect(template).toEqual(before)
    }
  })

  it('rejects invalid widths, malformed projections and non-block ownership before rendering', () => {
    for (const width of [0, -1, 4097, NaN, Infinity, null, '340']) {
      expect(() => assert_valid_style_template(style(block(width)), false)).toThrow(/block_width_px/)
      expect(() => assert_valid_style_template(style({
        type: 'i18n', default_language: 'en', values: { en: block(340), zh: block(width) },
      }), false)).toThrow(/block_width_px/)
    }
    for (const svg_template of [null, [], 'svg']) {
      expect(() => assert_valid_style_template(style({ ...block(), svg_template }), false)).toThrow(/svg_template/)
    }
    for (const mode of ['text', 'formula_inline', 'formula_display']) {
      expect(() => assert_valid_style_template(style({ ...block(), block_template_name: undefined, mode }), false)).toThrow(/block mode/)
    }
  })
})
