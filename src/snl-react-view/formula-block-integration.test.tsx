// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import type { SnlMacro, SnlMacroRecord, SnlBlockMacroTemplate } from '../snl-macro/types'
import { createSnlSyntaxTreeNode, type SnlSyntaxTree } from '../snl-syntax-tree/types'
import { TableRenderer } from './block-renderers'
import { createFormulaBlockRenderer } from './formula-foreign-box'
import type { SnlBlockRenderer } from './hooks'
import { testDriver } from './test-helpers'

function macro(name: string, template: SnlMacro['styles'][number]['template'], dynamicArity = false): SnlMacro {
  return {
    name, description: '', source: { entries: [], urls: [] }, dynamic_arity: dynamicArity,
    tags: [], styles: [{ style_name: 'default', tags: [], template }],
  }
}

const rootMacro = macro('formula.root', { mode: 'formula_inline', body: 'a+#0+b' })
const leafMacro = macro('formula.leaf', { mode: 'formula_inline', body: 'x' })
const textMacro = macro('text.leaf', { mode: 'text', body: 'plain' })

function blockTemplate(key: string, extra: Record<string, unknown> = {}): SnlBlockMacroTemplate {
  return { mode: 'block', body: '#*', separator: ', ', block_template_name: key, ...extra }
}

function generic(Renderer: SnlBlockRenderer, prepare = vi.fn(async ({ template }: { template: SnlBlockMacroTemplate }) => ({
  seed: { widthEm: 4, totalHeightEm: 2, baselineRatio: 0.7 },
  producer: `fixture:${String((template.consumer_policy as { token?: string } | undefined)?.token ?? 'default')}`,
  generation: 1,
  accessibilityText: 'trusted generic table',
  layout: { width: { px: 240 }, overflow: 'visible' as const },
}))) {
  return { renderer: createFormulaBlockRenderer(Renderer, { prepare }), prepare }
}

