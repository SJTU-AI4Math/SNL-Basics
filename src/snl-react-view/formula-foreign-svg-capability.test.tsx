// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createSnlSyntaxTreeNode } from '../snl-syntax-tree/types'
import { formulaForeignCapability } from './formula-foreign-box'
import { SvgTemplateAssetRegistry } from './svg-template-asset-registry'
import { createSvgTemplateRenderer } from './svg-template-renderer'

const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"><g data-snl-slot="0"/></svg>'
const template = {
  mode: 'block' as const,
  body: '#0',
  block_template_name: 'fixture-svg',
  svg_template: {
    asset: { source: 'asset.svg', base_identity: 'base', revision: 'r1', request_epoch: 2 },
    generation: 4,
    producer_revision: 'producer-r2',
    accessibility: { label: 'trusted diagram' },
    formula_embed: { total_height_em: 2, baseline_ratio: 0.7 },
  },
}

describe('SVG fixed formula capability', () => {
  it('loads and sanitizes the source before deriving metrics and identity', async () => {
    const registry = new SvgTemplateAssetRegistry({ loader: async () => source, maxSettled: 2 })
    const renderer = createSvgTemplateRenderer({ assetRegistry: registry })
    const capability = formulaForeignCapability(renderer)
    expect(capability).not.toBeNull()
    const result = await capability!.prepare({
      node: createSnlSyntaxTreeNode('diagram', { children: [createSnlSyntaxTreeNode('x')] }),
      template,
      treePath: [2, 1],
      dynamicArity: false,
    })
    expect(result).toMatchObject({
      rendererKey: 'fixture-svg', producer: expect.stringContaining('producer-r2'),
      generation: 4, accessibilityLabel: 'trusted diagram',
      metrics: { widthEm: 3.2, heightEm: 1.4, totalHeightEm: 2 },
    })
    expect(result.metrics.depthEm).toBeCloseTo(0.6)
    expect(result.identity).toContain('2,1')
  })

  it('rejects dynamic arity and malformed/missing baseline policy before publication', async () => {
    const registry = new SvgTemplateAssetRegistry({ loader: async () => source, maxSettled: 2 })
    const capability = formulaForeignCapability(createSvgTemplateRenderer({ assetRegistry: registry }))!
    await expect(capability.prepare({ node: createSnlSyntaxTreeNode('diagram'), template, treePath: [], dynamicArity: true })).rejects.toThrow(/fixed arity/)
    await expect(capability.prepare({
      node: createSnlSyntaxTreeNode('diagram'),
      template: { ...template, svg_template: { ...template.svg_template, formula_embed: { total_height_em: 2, baseline_ratio: 1 } } },
      treePath: [], dynamicArity: false,
    })).rejects.toThrow(/between zero and one/)
  })
})
