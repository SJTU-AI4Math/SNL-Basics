import { describe, expect, it, vi } from 'vitest'
import { MacroDataDriver } from '../snl-macro/macro-data-driver'
import type { SnlMacro } from '../snl-macro/types'
import { resolveRootFormulaRender } from './render-source'

function macro(name: string, template: SnlMacro['styles'][number]['template']): SnlMacro {
  return {
    name,
    description: '',
    source: { entries: [], urls: [] },
    dynamic_arity: false,
    styles: [{ style_name: 'default', tags: [], template }],
    tags: [],
  }
}

const rootMacro = macro('Formula.wrap', { mode: 'formula_inline', body: '#0+#1+#2' })
const svgTemplate = {
  mode: 'block' as const,
  body: '#0',
  block_template_name: 'svg-template',
  svg_template: {
    generation: 7,
    producer_revision: 'producer-2',
    asset: { source: 'diagram.svg', base_identity: 'workspace', revision: 'r1', request_epoch: 3 },
    accessibility: { label: 'diagram' },
    formula_embed: { total_height_em: 2, baseline_ratio: 0.75 },
  },
}
const svgMacro = macro('Consumer.diagram', svgTemplate)
const leafMacro = macro('leaf', { mode: 'formula_inline', body: 'x' })

function driver(): MacroDataDriver {
  const macros: Record<string, SnlMacro> = {
    'Formula.wrap': rootMacro,
    'Consumer.diagram': svgMacro,
    leaf: leafMacro,
  }
  return new MacroDataDriver({ queries: { query_macro: async ({ macro_name }) => macros[macro_name] ?? null } })
}

const root = {
  macro_name: 'Formula.wrap', kind: '', mdata: null,
  children: [
    { macro_name: 'leaf', kind: '', mdata: null, children: [] },
    { macro_name: 'Consumer.diagram', kind: '', mdata: null, children: [
      { macro_name: 'leaf', kind: '', mdata: null, children: [] },
    ] },
    { macro_name: 'leaf', kind: '', mdata: null, children: [] },
  ],
}

describe('formula foreign render planning', () => {
  it('replaces an opted-in block with a distinct marker and returns one trusted plan', async () => {
    const resolveBlock = vi.fn(async ({ template, treePath }) => ({
      identity: `diagram:${treePath.join('.')}:7`,
      metrics: { widthEm: 2, heightEm: 1.5, depthEm: 0.5, totalHeightEm: 2 },
      rendererKey: template.block_template_name!,
      producer: 'producer-2',
      generation: 7,
      accessibilityLabel: 'diagram',
    }))
    const result = await resolveRootFormulaRender(root, driver(), { resolveBlock })
    expect(result.latex).toContain('snl-formula-foreign-marker')
    expect(result.latex).not.toContain('cannot be used inside a formula')
    expect(result.foreignBoxes).toHaveLength(1)
    expect(result.foreignBoxes[0]).toMatchObject({ treePath: [1], node: root.children[1], template: svgTemplate })
    expect(resolveBlock).toHaveBeenCalledWith(expect.objectContaining({
      node: root.children[1], template: svgTemplate, treePath: [1], dynamicArity: false,
    }))
  })

  it('merges asynchronously resolved sibling plans in source order without cross-subtree rollback', async () => {
    let releaseSlow!: () => void
    const slow = new Promise<void>((resolve) => { releaseSlow = resolve })
    const slowLeaf = macro('slow-leaf', { mode: 'formula_inline', body: 'y' })
    const macros: Record<string, SnlMacro> = {
      'Formula.wrap': rootMacro, 'Consumer.diagram': svgMacro, leaf: leafMacro, 'slow-leaf': slowLeaf,
    }
    const delayedDriver = new MacroDataDriver({ queries: {
      query_macro: async ({ macro_name }) => {
        if (macro_name === 'slow-leaf') await slow
        return macros[macro_name] ?? null
      },
    } })
    const siblings = {
      ...root,
      children: [
        { ...root.children[1], children: [root.children[0]] },
        { ...root.children[1], children: [{ macro_name: 'slow-leaf', kind: '', mdata: null, children: [] }] },
        root.children[2],
      ],
    }
    const resolvedPaths: string[] = []
    const pending = resolveRootFormulaRender(siblings, delayedDriver, {
      resolveBlock: async ({ treePath, template }) => {
        resolvedPaths.push(treePath.join('.'))
        return {
          identity: `sibling:${treePath.join('.')}`,
          metrics: { widthEm: 2, heightEm: 1.5, depthEm: 0.5, totalHeightEm: 2 },
          rendererKey: template.block_template_name!, producer: 'p', generation: 1, accessibilityLabel: 'sibling',
        }
      },
    })
    await vi.waitFor(() => expect(resolvedPaths).toEqual(['0']))
    releaseSlow()
    const result = await pending
    expect(resolvedPaths).toEqual(['0', '1'])
    expect(result.foreignBoxes.map(plan => plan.treePath)).toEqual([[0], [1]])
    expect(result.latex.match(/snl-formula-foreign-marker/g)).toHaveLength(2)
  })

  it('rolls back a nested marker plan when the containing block is rejected as recursively unsafe', async () => {
    const nestedRoot = {
      ...root,
      children: [root.children[0], {
        ...root.children[1],
        children: [{ ...root.children[1], children: [root.children[0]] }],
      }, root.children[2]],
    }
    const result = await resolveRootFormulaRender(nestedRoot, driver(), {
      resolveBlock: async ({ node, treePath, template }) => node.children.some(child => child.macro_name === 'Consumer.diagram')
        ? null
        : {
            identity: `nested:${treePath.join('.')}`,
            metrics: { widthEm: 2, heightEm: 1.5, depthEm: 0.5, totalHeightEm: 2 },
            rendererKey: template.block_template_name!, producer: 'p', generation: 1, accessibilityLabel: 'nested',
          },
    })
    expect(result.latex).toContain('cannot be used inside a formula')
    expect(result.foreignBoxes).toEqual([])
  })

  it('keeps the visible warning when no trusted block embed capability accepts the selected projection', async () => {
    const result = await resolveRootFormulaRender(root, driver(), { resolveBlock: async () => null })
    expect(result.latex).toContain('cannot be used inside a formula')
    expect(result.foreignBoxes).toEqual([])
  })
})
