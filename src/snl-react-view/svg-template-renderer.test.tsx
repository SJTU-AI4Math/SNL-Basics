// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useState, type ReactElement } from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import { MacroDataDriver } from '../snl-macro/macro-data-driver'
import type { SnlMacroRecord } from '../snl-macro/types'
import type { SnlBlockMacroTemplate } from '../snl-macro/types'
import { createSnlSyntaxTreeNode, type SnlSyntaxTree } from '../snl-syntax-tree/types'
import { defaultRenderers } from './hooks'
import { SvgTemplateAssetRegistry } from './svg-template-asset-registry'
import {
  createSvgTemplateRenderer,
  readSvgTemplateProjection,
  type SvgTemplateRendererProps,
} from './svg-template-renderer'

const source = readFileSync(resolve(process.cwd(), 'test-fixtures/parameterized-svg/commutative-square.svg'), 'utf8')
const rendererCss = readFileSync(resolve(process.cwd(), 'src/snl-react-view/style.css'), 'utf8')
const driver = new MacroDataDriver({ queries: { query_macro: async () => null } })
const children = ['A', 'B', 'C', 'D'].map((name) => createSnlSyntaxTreeNode(name))
const node = createSnlSyntaxTreeNode('consumer.diagram', { children })

function projection(overrides: Record<string, unknown> = {}): SnlBlockMacroTemplate {
  return {
    mode: 'block',
    body: '#0#1#2#3',
    block_template_name: 'consumer-svg',
    svg_template: {
      asset: {
        source: 'fixtures/commutative-square.svg',
        base_identity: 'consumer-package',
        revision: 'sha256-fixture-v1',
        request_epoch: 7,
      },
      generation: 11,
      producer_revision: 'consumer-renderer-v3',
      accessibility: { label: 'Commutative square diagram' },
      ...overrides,
    },
  }
}

function rendererProps(template = projection(), renderChild?: SvgTemplateRendererProps['renderChild']): SvgTemplateRendererProps {
  return {
    node,
    macro_data_driver: driver,
    template,
    dynamicArity: false,
    treePath: '2.4',
    childMode: () => 'text',
    childContainsBlock: () => false,
    renderChild: renderChild ?? ((child) => <span data-child={child.macro_name}>{child.macro_name}</span>),
  }
}

function makeRenderer(svgSource = source) {
  const registry = new SvgTemplateAssetRegistry({ loader: async () => svgSource, maxSettled: 4 })
  return { registry, Renderer: createSvgTemplateRenderer({ assetRegistry: registry }) }
}

afterEach(cleanup)