function formulaTree(block: SnlSyntaxTree): SnlSyntaxTree {
  return createSnlSyntaxTreeNode('formula.root', { children: [block] })
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const width = this.classList.contains('rule') ? 80 : 120
    const height = this.classList.contains('rule') ? 40 : 30
    return { x: 0, y: 0, width, height, top: 0, left: 0, right: width, bottom: height, toJSON: () => ({}) } as DOMRect
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('generic block renderers inside formulas', () => {
  it('renders an explicitly opted-in intrinsic badge between formula siblings', async () => {
    const Badge: SnlBlockRenderer = ({ node, renderChild }) => <span data-testid="formula-badge">✓ {renderChild(node.children[0])}</span>
    const prepare = vi.fn(async () => ({
      seed: { widthEm: 2, totalHeightEm: 1, baselineRatio: 0.72 },
      producer: 'fixture:badge', generation: 1, accessibilityText: 'build passed',
      layout: { width: 'intrinsic' as const, overflow: 'visible' as const },
    }))
    const renderer = createFormulaBlockRenderer(Badge, { prepare })
    const template = { ...blockTemplate('generic-badge'), body: '#0', consumer_policy: { optIn: true } }
    const db: SnlMacroRecord = {
      'formula.root': rootMacro,
      'formula.leaf': leafMacro,
      'consumer.badge': macro('consumer.badge', template),
    }
    const tree = formulaTree(createSnlSyntaxTreeNode('consumer.badge', { children: [createSnlSyntaxTreeNode('formula.leaf')] }))
    const view = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} hooks={{ renderers: { 'generic-badge': renderer } }} />)

    const badge = await waitFor(() => view.getByTestId('formula-badge'))
    expect(view.container.querySelector('.katex')?.textContent).toContain('a+')
    expect(view.container.querySelector('.katex')?.textContent).toContain('+b')
    expect(badge.closest<HTMLElement>('.snl-formula-foreign-surface')?.style.width).toBe('max-content')
    expect(badge.querySelector('[data-tree-path="0.0"]')).not.toBeNull()
    expect(view.container.querySelector('.snlFormulaForeignFallbackText')?.textContent?.replaceAll(' ', ' ')).toBe('build passed')
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ template, treePath: [0], dynamicArity: false }))
  })

  it('renders a fixed-width dynamic table and preserves canonical row/cell paths and formula/text descendants', async () => {
    const tableTemplate = blockTemplate('generic-table', { consumer_policy: { token: 'complete-selected-projection' } })
    const tableMacro = macro('consumer.table', tableTemplate, true)
    const row = createSnlSyntaxTreeNode('row', {
      children: [createSnlSyntaxTreeNode('formula.leaf'), createSnlSyntaxTreeNode('text.leaf')],
    })
    const tree = formulaTree(createSnlSyntaxTreeNode('consumer.table', { children: [row] }))
    const { renderer, prepare } = generic(TableRenderer)
    const db: SnlMacroRecord = {
      'formula.root': rootMacro, 'formula.leaf': leafMacro, 'text.leaf': textMacro,
      'consumer.table': tableMacro,
    }
    const view = render(<SnlSyntaxTreeView
      tree={tree}
      macro_data_driver={testDriver(db)}
      hooks={{ renderers: { 'generic-table': renderer } }}
    />)

    const table = await waitFor(() => {
      const found = view.container.querySelector<HTMLTableElement>('table.snl-block-table')
      expect(found).not.toBeNull()
      return found!
    })
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({
      template: tableTemplate,
      treePath: [0],
      dynamicArity: true,
    }))
    expect(prepare.mock.calls[0][0].template).toBe(tableTemplate)
    const surface = table.closest<HTMLElement>('.snl-formula-foreign-surface')!
    expect(surface.style.width).toBe('240px')
    expect(surface.style.minWidth).toBe('240px')
    expect(surface.style.maxWidth).toBe('240px')
    expect(table.querySelector('[data-tree-path="0.0.0"]')).not.toBeNull()
    expect(table.querySelector('[data-tree-path="0.0.1"]')).not.toBeNull()
    expect(table.querySelector('.snl-math-span')).not.toBeNull()
    expect(table.querySelector('.snl-text')).not.toBeNull()
  })

  it('keeps a plain registered block renderer ineligible without the explicit wrapper', async () => {
    const Plain: SnlBlockRenderer = () => <span data-testid="plain-should-not-render">plain</span>
    const db: SnlMacroRecord = {
      'formula.root': rootMacro,
      'consumer.plain': macro('consumer.plain', { ...blockTemplate('plain'), body: '#0' }),
    }
    const view = render(<SnlSyntaxTreeView
      tree={formulaTree(createSnlSyntaxTreeNode('consumer.plain'))}
      macro_data_driver={testDriver(db)}
      hooks={{ renderers: { plain: Plain } }}
    />)
    await waitFor(() => expect(view.container.textContent).toContain('cannot be used inside a formula'))
    expect(view.queryByTestId('plain-should-not-render')).toBeNull()
    expect(view.container.querySelector('.snl-formula-foreign-surface')).toBeNull()
  })

  it('rejects every recursive block descendant before preparation and leaks no nested plan', async () => {
    const Recursive: SnlBlockRenderer = ({ node, renderChild }) => <div>{node.children.map((child, index) => <span key={index}>{renderChild(child, index)}</span>)}</div>
    const { renderer, prepare } = generic(Recursive)
    const template = blockTemplate('recursive')
    const db: SnlMacroRecord = {
      'formula.root': rootMacro,
      'outer.block': macro('outer.block', template, true),
      'inner.block': macro('inner.block', template, true),
      'formula.leaf': leafMacro,
    }
    const inner = createSnlSyntaxTreeNode('inner.block', { children: [createSnlSyntaxTreeNode('formula.leaf')] })
    const outer = createSnlSyntaxTreeNode('outer.block', { children: [inner] })
    const view = render(<SnlSyntaxTreeView
      tree={formulaTree(outer)} macro_data_driver={testDriver(db)}
      hooks={{ renderers: { recursive: renderer } }}
    />)
    await waitFor(() => expect(view.container.textContent).toContain('cannot be used inside a formula'))
    expect(prepare).not.toHaveBeenCalled()
    expect(view.container.querySelectorAll('.snl-formula-foreign-surface')).toHaveLength(0)
    expect(view.container.querySelectorAll('[data-snl-formula-foreign-marker]')).toHaveLength(0)
  })
})
