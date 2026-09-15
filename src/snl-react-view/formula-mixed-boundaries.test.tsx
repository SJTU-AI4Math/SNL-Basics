// @vitest-environment jsdom
import { StrictMode, useState } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import { ReaderRuntime } from '../runtime'
import type { SnlMacro, SnlMacroRecord } from '../snl-macro/types'
import { parseSnlSyntaxTree } from '../snl-syntax-tree/parser'
import { createSnlSyntaxTreeNode } from '../snl-syntax-tree/types'
import { createFormulaBlockRenderer } from './formula-foreign-box'
import { SnlInteractionDriver } from './interaction-driver'
import type { SnlBlockRenderer } from './hooks'
import { SvgTemplateAssetRegistry } from './svg-template-asset-registry'
import { createSvgTemplateRenderer } from './svg-template-renderer'
import { testDriver } from './test-helpers'

const macro = (name: string, template: SnlMacro['styles'][number]['template']): SnlMacro => ({
  name, description: '', source: { entries: [], urls: [] }, dynamic_arity: false,
  tags: [], styles: [{ style_name: 'default', tags: [], template }],
})
const Parent: SnlBlockRenderer = ({ node, renderChild }) => <div>{node.children.map((child, index) => <span key={index}>{renderChild(child, index)}</span>)}</div>
const preparation = (producer = 'stable') => ({
  seed: { widthEm: 2, totalHeightEm: 1, baselineRatio: 0.7 }, producer, generation: 1,
  accessibilityText: 'stable accessible label', layout: { width: 'intrinsic' as const, overflow: 'visible' as const },
})
function fixture(mode: 'text' | 'block') {
  const db: SnlMacroRecord = {
    outer: macro('outer', mode === 'text' ? { mode: 'text', body: 'before #0 #1 after' } : { mode: 'block', body: '#0 #1', block_template_name: 'parent' }),
    formula: macro('formula', { mode: 'formula_inline', body: 'a+#0+b' }),
    badge: macro('badge', { mode: 'block', body: '#0', block_template_name: 'foreign' }),
    label: macro('label', { type: 'i18n', default_language: 'en', values: {
      en: { mode: 'text', body: 'English' }, zh: { mode: 'text', body: '中文' },
    } }),
  }
  return { db, tree: parseSnlSyntaxTree('outer(@x,formula(badge(x)))') }
}
function deferred() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const width = this.classList.contains('rule') ? 80 : 120
    return { x: 0, y: 0, width, height: 40, top: 0, left: 0, right: width, bottom: 40, toJSON: () => ({}) } as DOMRect
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe.each(['text', 'block'] as const)('mixed %s → formula → foreign', mode => {
  it('keeps an outside binder, canonical ownership, and exactly one activation owner', async () => {
    const { db, tree } = fixture(mode)
    const before = JSON.stringify(tree)
    const Child: SnlBlockRenderer = ({ node, renderChild }) => <span data-testid="child">{renderChild(node.children[0])}<button data-testid="owned">owned</button></span>
    const renderer = createFormulaBlockRenderer(Child, { prepare: async () => preparation() })
    const clicked = vi.fn(); const hover = vi.fn(); const diagnostics = vi.fn()
    const view = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} onDiagnostics={diagnostics}
      interaction_driver={new SnlInteractionDriver({ on_click: clicked })}
      hooks={{ renderers: { parent: Parent, foreign: renderer }, onHover: hover, renderTooltip: () => <span data-testid="tooltip" /> }} />)
    const target = await waitFor(() => {
      const node = view.container.querySelector<HTMLElement>('[data-kind="bvar"][data-tree-path="1.0.0"]')
      expect(node).not.toBeNull(); return node!
    })
    expect(target.dataset.sourcePath).toBe('0')
    const binder = view.container.querySelector('[data-kind="binder"][data-tree-path="0"]')!
    expect(binder).not.toBeNull()
    const original = document.elementsFromPoint
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [target] })
    try {
      fireEvent.mouseMove(target, { clientX: 1, clientY: 1 })
      expect(hover).toHaveBeenCalledTimes(1)
      expect(hover).toHaveBeenLastCalledWith(expect.objectContaining({ variableRole: 'bvar' }))
      fireEvent.click(target)
      expect(clicked).toHaveBeenCalledTimes(1)
      expect(clicked).toHaveBeenLastCalledWith(expect.objectContaining({ tree_path: [1, 0, 0], node: expect.objectContaining({ macro_name: 'x', kind: 'bvar' }) }))
      fireEvent.click(view.getByTestId('owned'))
      expect(clicked).toHaveBeenCalledTimes(1)
      expect(view.getAllByTestId('tooltip')).toHaveLength(1)
    } finally { Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: original }) }
    expect(JSON.stringify(tree)).toBe(before)
    expect(diagnostics.mock.calls.at(-1)?.[0]).toEqual([])
  })

  it('stages the captured old renderer while a replacement prepares and ignores late aborted work', async () => {
    const { db, tree } = fixture(mode); const driver = testDriver(db)
    const pending = deferred(); let oldSignal: AbortSignal | undefined
    const A: SnlBlockRenderer = () => <span data-testid="a">A</span>
    const B: SnlBlockRenderer = () => <span data-testid="b">B</span>
    const C: SnlBlockRenderer = () => <span data-testid="c">C</span>
    const a = createFormulaBlockRenderer(A, { prepare: async () => preparation('a') })
    const b = createFormulaBlockRenderer(B, { prepare: async ({ signal }) => { oldSignal = signal; await pending.promise; return preparation('b') } })
    const c = createFormulaBlockRenderer(C, { prepare: async () => preparation('c') })
    const ui = (foreign: SnlBlockRenderer) => <StrictMode><SnlSyntaxTreeView tree={tree} macro_data_driver={driver} hooks={{ renderers: { parent: Parent, foreign } }} /></StrictMode>
    const view = render(ui(a)); const old = await view.findByTestId('a')
    view.rerender(ui(b)); await waitFor(() => expect(oldSignal).toBeDefined())
    expect(view.queryByTestId('b')).toBeNull(); expect(view.getByTestId('a')).toBe(old)
    const shell = old.closest('.snl-foreign-box')!
    expect(shell.getAttribute('aria-hidden')).toBe('true'); expect(shell.hasAttribute('inert')).toBe(true)
    view.rerender(ui(c)); await view.findByTestId('c')
    expect(oldSignal?.aborted).toBe(true)
    await act(async () => { pending.release(); await pending.promise })
    expect(view.queryByTestId('b')).toBeNull(); expect(view.getByTestId('c')).not.toBeNull()
  })

  it('adopts equal-markup localized children without losing state or DOM while preparation is deferred', async () => {
    const { db } = fixture(mode); const tree = parseSnlSyntaxTree('outer(@x,formula(badge(label)))'); const driver = testDriver(db)
    let language = 'en'; const runtime = new ReaderRuntime({ queries: { query_environment: () => ({ language }) } })
    const wait = deferred(); const called = vi.fn()
    const Stateful: SnlBlockRenderer = ({ node, renderChild }) => {
      const [value, setValue] = useState(0)
      return <span><button data-testid="state" onClick={() => setValue(value + 1)}>{value}</button>{renderChild(node.children[0])}</span>
    }
    const renderer = createFormulaBlockRenderer(Stateful, { prepare: async () => { called(language); if (language === 'zh') await wait.promise; return preparation() } })
    const hooks = { renderers: { parent: Parent, foreign: renderer } }
    const ui = () => <SnlSyntaxTreeView tree={tree} macro_data_driver={driver} reader_runtime={runtime} hooks={hooks} />
    const view = render(ui()); const button = await view.findByTestId('state')
    const marker = view.container.querySelector('[data-snl-formula-foreign-marker]')
    fireEvent.click(button); expect(button.textContent).toBe('1')
    expect(view.container.textContent).toContain('English')
    language = 'zh'; view.rerender(ui()); await waitFor(() => expect(called).toHaveBeenCalledWith('zh'))
    expect(view.getByTestId('state')).toBe(button); expect(view.container.textContent).not.toContain('中文')
    await act(async () => { wait.release(); await wait.promise })
    await waitFor(() => expect(view.container.textContent).toContain('中文'))
    expect(view.getByTestId('state')).toBe(button); expect(button.textContent).toBe('1')
    expect(view.container.querySelector('[data-snl-formula-foreign-marker]')).toBe(marker)
  })

  it('uses the real SVG asset/slot renderer and releases never-settling preparation on unmount', async () => {
    const { db, tree } = fixture(mode)
    const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"><path d="M0 0L160 100" stroke="black"/><g data-snl-slot="0"/></svg>'
    db.badge.styles[0].template = { mode: 'block', body: '#0', block_template_name: 'foreign', svg_template: {
      asset: { source: 'asset.svg', base_identity: 'base', revision: 'r1', request_epoch: 1 },
      generation: 1, producer_revision: 'r1', accessibility: { label: 'nested SVG' }, block_width_px: 160,
      formula_embed: { total_height_em: 2, baseline_ratio: 0.7 },
    } }
    const registry = new SvgTemplateAssetRegistry({ loader: async () => source, maxSettled: 2 })
    const renderer = createSvgTemplateRenderer({ assetRegistry: registry })
    const driver = testDriver(db)
    const view = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={driver} hooks={{ renderers: { parent: Parent, foreign: renderer } }} />)
    await waitFor(() => expect(view.container.querySelector('.snl-formula-foreign-surface svg path')).not.toBeNull())
    await waitFor(() => expect(view.container.querySelector('[data-kind="bvar"][data-tree-path="1.0.0"][data-source-path="0"]')).not.toBeNull())
    view.unmount(); expect(registry.snapshot()).toMatchObject({ pending: 0, consumers: 0 })
    let signal: AbortSignal | undefined
    const stalled = new SvgTemplateAssetRegistry({ loader: async (_identity, captured) => { signal = captured; return new Promise<string>(() => {}) }, maxSettled: 2 })
    const stalledRenderer = createSvgTemplateRenderer({ assetRegistry: stalled })
    const next = render(<StrictMode><SnlSyntaxTreeView tree={tree} macro_data_driver={driver} hooks={{ renderers: { parent: Parent, foreign: stalledRenderer } }} /></StrictMode>)
    await waitFor(() => expect(stalled.snapshot().consumers).toBe(1))
    next.unmount(); expect(signal?.aborted).toBe(true)
    expect(stalled.snapshot()).toMatchObject({ pending: 0, consumers: 0, authorities: 0 })
  })

  it('rejects unowned synthetic children and invalid foreign capabilities', async () => {
    const { db, tree } = fixture(mode); const driver = testDriver(db)
    const BadChild: SnlBlockRenderer = ({ renderChild }) => <span>{renderChild(createSnlSyntaxTreeNode('forged'))}</span>
    const renderer = createFormulaBlockRenderer(BadChild, { prepare: async () => preparation() })
    const view = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={driver} hooks={{ renderers: { parent: Parent, foreign: renderer } }} />)
    await waitFor(() => expect(view.container.textContent).toContain('unowned synthetic child'))
    const plain: SnlBlockRenderer = () => <span data-testid="ineligible">bad</span>
    view.rerender(<SnlSyntaxTreeView tree={tree} macro_data_driver={driver} hooks={{ renderers: { parent: Parent, foreign: plain } }} />)
    await waitFor(() => expect(view.container.textContent).toContain('cannot be used inside a formula'))
    expect(view.queryByTestId('ineligible')).toBeNull()
  })
})

it('hydrates the mixed view from its truthful loading fallback without mismatches', async () => {
  const { db, tree } = fixture('text')
  const Foreign: SnlBlockRenderer = () => <span data-testid="hydrated">ready</span>
  const ui = <SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} hooks={{ renderers: { foreign: createFormulaBlockRenderer(Foreign, { prepare: async () => preparation() }) } }} />
  const container = document.createElement('div'); document.body.append(container)
  container.innerHTML = renderToString(ui)
  expect(container.textContent).toContain('Loading macro data')
  const recoverable = vi.fn(); let root!: ReturnType<typeof hydrateRoot>
  try {
    await act(async () => { root = hydrateRoot(container, ui, { onRecoverableError: recoverable }) })
    await waitFor(() => expect(container.querySelector('[data-testid="hydrated"]')).not.toBeNull())
    expect(recoverable).not.toHaveBeenCalled()
  } finally { act(() => root?.unmount()); container.remove() }
})