describe('SvgTemplateRenderer', () => {
  it('sizes SVG slots from their host container rather than the viewport', () => {
    const hostRule = rendererCss.match(/\.snl-svg-template\s*\{([^}]*)\}/)?.[1] ?? ''
    const slotRule = rendererCss.match(/\.snl-svg-template-slot-content\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(hostRule).toMatch(/container-type\s*:\s*inline-size\s*;/)
    expect(slotRule).toMatch(/max-width\s*:\s*min\(11rem,\s*20cqw\)\s*;/)
    expect(slotRule).not.toMatch(/\bvw\b/)
    expect(slotRule).not.toMatch(/min-width\s*:\s*[1-9]/)
  })

  it('loads immutable raw source, sanitizes per consumer, scopes IDs, and mounts the real transformed g markers', async () => {
    const { Renderer } = makeRenderer()
    const first = render(<Renderer {...rendererProps()} />)
    const second = render(<Renderer {...rendererProps()} treePath="5.1" />)

    await waitFor(() => expect(first.container.querySelector('svg')).not.toBeNull())
    await waitFor(() => expect(second.container.querySelector('svg')).not.toBeNull())
    const firstSvg = first.container.querySelector('svg')!
    const secondSvg = second.container.querySelector('svg')!
    expect(firstSvg).not.toBe(secondSvg)
    expect(firstSvg.getAttribute('aria-label')).toBe('Commutative square diagram')
    const markers = [...firstSvg.querySelectorAll('g[data-snl-slot]')]
    expect(markers).toHaveLength(4)
    expect(markers.map((marker) => marker.getAttribute('data-snl-slot'))).toEqual(['0', '1', '2', '3'])
    expect(markers.map((marker) => marker.getAttribute('transform'))).toEqual([
      'translate(200 85)', 'translate(570 85)', 'translate(130 340)', 'translate(520 330)',
    ])
    expect(firstSvg.id).not.toBe(secondSvg.id)
    expect(firstSvg.querySelector('path')?.getAttribute('d')).toBe('M330 80H460')
    const edges = [...firstSvg.querySelectorAll('.snl-svg-edge')]
    const arrowheads = [...firstSvg.querySelectorAll('.snl-svg-arrowhead')]
    expect(edges).toHaveLength(4)
    expect(arrowheads).toHaveLength(4)
    expect(edges.every((edge) => {
      const stroke = edge.getAttribute('stroke')
      return Boolean(stroke && stroke !== 'none' && !stroke.startsWith('url('))
    })).toBe(true)
  })

  it('maps exact validated slot indices through renderChild rather than array order', async () => {
    const reordered = source
      .replace(/  <g data-snl-slot="0"[^\n]+\n/, '')
      .replace('</svg>', '  <g data-snl-slot="0" transform="translate(130 70)" />\n</svg>')
    const seen: string[] = []
    const { Renderer } = makeRenderer(reordered)
    const view = render(<Renderer {...rendererProps(projection(), (child, index) => {
      seen.push(`${index}:${child.macro_name}`)
      return <span>{child.macro_name}</span>
    })} />)
    await waitFor(() => expect(view.container.querySelector('svg')).not.toBeNull())
    expect(view.container.querySelectorAll('.snl-foreign-box-measure > .snl-svg-template-slot-content')).toHaveLength(4)
    expect(seen).toEqual(['1:B', '2:C', '3:D', '0:A'])
  })

  it('renders missing and repeated slot occurrences as independent placements of semantic children', async () => {
    const sparseRepeated = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<g data-snl-slot="2" transform="translate(10 10)" />' +
      '<g data-snl-slot="0" transform="translate(50 50)" />' +
      '<g data-snl-slot="2" transform="translate(90 90)" />' +
      '</svg>'
    const seen: string[] = []
    const { Renderer } = makeRenderer(sparseRepeated)
    const view = render(<Renderer {...rendererProps(projection(), (child, index) => {
      seen.push(`${index}:${child.macro_name}`)
      return <span data-child={child.macro_name}>{child.macro_name}</span>
    })} />)

    await waitFor(() => expect(view.container.querySelector('svg')).not.toBeNull())
    await waitFor(() => expect(view.container.querySelectorAll('.snl-foreign-box-measure > .snl-svg-template-slot-content')).toHaveLength(3))
    expect(seen).toEqual(['2:C', '0:A', '2:C'])
    expect([...view.container.querySelectorAll('.snl-foreign-box-measure [data-child]')].map((element) => element.getAttribute('data-child')))
      .toEqual(['C', 'A', 'C'])
    expect(view.container.querySelectorAll('.snl-foreign-box-measure > .snl-svg-template-slot-content')).toHaveLength(3)
    expect(view.container.querySelector('[role="alert"]')).toBeNull()
  })

  it('preserves child component identity while language-like content updates', async () => {
    let mounts = 0
    function Stateful({ label }: { label: string }) {
      const [count, setCount] = useState(0)
      useState(() => { mounts += 1; return null })
      return <button onClick={() => setCount((value) => value + 1)}>{label}:{count}</button>
    }
    const { Renderer } = makeRenderer()
    const renderChild = (child: SnlSyntaxTree): ReactElement => <Stateful label={`en-${child.macro_name}`} />
    const view = render(<Renderer {...rendererProps(projection(), renderChild)} />)
    await waitFor(() => expect(view.container.querySelector('svg')).not.toBeNull())
    const mountedSvg = view.container.querySelector('svg')
    const buttons = await waitFor(() => {
      const values = view.container.querySelectorAll('button')
      expect(values.length).toBeGreaterThan(0)
      return values
    })
    fireEvent.click(buttons[0])
    expect(buttons[0].textContent).toBe('en-A:1')
    const initialMounts = mounts
    const initialButtons = [...view.container.querySelectorAll('button')]
    const translatedProjection = projection({ accessibility: { label: '交换方块图' } })
    view.rerender(<Renderer {...rendererProps(translatedProjection, (child) => <Stateful label={`zh-${child.macro_name}`} />)} />)
    await waitFor(() => expect([...view.container.querySelectorAll('button')].some((button) => button.textContent === 'zh-A:1')).toBe(true))
    expect(mounts).toBe(initialMounts)
    expect([...view.container.querySelectorAll('button')]).toEqual(initialButtons)
    expect(view.container.querySelector('svg')).toBe(mountedSvg)
    expect(mountedSvg?.getAttribute('aria-label')).toBe('交换方块图')
  })

  it('treats the producer revision as part of each ForeignBox identity', async () => {
    let mounts = 0
    function Stateful() {
      useState(() => { mounts += 1; return null })
      return <span>stateful</span>
    }
    const { Renderer } = makeRenderer()
    const view = render(<Renderer {...rendererProps(projection(), () => <Stateful />)} />)
    await waitFor(() => expect(view.container.querySelectorAll('.snl-foreign-box')).toHaveLength(4))
    const firstWrappers = [...view.container.querySelectorAll('.snl-foreign-box')]
    const initialMounts = mounts
    view.rerender(<Renderer {...rendererProps(projection({ producer_revision: 'consumer-renderer-v4' }), () => <Stateful />)} />)
    await waitFor(() => expect(mounts).toBeGreaterThan(initialMounts))
    expect([...view.container.querySelectorAll('.snl-foreign-box')].every((wrapper, index) => wrapper !== firstWrappers[index])).toBe(true)
    expect(view.container.querySelectorAll('.snl-foreign-box')).toHaveLength(4)
  })

  it('renders direct block children through the ordinary renderChild path', async () => {
    const renderChild = vi.fn((child: SnlSyntaxTree) => <section data-block-child={child.macro_name}>block {child.macro_name}</section>)
    const { Renderer } = makeRenderer()
    const view = render(<Renderer
      {...rendererProps(projection(), renderChild)}
      childMode={() => 'block'}
      childContainsBlock={() => true}
    />)

    await waitFor(() => expect(view.container.querySelector('svg')).not.toBeNull())
    await waitFor(() => expect(view.container.querySelectorAll('.snl-foreign-box-measure [data-block-child]')).toHaveLength(4))
    expect(renderChild).toHaveBeenCalledTimes(4)
    expect(view.container.querySelector('[role="alert"]')).toBeNull()
  })

  it('does not require a subtree block-classification capability', async () => {
    const renderChild = vi.fn((child: SnlSyntaxTree) => <section data-unclassified-child={child.macro_name}>unchecked {child.macro_name}</section>)
    const { Renderer } = makeRenderer()
    const props = rendererProps(projection(), renderChild)
    const { childContainsBlock: _omitted, ...withoutCapability } = props
    const view = render(<Renderer {...withoutCapability} />)

    await waitFor(() => expect(view.container.querySelector('svg')).not.toBeNull())
    await waitFor(() => expect(view.container.querySelectorAll('.snl-foreign-box-measure [data-unclassified-child]')).toHaveLength(4))
    expect(renderChild).toHaveBeenCalledTimes(4)
    expect(view.container.querySelector('[role="alert"]')).toBeNull()
  })

  it.each([
    ['one text level', (block: SnlSyntaxTree) => createSnlSyntaxTreeNode('textShell', { children: [block] })],
    ['two text levels', (block: SnlSyntaxTree) => createSnlSyntaxTreeNode('textShell', {
      children: [createSnlSyntaxTreeNode('textShell', { children: [block] })],
    })],
  ])('renders %s above a nested SVG block through ordinary recursion', async (_name, wrap) => {
    let outerRenderChildCalls = 0
    const { Renderer: BaseRenderer } = makeRenderer()
    const GuardedRenderer = (props: SvgTemplateRendererProps) => (
      <BaseRenderer
        {...props}
        renderChild={(child, index) => {
          outerRenderChildCalls += 1
          return props.renderChild(child, index)
        }}
      />
    )
    const macro = (name: string, template: SnlMacroRecord[string]['styles'][number]['template']): SnlMacroRecord[string] => ({
      name, description: '', source: { entries: [], urls: [] }, kind: 'const', dynamic_arity: false, tags: [],
      styles: [{ style_name: 'default', tags: [], template }],
    })
    const db: SnlMacroRecord = {
      outer: macro('outer', projection()),
      nestedSvg: macro('nestedSvg', projection()),
      textShell: macro('textShell', { mode: 'text', body: '#0' }),
      formulaLeaf: macro('formulaLeaf', { mode: 'formula_inline', body: 'x' }),
    }
    const nestedBlock = createSnlSyntaxTreeNode('nestedSvg', { children: children.map(() => createSnlSyntaxTreeNode('formulaLeaf')) })
    const unsafe = wrap(nestedBlock)
    const tree = createSnlSyntaxTreeNode('outer', {
      children: [unsafe, ...children.slice(1).map(() => createSnlSyntaxTreeNode('formulaLeaf'))],
    })
    const macroDriver = new MacroDataDriver({ queries: { query_macro: async ({ macro_name }) => db[macro_name] ?? null } })
    const view = render(<SnlSyntaxTreeView
      tree={tree}
      macro_data_driver={macroDriver}
      hooks={{ renderers: { ...defaultRenderers, 'consumer-svg': GuardedRenderer } }}
    />)

    await waitFor(() => expect(view.container.querySelectorAll('svg').length).toBeGreaterThanOrEqual(2))
    expect(outerRenderChildCalls).toBeGreaterThan(0)
    expect(view.container.querySelectorAll('.snl-foreign-box-host').length).toBeGreaterThanOrEqual(2)
    expect(view.container.querySelector('[role="alert"]')).toBeNull()
  })

  it('allows ordinary nested text and formula subtrees with no resolved block mode', async () => {
    const { Renderer } = makeRenderer()
    const macro = (name: string, template: SnlMacroRecord[string]['styles'][number]['template']): SnlMacroRecord[string] => ({
      name, description: '', source: { entries: [], urls: [] }, kind: 'const', dynamic_arity: false, tags: [],
      styles: [{ style_name: 'default', tags: [], template }],
    })
    const db: SnlMacroRecord = {
      outer: macro('outer', projection()),
      textShell: macro('textShell', { mode: 'text', body: 'safe #0' }),
      formulaLeaf: macro('formulaLeaf', { mode: 'formula_inline', body: 'x^2' }),
    }
    const safeText = createSnlSyntaxTreeNode('textShell', {
      children: [createSnlSyntaxTreeNode('textShell', { children: [createSnlSyntaxTreeNode('formulaLeaf')] })],
    })
    const tree = createSnlSyntaxTreeNode('outer', {
      children: [safeText, ...children.slice(1).map(() => createSnlSyntaxTreeNode('formulaLeaf'))],
    })
    const macroDriver = new MacroDataDriver({ queries: { query_macro: async ({ macro_name }) => db[macro_name] ?? null } })
    const view = render(<SnlSyntaxTreeView
      tree={tree}
      macro_data_driver={macroDriver}
      hooks={{ renderers: { ...defaultRenderers, 'consumer-svg': Renderer } }}
    />)

    await waitFor(() => expect(view.container.querySelector('svg')).not.toBeNull())
    expect(view.container.querySelector('[data-name="textShell"][data-tree-path="0.0"]')).not.toBeNull()
    expect(view.container.querySelector('[data-name="formulaLeaf"][data-tree-path="0.0.0"]')).not.toBeNull()
    expect(view.container.querySelector('[role="alert"]')).toBeNull()
  })

  it.each([
    ['dynamic arity', { dynamicArity: true }, /fixed arity/i],
    ['out-of-range slot', { node: createSnlSyntaxTreeNode('consumer.diagram', { children: children.slice(0, 3) }) }, /slot 3.*no corresponding child/i],
  ])('shows a visible deterministic fallback for %s', async (_name, changed, message) => {
    const { Renderer } = makeRenderer()
    const view = render(<Renderer {...rendererProps()} {...changed} />)
    await waitFor(() => expect(view.getByRole('alert').textContent).toMatch(message))
    expect(view.container.querySelector('svg')).toBeNull()
  })

  it.each([
    ['malformed SVG', '<svg>'],
    ['unsafe SVG', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script /></svg>'],
  ])('falls back visibly for %s', async (_name, badSource) => {
    const { Renderer } = makeRenderer(badSource)
    const view = render(<Renderer {...rendererProps()} />)
    await waitFor(() => expect(view.getByRole('alert').textContent).toMatch(/SVG template unavailable/i))
  })

  it('rejects invalid asset and foreign identities before calling the loader', async () => {
    const loader = vi.fn(async () => source)
    const Renderer = createSvgTemplateRenderer({ assetRegistry: new SvgTemplateAssetRegistry({ loader, maxSettled: 1 }) })
    const invalid = projection({ producer_revision: '' })
    const view = render(<Renderer {...rendererProps(invalid)} />)
    await waitFor(() => expect(view.getByRole('alert').textContent).toMatch(/producer revision/i))
    expect(loader).not.toHaveBeenCalled()
  })

  it('retires stale authority when source revision and epoch change', async () => {
    const loads: Array<{ revision: string; signal: AbortSignal }> = []
    const registry = new SvgTemplateAssetRegistry({
      loader: async (identity, signal) => { loads.push({ revision: identity.revision, signal }); return source },
      maxSettled: 0,
    })
    const Renderer = createSvgTemplateRenderer({ assetRegistry: registry })
    const view = render(<Renderer {...rendererProps()} />)
    await waitFor(() => expect(view.container.querySelector('svg')).not.toBeNull())
    const changed = projection({ asset: {
      source: 'fixtures/commutative-square.svg', base_identity: 'consumer-package', revision: 'sha256-fixture-v2', request_epoch: 8,
    } })
    view.rerender(<Renderer {...rendererProps(changed)} />)
    await waitFor(() => expect(loads.map((load) => load.revision)).toEqual(['sha256-fixture-v1', 'sha256-fixture-v2']))
    expect(registry.snapshot().authorities).toBe(1)
  })

  it('requires the complete consumer-owned projection and never derives identity from macro names', () => {
    expect(() => readSvgTemplateProjection({ mode: 'block', body: '', block_template_name: 'consumer-svg' }))
      .toThrow(/svg_template projection/i)
    const value = readSvgTemplateProjection(projection())
    expect(value.asset.source).toBe('fixtures/commutative-square.svg')
    expect(value.producerRevision).toBe('consumer-renderer-v3')
  })

  it('keeps default renderers unchanged and renderer maps shallow', () => {
    expect(Object.keys(defaultRenderers).sort()).toEqual(['centered', 'enumerate', 'list', 'table'])
    const custom = { 'consumer-svg': makeRenderer().Renderer }
    expect((custom as Partial<typeof defaultRenderers>).list).toBeUndefined()
    const merged: typeof defaultRenderers = { ...defaultRenderers, ...custom }
    expect(merged.list).toBe(defaultRenderers.list)
  })

  it('integrates through the complete selected projection and preserves nested text/formula metadata', async () => {
    const { Renderer } = makeRenderer()
    const db: SnlMacroRecord = {
      diagram: {
        name: 'diagram', description: '', source: { entries: ['diagram-entry'], urls: [] }, kind: 'const',
        dynamic_arity: false, tags: [], styles: [{ style_name: 'default', tags: [], template: projection() }],
      },
      label: {
        name: 'label', description: '', source: { entries: ['label-entry'], urls: [] }, kind: 'const',
        dynamic_arity: false, tags: [], styles: [{ style_name: 'default', tags: [], template: { mode: 'text', body: 'long consumer label' } }],
      },
      formula: {
        name: 'formula', description: '', source: { entries: ['formula-entry'], urls: [] }, kind: 'const',
        dynamic_arity: false, tags: [], styles: [{ style_name: 'default', tags: [], template: { mode: 'formula_inline', body: 'x^2' } }],
      },
    }
    const tree = createSnlSyntaxTreeNode('diagram', {
      children: [
        createSnlSyntaxTreeNode('label', { mdata: { src: 'source-entry' } }),
        createSnlSyntaxTreeNode('formula'),
        createSnlSyntaxTreeNode('label'),
        createSnlSyntaxTreeNode('formula'),
      ],
    })
    const macroDriver = new MacroDataDriver({ queries: { query_macro: async ({ macro_name }) => db[macro_name] ?? null } })
    const view = render(<SnlSyntaxTreeView
      tree={tree}
      macro_data_driver={macroDriver}
      hooks={{ renderers: { ...defaultRenderers, 'consumer-svg': Renderer } }}
    />)
    await waitFor(() => expect(view.container.querySelector('svg[aria-label="Commutative square diagram"]')).not.toBeNull())
    await waitFor(() => expect(view.container.querySelector('[data-name="label"][data-tree-path="0"]')).not.toBeNull())
    expect(view.container.querySelector('[data-name="label"][data-tree-path="0"]')?.getAttribute('data-name')).toBe('label')
    const formulaNode = view.container.querySelector('[data-name="formula"][data-tree-path="1"]')
    expect(formulaNode).not.toBeNull()
    expect(formulaNode?.closest('.katex')).not.toBeNull()
  })
})
