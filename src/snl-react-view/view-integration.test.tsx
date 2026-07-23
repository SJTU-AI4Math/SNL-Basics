// @vitest-environment jsdom
/**
 * Integration tests: data-tree-path DOM attribute, delegated interaction events,
 * and Ctrl/Meta click semantics on SnlSyntaxTreeView.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor, fireEvent } from '@testing-library/react'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import { SnlInteractionDriver, resolveTreePath } from './interaction-driver'
import type { SnlInteractionContext } from './interaction-driver'
import { createSnlSyntaxTreeNode } from '../snl-syntax-tree/types'
import { testDriver } from './test-helpers'
import type { SnlMacroRecord } from '../snl-macro/types'
import { MacroDataDriver } from '../snl-macro/macro-data-driver'

const db: SnlMacroRecord = {
  sum: {
    name: 'sum',
    description: '',
    source: { entries: [], urls: [] },
    dynamic_arity: false,
    tags: [],
    styles: [{ style_name: 'default', mode: 'formula_inline', template: '#0 + #1', tags: [] }],
  },
  x: {
    name: 'x',
    description: '',
    source: { entries: [], urls: [] },
    dynamic_arity: false,
    tags: [],
    styles: [{ style_name: 'default', mode: 'formula_inline', template: 'x', tags: [] }],
  },
}
const driver = testDriver(db)

afterEach(cleanup)

describe('data-tree-path DOM attribute', () => {
  it('KaTeX output contains data-tree-path attributes', async () => {
    const tree = createSnlSyntaxTreeNode('sum', {
      children: [createSnlSyntaxTreeNode('x'), createSnlSyntaxTreeNode('x')],
    })
    const { container } = render(
      <SnlSyntaxTreeView tree={tree} macro_data_driver={driver} />,
    )
    await waitFor(() => {
      // The root node should have data-tree-path=""
      const root = container.querySelector('[data-tree-path=""]')
      expect(root).not.toBeNull()
    })
    // Children should have data-tree-path="0" and "1"
    const child0 = container.querySelector('[data-tree-path="0"]')
    const child1 = container.querySelector('[data-tree-path="1"]')
    expect(child0).not.toBeNull()
    expect(child1).not.toBeNull()
  })

  it('duplicate-name nodes get distinct data-tree-path values', async () => {
    // Both children named 'x' but at different tree paths
    const tree = createSnlSyntaxTreeNode('sum', {
      children: [createSnlSyntaxTreeNode('x'), createSnlSyntaxTreeNode('x')],
    })
    const { container } = render(
      <SnlSyntaxTreeView tree={tree} macro_data_driver={driver} />,
    )
    await waitFor(() => {
      const paths = container.querySelectorAll('[data-tree-path]')
      expect(paths.length).toBeGreaterThanOrEqual(3) // root + 2 children
    })
    const child0 = container.querySelector('[data-tree-path="0"]')
    const child1 = container.querySelector('[data-tree-path="1"]')
    expect(child0).not.toBeNull()
    expect(child1).not.toBeNull()
    // Both have data-name="x" but different paths
    expect(child0!.getAttribute('data-name')).toBe('x')
    expect(child1!.getAttribute('data-name')).toBe('x')
  })
})

describe('SnlInteractionDriver integration', () => {
  it('uses a pointer cursor only while Ctrl is held over a highlighted subtree', async () => {
    const tree = createSnlSyntaxTreeNode('sum', {
      children: [createSnlSyntaxTreeNode('x'), createSnlSyntaxTreeNode('x')],
    })
    const { container } = render(
      <SnlSyntaxTreeView tree={tree} macro_data_driver={driver} />,
    )
    const target = await waitFor(() => {
      const found = container.querySelector<HTMLElement>('[data-tree-path="0"]')
      expect(found).not.toBeNull()
      return found!
    })
    const interactionSurface = container.querySelector<HTMLElement>('.katex-html')!
    const original = document.elementsFromPoint
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => [target],
    })
    try {
      fireEvent.mouseMove(target, { clientX: 20, clientY: 30 })
      expect(target.classList.contains('snl-single-hover')).toBe(true)
      expect(interactionSurface.style.cursor).not.toBe('pointer')

      fireEvent.keyDown(window, { key: 'Control', ctrlKey: true })
      expect(interactionSurface.style.cursor).toBe('pointer')

      fireEvent.keyUp(window, { key: 'Control' })
      expect(interactionSurface.style.cursor).not.toBe('pointer')

      fireEvent.mouseLeave(interactionSurface)
      fireEvent.keyDown(window, { key: 'Control', ctrlKey: true })
      expect(interactionSurface.style.cursor).not.toBe('pointer')
    } finally {
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: original,
      })
    }
  })

  it('hover dispatch receives the actual node and tree path', async () => {
    const hovers: SnlInteractionContext[] = []
    const tree = createSnlSyntaxTreeNode('sum', {
      children: [createSnlSyntaxTreeNode('x'), createSnlSyntaxTreeNode('x')],
    })
    const interaction = new SnlInteractionDriver({ on_hover: (ctx) => { hovers.push(ctx) } })
    const { container } = render(
      <SnlSyntaxTreeView tree={tree} macro_data_driver={driver} interaction_driver={interaction} />,
    )
    const target = await waitFor(() => {
      const found = container.querySelector<HTMLElement>('[data-tree-path="1"]')
      expect(found).not.toBeNull()
      return found!
    })
    const original = document.elementsFromPoint
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => [target],
    })
    try {
      fireEvent.mouseMove(target, { clientX: 20, clientY: 30, shiftKey: true })
      await waitFor(() => expect(hovers).toHaveLength(1))
      expect(hovers[0].node).toBe(tree.children[1])
      expect(hovers[0].tree_path).toEqual([1])
      expect(hovers[0].client_x).toBe(20)
      expect(hovers[0].shift_key).toBe(true)
    } finally {
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: original,
      })
    }
  })

  it('Ctrl+click dispatches on_ctrl_click (NOT on_click)', async () => {
    const ctrlClicks: SnlInteractionContext[] = []
    const clicks: SnlInteractionContext[] = []

    const tree = createSnlSyntaxTreeNode('sum', {
      children: [createSnlSyntaxTreeNode('x'), createSnlSyntaxTreeNode('x')],
    })
    const interaction = new SnlInteractionDriver({
      on_click: (ctx) => { clicks.push(ctx) },
      on_ctrl_click: (ctx) => { ctrlClicks.push(ctx) },
    })
    const { container } = render(
      <SnlSyntaxTreeView
        tree={tree}
        macro_data_driver={driver}
        interaction_driver={interaction}
      />,
    )
    await waitFor(() => {
      expect(container.querySelector('[data-tree-path]')).not.toBeNull()
    })
    const target = container.querySelector('[data-tree-path="0"]')
    if (target) {
      fireEvent.click(target, { ctrlKey: true })
      // Allow async dispatch
      await new Promise((r) => setTimeout(r, 50))
      expect(ctrlClicks.length).toBe(1)
      expect(clicks.length).toBe(0)
      expect(ctrlClicks[0].ctrl_key).toBe(true)
    }
  })

  it('Meta+click dispatches regular on_click (NOT on_ctrl_click)', async () => {
    const ctrlClicks: SnlInteractionContext[] = []
    const clicks: SnlInteractionContext[] = []

    const tree = createSnlSyntaxTreeNode('sum', {
      children: [createSnlSyntaxTreeNode('x'), createSnlSyntaxTreeNode('x')],
    })
    const interaction = new SnlInteractionDriver({
      on_click: (ctx) => { clicks.push(ctx) },
      on_ctrl_click: (ctx) => { ctrlClicks.push(ctx) },
    })
    const { container } = render(
      <SnlSyntaxTreeView
        tree={tree}
        macro_data_driver={driver}
        interaction_driver={interaction}
      />,
    )
    await waitFor(() => {
      expect(container.querySelector('[data-tree-path]')).not.toBeNull()
    })
    const target = container.querySelector('[data-tree-path="0"]')
    if (target) {
      // Meta key only — macOS Cmd. Should NOT be treated as Ctrl.
      fireEvent.click(target, { metaKey: true, ctrlKey: false })
      await new Promise((r) => setTimeout(r, 50))
      expect(ctrlClicks.length).toBe(0)
      expect(clicks.length).toBe(1)
      expect(clicks[0].meta_key).toBe(true)
      expect(clicks[0].ctrl_key).toBe(false)
    }
  })

  it('resolves correct node for duplicate-name paths', async () => {
    const tree = createSnlSyntaxTreeNode('sum', {
      children: [createSnlSyntaxTreeNode('x'), createSnlSyntaxTreeNode('x')],
    })

    // Verify resolveTreePath distinguishes them
    const node0 = resolveTreePath(tree, [0])
    const node1 = resolveTreePath(tree, [1])
    expect(node0).toBe(tree.children[0])
    expect(node1).toBe(tree.children[1])
    expect(node0).not.toBe(node1)
  })
})

describe('macro query lifecycle', () => {
  it('renders a query error instead of an unhandled rejection', async () => {
    const failing = new MacroDataDriver({
      queries: { query_macro: async () => { throw new Error('backend unavailable') } },
    })
    const { container } = render(
      <SnlSyntaxTreeView tree={createSnlSyntaxTreeNode('x')} macro_data_driver={failing} />,
    )
    await waitFor(() => expect(container.textContent).toContain('backend unavailable'))
    expect(container.querySelector('.katex-error')).not.toBeNull()
  })

  it('never renders the previous driver projection after a driver swap', async () => {
    const textDb: SnlMacroRecord = {
      label: {
        name: 'label',
        description: '',
        source: { entries: [], urls: [] },
        dynamic_arity: false,
        tags: [],
        styles: [{ style_name: 'default', mode: 'text', template: 'old backend', tags: [] }],
      },
    }
    const tree = createSnlSyntaxTreeNode('label')
    const view = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(textDb)} />)
    await waitFor(() => expect(view.container.textContent).toContain('old backend'))

    const pending = new MacroDataDriver({
      queries: { query_macro: () => new Promise(() => {}) },
    })
    view.rerender(<SnlSyntaxTreeView tree={tree} macro_data_driver={pending} />)
    expect(view.container.textContent).toContain('Loading macro data')
    expect(view.container.textContent).not.toContain('old backend')
  })

  it('aborts pending backend work when unmounted', async () => {
    let observedSignal: AbortSignal | undefined
    const pending = new MacroDataDriver({
      queries: {
        query_macro: ({ signal }) => {
          observedSignal = signal
          return new Promise(() => {})
        },
      },
    })
    const view = render(
      <SnlSyntaxTreeView tree={createSnlSyntaxTreeNode('pending')} macro_data_driver={pending} />,
    )
    await waitFor(() => expect(observedSignal).toBeDefined())
    view.unmount()
    expect(observedSignal!.aborted).toBe(true)
  })
})

describe('block_template_name validation', () => {
  it('ignores block_template_name on non-block (formula) mode styles', async () => {
    const formulaDb: SnlMacroRecord = {
      bad: {
        name: 'bad',
        description: '',
        source: { entries: [], urls: [] },
        dynamic_arity: false,
        tags: [],
        styles: [{
          style_name: 'default',
          mode: 'formula_inline',
          template: '\\texttt{bad}',
          block_template_name: 'should_be_ignored',
          tags: [],
        }],
      },
    }
    const { container } = render(
      <SnlSyntaxTreeView tree={createSnlSyntaxTreeNode('bad')} macro_data_driver={testDriver(formulaDb)} />,
    )
    await waitFor(() => {
      // Should render as KaTeX formula, NOT trigger a block renderer lookup
      const katex = container.querySelector('.katex')
      expect(katex).not.toBeNull()
    })
  })

  it('uses block_template_name only for block mode styles', async () => {
    let rendererCalled = false
    const hovers: SnlInteractionContext[] = []
    const blockDb: SnlMacroRecord = {
      list: {
        name: 'list',
        description: '',
        source: { entries: [], urls: [] },
        dynamic_arity: true,
        tags: [],
        styles: [{
          style_name: 'default',
          mode: 'block',
          template: '#*',
          block_template_name: 'test-block',
          tags: [],
        }],
      },
    }
    const tree = createSnlSyntaxTreeNode('list', { children: [createSnlSyntaxTreeNode('item')] })
    const interaction = new SnlInteractionDriver({ on_hover: (ctx) => { hovers.push(ctx) } })
    const { container } = render(
      <SnlSyntaxTreeView
        tree={tree}
        macro_data_driver={testDriver(blockDb)}
        interaction_driver={interaction}
        hooks={{
          renderers: {
            'test-block': ({ node }) => {
              rendererCalled = true
              return <div data-testid="custom-block">{node.macro_name}</div>
            },
          },
        }}
      />,
    )
    const host = await waitFor(() => {
      expect(rendererCalled).toBe(true)
      const found = container.querySelector<HTMLElement>('.snl-block-host[data-name="list"]')
      expect(found).not.toBeNull()
      return found!
    })
    const original = document.elementsFromPoint
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [host] })
    try {
      fireEvent.mouseMove(host, { clientX: 8, clientY: 9 })
      await waitFor(() => expect(hovers).toHaveLength(1))
      expect(hovers[0].node).toBe(tree)
      expect(hovers[0].tree_path).toEqual([])
    } finally {
      Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: original })
    }
  })
})
