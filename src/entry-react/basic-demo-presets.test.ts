// @vitest-environment jsdom
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
    expect(functionNumbers[1]).toBeGreaterThan((functionNumbers.at(-1) ?? 0) + 100)

    const derivativePath = plot.querySelector('path[stroke="#f97316"]')?.getAttribute('d') ?? ''
    expect(derivativePath).toBe('M90 120 Q360 350 630 120')
    const criticalPoints = [...plot.querySelectorAll('circle[fill="#22c55e"]')].map((circle) => Number(circle.getAttribute('cy')))
    expect(criticalPoints[0]).toBeLessThan(criticalPoints[1])

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
