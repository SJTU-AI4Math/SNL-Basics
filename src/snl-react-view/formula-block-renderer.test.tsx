// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createSnlSyntaxTreeNode } from '../snl-syntax-tree/types'
import type { SnlBlockRenderer } from './hooks'
import {
  createFormulaBlockRenderer,
  formulaForeignCapability,
  type FormulaForeignCandidate,
} from './formula-foreign-box'

const node = createSnlSyntaxTreeNode('consumer.badge')
const selectedTemplate = {
  mode: 'block' as const,
  body: '#*',
  separator: ', ',
  block_template_name: 'consumer-badge',
  consumer_projection: { variant: 'success', opaque: { revision: 9 } },
}

const BaseRenderer: SnlBlockRenderer = () => <span>badge</span>

function trustedPreparation(overrides: Record<string, unknown> = {}) {
  return {
    seed: { widthEm: 1.5, totalHeightEm: 1, baselineRatio: 0.72 },
    producer: 'consumer-badge@2',
    generation: 4,
    accessibilityText: 'Build passed',
    layout: { width: 'intrinsic' as const, overflow: 'visible' as const },
    ...overrides,
  }
}

describe('explicit generic formula block renderer capability', () => {
  it('passes the complete selected projection to an explicitly wrapped renderer and binds identity/key centrally', async () => {
    const prepare = vi.fn(async (_candidate: FormulaForeignCandidate) => trustedPreparation())
    const renderer = createFormulaBlockRenderer(BaseRenderer, { prepare })
    expect(formulaForeignCapability(BaseRenderer)).toBeNull()

    const capability = formulaForeignCapability(renderer)
    const result = await capability!.prepare({
      node,
      template: selectedTemplate,
      treePath: [2, 1],
      dynamicArity: true,
    })

    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({
      node,
      template: selectedTemplate,
      treePath: [2, 1],
      dynamicArity: true,
    }))
    expect(prepare.mock.calls[0][0].template).toBe(selectedTemplate)
    expect(result).toMatchObject({
      rendererKey: 'consumer-badge',
      producer: 'consumer-badge@2',
      generation: 4,
      accessibilityLabel: 'Build passed',
      dynamicMetrics: true,
      layout: { width: 'intrinsic', overflow: 'visible' },
      metrics: { widthEm: 1.5, totalHeightEm: 1, heightEm: 0.72, depthEm: 0.28 },
    })
    expect(result.identity).toContain('consumer-badge')
    expect(result.identity).toContain('2.1')
  })

  it.each([
    ['missing width', { layout: { overflow: 'visible' } }],
    ['fill width', { layout: { width: 'fill', overflow: 'visible' } }],
    ['percentage width', { layout: { width: { percent: 100 }, overflow: 'visible' } }],
    ['self-dependent width', { layout: { width: 'auto', overflow: 'visible' } }],
    ['zero fixed width', { layout: { width: { px: 0 }, overflow: 'visible' } }],
    ['missing overflow', { layout: { width: 'intrinsic' } }],
    ['invalid overflow', { layout: { width: 'intrinsic', overflow: 'scroll' } }],
    ['zero baseline', { seed: { widthEm: 1, totalHeightEm: 1, baselineRatio: 0 } }],
    ['unit baseline', { seed: { widthEm: 1, totalHeightEm: 1, baselineRatio: 1 } }],
  ])('rejects malformed generic preparation: %s', async (_label, override) => {
    const renderer = createFormulaBlockRenderer(BaseRenderer, {
      prepare: async () => trustedPreparation(override),
    })
    await expect(formulaForeignCapability(renderer)!.prepare({
      node, template: selectedTemplate, treePath: [], dynamicArity: false,
    })).rejects.toThrow()
  })

  it('accepts an explicit fixed pixel width and fallback-block overflow policy', async () => {
    const renderer = createFormulaBlockRenderer(BaseRenderer, {
      prepare: async () => trustedPreparation({
        layout: { width: { px: 240 }, overflow: 'fallback-block' },
      }),
    })
    await expect(formulaForeignCapability(renderer)!.prepare({
      node, template: selectedTemplate, treePath: [3], dynamicArity: true,
    })).resolves.toMatchObject({
      rendererKey: 'consumer-badge',
      layout: { width: { px: 240 }, overflow: 'fallback-block' },
    })
  })
})
