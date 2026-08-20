import katex from 'katex'
import { describe, expect, it } from 'vitest'
import {
  deriveFixedFormulaMetrics,
  formulaForeignMarkerLatex,
  readFixedFormulaEmbedPolicy,
} from './formula-foreign-box'

const template = {
  mode: 'block' as const,
  body: '#0',
  block_template_name: 'svg-template',
  svg_template: {
    formula_embed: { total_height_em: 2, baseline_ratio: 0.75 },
  },
}

describe('fixed formula foreign boxes', () => {
  it('derives width, height, and depth from the sanitized viewBox and trusted baseline policy', () => {
    const policy = readFixedFormulaEmbedPolicy(template)
    expect(deriveFixedFormulaMetrics('0 0 640 370', policy)).toEqual({
      widthEm: 128 / 37,
      heightEm: 1.5,
      depthEm: 0.5,
      totalHeightEm: 2,
    })
  })

  it.each([
    { total_height_em: 0, baseline_ratio: 0.5 },
    { total_height_em: Number.NaN, baseline_ratio: 0.5 },
    { total_height_em: 2, baseline_ratio: 0 },
    { total_height_em: 2, baseline_ratio: 1 },
    { total_height_em: 2, baseline_ratio: Number.POSITIVE_INFINITY },
  ])('rejects malformed trusted fixed metrics %#', formula_embed => {
    expect(() => readFixedFormulaEmbedPolicy({ ...template, svg_template: { formula_embed } })).toThrow()
  })

  it('requires an explicit trusted bounded-measurement opt-in', () => {
    expect(readFixedFormulaEmbedPolicy(template).dynamicMeasurement).toBe(false)
    expect(readFixedFormulaEmbedPolicy({
      ...template,
      svg_template: { formula_embed: { total_height_em: 2, baseline_ratio: 0.75, measurement: 'bounded' } },
    }).dynamicMeasurement).toBe(true)
    expect(() => readFixedFormulaEmbedPolicy({
      ...template,
      svg_template: { formula_embed: { total_height_em: 2, baseline_ratio: 0.75, measurement: 'unbounded' } },
    })).toThrow(/measurement/)
  })

  it('emits a separate deterministic formula marker with TeX height and depth', () => {
    const latex = formulaForeignMarkerLatex('0.2/slot:7', {
      widthEm: 2,
      heightEm: 1.25,
      depthEm: 0.25,
      totalHeightEm: 1.5,
    })
    expect(latex).toContain('snlFormulaForeignMarker')
    const html = katex.renderToString(latex, { trust: true, strict: false })
    expect(html).toContain('data-snl-formula-foreign-marker')
    expect(latex).toContain('\\rule[-0.25em]{2em}{1.5em}')
    expect(latex).not.toContain('data-snl-slot')
    expect(formulaForeignMarkerLatex('0.2/slot:7', {
      widthEm: 2, heightEm: 1.25, depthEm: 0.25, totalHeightEm: 1.5,
    })).toBe(latex)
    expect(formulaForeignMarkerLatex('0.2/slot:8', {
      widthEm: 2, heightEm: 1.25, depthEm: 0.25, totalHeightEm: 1.5,
    })).not.toBe(latex)
  })
})
