// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSnlSyntaxTree } from '../snl-syntax-tree/parser'
import { parseSanitizedSvgTemplate } from '../snl-react-view/svg-template'
import {
  DEMO_MACROS,
  DEMO_PRESETS,
  DEMO_SVG_SOURCES,
} from '../../examples/basic-demo/src/demoPresets'

describe('basic demo mathematical SVG presets', () => {
  it('offers distinct higher-category, cube, topology, geometry, and function-plot presets', () => {
    expect(DEMO_PRESETS.map((preset) => preset.id)).toEqual([
      'higher-category',
      'derived-cube',
      'topology-cover',
      'projective-geometry',
      'function-plot',
    ])
    expect(new Set(DEMO_PRESETS.map((preset) => preset.source)).size).toBe(DEMO_PRESETS.length)
    for (const preset of DEMO_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(4)
      expect(preset.description.length).toBeGreaterThan(20)
      const tree = parseSnlSyntaxTree(preset.source)
      expect(tree.macro_name).toBe(preset.rootMacro)
      expect(tree.children).toHaveLength(preset.slotCount)
      for (const child of tree.children) {
        const childMacro = DEMO_MACROS[child.macro_name]
        expect(childMacro).toBeDefined()
        expect(childMacro.styles[0]?.template.mode).toMatch(/^(formula_inline|text)$/)
      }
    }
  })

  it('derives the higher-category template by extracting formulas from a pure TikZ SVG', () => {
    const tikzRoot = resolve(process.cwd(), 'examples/basic-demo/tikz')
    const source = readFileSync(resolve(tikzRoot, 'higher-category.tex'), 'utf8')
    const full = readFileSync(resolve(tikzRoot, 'generated/higher-category.full.svg'), 'utf8')
    const template = readFileSync(resolve(tikzRoot, 'generated/higher-category.template.svg'), 'utf8')

    expect(source).toContain('\\begin{tikzpicture}')
    expect(source).toContain('\\SNLFormula{0}{$\\mathcal{C}$}')
    expect(source).toContain('\\SNLFormula{8}{$\\alpha$}')
    expect([...source.matchAll(/\\SNLFormula\{(\d+)\}/g)].map((match) => Number(match[1]))).toEqual(
      Array.from({ length: 9 }, (_, index) => index),
    )
    expect([...full.matchAll(/data-snl-formula=['"](\d+)['"]/g)].map((match) => Number(match[1]))).toEqual(
      Array.from({ length: 9 }, (_, index) => index),
    )
    expect(full).toContain('<use ')
    expect(template).not.toMatch(/data-snl-(?:formula|anchor)/)
    expect(template).not.toMatch(/<text\b|<use\b/)
    expect([...template.matchAll(/data-snl-slot=["'](\d+)["']/g)].map((match) => Number(match[1]))).toEqual(
      Array.from({ length: 9 }, (_, index) => index),
    )
    const anchorCenters = [...full.matchAll(/data-snl-anchor=['"](\d+)['"] data-snl-bbox=['"]([^'"]+)['"]/g)].map((match) => {
      const [x, y, width, height] = match[2].trim().split(/\s+/).map(Number)
      return [Number(match[1]), Number((x + width / 2).toFixed(6)), Number((y + height / 2).toFixed(6))]
    })
    const slotCenters = [...template.matchAll(/data-snl-slot=["](\d+)["] transform=["]translate\(([-\d.]+) ([-\d.]+)\)["]/g)]
      .map((match) => [Number(match[1]), Number(match[2]), Number(match[3])])
    expect(slotCenters).toEqual(anchorCenters)
    const higherChildren = DEMO_PRESETS[0].source.match(/\((.*)\)/)?.[1].split(',') ?? []
    expect(higherChildren.map((name) => {
      const selected = DEMO_MACROS[name]?.styles[0]?.template
      return selected && 'body' in selected ? selected.body : undefined
    })).toEqual(['\\mathcal{C}', '\\mathcal{D}', '\\mathcal{E}', 'F', 'G', 'H', '\\eta', '\\theta', '\\alpha'])
    expect(DEMO_SVG_SOURCES['higher-category.svg']).toBe(template.trim())
  })

  it('keeps mathematical objects in contiguous SNL slots rather than SVG text', () => {
    for (const preset of DEMO_PRESETS) {
      const macro = DEMO_MACROS[preset.diagramMacro]
      expect(macro).toBeDefined()
      const selected = macro.styles[0]?.template
      expect(typeof selected).toBe('object')
      if (!selected || typeof selected !== 'object' || !('svg_template' in selected)) throw new Error(`missing SVG projection for ${preset.id}`)
      expect(selected.block_template_name).toBe('svg_template')
      const source = DEMO_SVG_SOURCES[selected.svg_template!.asset.source]
      expect(source).toBeDefined()
      expect(source).not.toMatch(/<text\b/i)
      expect((source.match(/<path\b/g) ?? []).length).toBeGreaterThanOrEqual(4)
      const parsed = parseSanitizedSvgTemplate(source)
      expect(parsed.slots.map((slot) => slot.index)).toEqual(
        Array.from({ length: preset.slotCount }, (_, index) => index),
      )
    }
  })

  it('draws the advertised cubic, derivative, extrema, and circumconic faithfully', () => {
    const plot = parseSanitizedSvgTemplate(DEMO_SVG_SOURCES['function-plot.svg']).root
    const functionPath = plot.querySelector('path[stroke="#3b82f6"]')?.getAttribute('d') ?? ''
    const functionNumbers = functionPath.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
    expect(functionNumbers).toHaveLength(8)
    const [, y0, , y1, , y2, , y3] = functionNumbers
    const cubicA = -y0 + 3 * y1 - 3 * y2 + y3
    const cubicB = 3 * y0 - 6 * y1 + 3 * y2
    const cubicC = -3 * y0 + 3 * y1
    const discriminant = (2 * cubicB) ** 2 - 4 * 3 * cubicA * cubicC
    const stationary = [
      (-2 * cubicB - Math.sqrt(discriminant)) / (6 * cubicA),
      (-2 * cubicB + Math.sqrt(discriminant)) / (6 * cubicA),
    ].sort((left, right) => left - right)
    expect(stationary).toEqual([0.25, 0.75])

    const derivativePath = plot.querySelector('path[stroke="#f97316"]')?.getAttribute('d') ?? ''
    const derivativeNumbers = derivativePath.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
    expect(derivativeNumbers).toHaveLength(6)
    const [, q0, , q1, , q2] = derivativeNumbers
    const qa = q0 - 2 * q1 + q2
    const qb = -2 * q0 + 2 * q1
    const qc = q0 - 210
    const qd = qb ** 2 - 4 * qa * qc
    const derivativeZeros = [(-qb - Math.sqrt(qd)) / (2 * qa), (-qb + Math.sqrt(qd)) / (2 * qa)].sort((left, right) => left - right)
    expect(derivativeZeros).toEqual(stationary)

    const point = (p0: number, p1: number, p2: number, p3: number, t: number) =>
      (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3
    const criticalPoints = [...plot.querySelectorAll('circle[fill="#22c55e"]')].map((circle) => [Number(circle.getAttribute('cx')), Number(circle.getAttribute('cy'))])
    expect(criticalPoints).toEqual(stationary.map((t) => [
      point(functionNumbers[0], functionNumbers[2], functionNumbers[4], functionNumbers[6], t),
      point(y0, y1, y2, y3, t),
    ]))

    const geometry = parseSanitizedSvgTemplate(DEMO_SVG_SOURCES['projective-geometry.svg']).root
    const circle = geometry.querySelector('circle')!
    const center = [Number(circle.getAttribute('cx')), Number(circle.getAttribute('cy'))]
    const radius = Number(circle.getAttribute('r'))
    const triangle = geometry.querySelector('path[stroke="#3b82f6"]')?.getAttribute('d') ?? ''
    const coordinates = triangle.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
    const vertices = [[coordinates[0], coordinates[1]], [coordinates[2], coordinates[3]], [coordinates[4], coordinates[5]]]
    for (const [x, y] of vertices) {
      expect(Math.hypot(x - center[0], y - center[1])).toBeCloseTo(radius, 1)
    }
  })

})
