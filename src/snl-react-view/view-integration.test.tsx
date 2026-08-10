// @vitest-environment jsdom
/**
 * Integration tests: data-tree-path DOM attribute, delegated interaction events,
 * and Ctrl/Meta click semantics on SnlSyntaxTreeView.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor, fireEvent } from '@testing-library/react'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import { SnlInteractionDriver, resolveTreePath } from './interaction-driver'
import type { SnlInteractionContext } from './interaction-driver'
import { createSnlSyntaxTreeNode } from '../snl-syntax-tree/types'
import { testDriver } from './test-helpers'
import type { SnlMacroRecord } from '../snl-macro/types'
import { MacroDataDriver } from '../snl-macro/macro-data-driver'
import { parseSnlSyntaxTree } from '../snl-syntax-tree/parser'
import { SnlActivationController } from './activation-controller'
import { SnlDeactivationController } from './deactivation-controller'

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
  it('selects light and dark Macro palettes from a live driver context reader on rerender', async () => {
    let color_scheme: 'light' | 'dark' = 'light'
    const themeDriver = new MacroDataDriver({
      queries: { query_macro: async ({ macro_name }) => db[macro_name] ?? null },
      context_reader: () => ({ color_scheme }),
    })
    const palette = { const: {
      light: { stroke: '#112233', background: '#ddeeff' },
      dark: { stroke: '#abcdef', background: '#123456' },
    } }
    const tree = createSnlSyntaxTreeNode('x')
    const view = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={themeDriver} kindPalette={palette} />)
    await waitFor(() => expect(view.container.querySelector('style')?.textContent).toContain('#112233'))
    color_scheme = 'dark'
    view.rerender(<SnlSyntaxTreeView tree={tree} macro_data_driver={themeDriver} kindPalette={palette} />)
    await waitFor(() => expect(view.container.querySelector('style')?.textContent).toContain('#abcdef'))
    expect(view.container.querySelector('style')?.textContent).not.toContain('#112233')
  })

  it('defaults unresolved nodes to fvar', async () => {
    const tree = createSnlSyntaxTreeNode('flat', {
      children: [createSnlSyntaxTreeNode('x')],
    })
    const { container } = render(
      <SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver({})} />,
    )
    await waitFor(() => expect(container.querySelector('[data-tree-path=""]')).not.toBeNull())
    const root = container.querySelector<HTMLElement>('[data-tree-path=""]')!
    expect(root.getAttribute('data-kind')).toBe('fvar')
    expect(container.querySelector('[data-tree-path="0"]')?.getAttribute('data-kind')).toBe('fvar')
    const original = document.elementsFromPoint
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [root] })
    try {
      fireEvent.mouseMove(root, { clientX: 4, clientY: 5 })
      expect(root.classList.contains('snl-single-hover')).toBe(true)
    } finally {
      Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: original })
    }
  })

  it('preserves an explicit constant Macro kind at the root', async () => {
    const constantDb: SnlMacroRecord = {
      c: {
        name: 'c', description: '', source: { entries: [], urls: [] }, kind: 'const',
        dynamic_arity: false, tags: [],
        styles: [{ style_name: 'default', mode: 'formula_inline', template: 'c', tags: [] }],
      },
    }
    const { container } = render(
      <SnlSyntaxTreeView tree={createSnlSyntaxTreeNode('c')} macro_data_driver={testDriver(constantDb)} />,
    )
    await waitFor(() => expect(container.querySelector('[data-tree-path=""]')).not.toBeNull())
    expect(container.querySelector('[data-tree-path=""]')?.getAttribute('data-kind')).toBe('const')
  })

  it('uses const for registered native text and block Macros without an explicit kind', async () => {
    const nativeDb: SnlMacroRecord = {
      prose: {
        name: 'prose', description: '', source: { entries: [], urls: [] },
        dynamic_arity: false, tags: [],
        styles: [{ style_name: 'default', mode: 'text', template: 'prose', tags: [] }],
      },
      group: {
        name: 'group', description: '', source: { entries: [], urls: [] },
        dynamic_arity: true, tags: [],
        styles: [{ style_name: 'default', mode: 'block', template: '#*', tags: [] }],
      },
    }
    const view = render(
      <SnlSyntaxTreeView tree={createSnlSyntaxTreeNode('prose')} macro_data_driver={testDriver(nativeDb)} />,
    )
    await waitFor(() => expect(view.container.querySelector('[data-tree-path=""]')).not.toBeNull())
    expect(view.container.querySelector('[data-tree-path=""]')?.getAttribute('data-kind')).toBe('const')
    view.rerender(
      <SnlSyntaxTreeView tree={createSnlSyntaxTreeNode('group')} macro_data_driver={testDriver(nativeDb)} />,
    )
    await waitFor(() => expect(view.container.querySelector('.snl-block[data-tree-path=""]')).not.toBeNull())
    expect(view.container.querySelector('.snl-block[data-tree-path=""]')?.getAttribute('data-kind')).toBe('const')
  })

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
  it('exposes generation-safe leases that cannot clear a newer activation', async () => {
    const contexts: SnlInteractionContext[] = []
    const tree = createSnlSyntaxTreeNode('sum', { children: [createSnlSyntaxTreeNode('x'), createSnlSyntaxTreeNode('x')] })
    const view = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={driver} interaction_driver={new SnlInteractionDriver({ on_click: (context) => { contexts.push(context) } })} />)
    const first = await waitFor(() => {
      const found = view.container.querySelector<HTMLElement>('[data-tree-path="0"]')
      expect(found).not.toBeNull()
      return found!
    })
    const second = view.container.querySelector<HTMLElement>('[data-tree-path="1"]')!
    fireEvent.click(first)
    await waitFor(() => expect(contexts).toHaveLength(1))
    fireEvent.click(second)
    await waitFor(() => expect(contexts).toHaveLength(2))
    expect(contexts[0].activation!.activation_id).not.toBe(contexts[1].activation!.activation_id)
    expect(contexts[0].activation!.request_deactivate('explicit')).toBe(false)
    expect(second.classList.contains('snl-single-hover')).toBe(true)
    expect(contexts[1].activation!.request_deactivate('explicit')).toBe(true)
    expect(second.classList.contains('snl-single-hover')).toBe(false)
    expect(contexts[1].activation!.request_deactivate('explicit')).toBe(false)
  })

  it('lets a controller veto pointer-leave while default blank activation still clears', async () => {
    const reasons: string[] = []
    const controller = new SnlDeactivationController({
      params: null,
      handlers: { 'pointer-leave': ({ reason }) => { reasons.push(reason) } },
    })
    const tree = createSnlSyntaxTreeNode('sum', { children: [createSnlSyntaxTreeNode('x')] })
    const view = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={driver} deactivation_controller={controller} />)
    const target = await waitFor(() => {
      const found = view.container.querySelector<HTMLElement>('[data-tree-path="0"]')
      expect(found).not.toBeNull()
      return found!
    })
    const surface = view.container.querySelector<HTMLElement>('.katex-html')!
    const original = document.elementsFromPoint
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [target] })
    try {
      fireEvent.mouseMove(target, { clientX: 1, clientY: 2 })
      expect(target.classList.contains('snl-single-hover')).toBe(true)
      fireEvent.mouseLeave(surface)
      expect(reasons).toEqual(['pointer-leave'])
      expect(target.classList.contains('snl-single-hover')).toBe(true)
      fireEvent.click(surface)
      expect(target.classList.contains('snl-single-hover')).toBe(false)
    } finally {
      Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: original })
    }
  })

  it('preserves the legacy hidden tooltip snapshot on pointer-leave and clears it on blank click', async () => {
    const tree = createSnlSyntaxTreeNode('sum', { children: [createSnlSyntaxTreeNode('x')] })
    const view = render(<SnlSyntaxTreeView
      tree={tree}
      macro_data_driver={driver}
      hooks={{ renderTooltip: (state) => <span data-testid="tooltip-state">{state.visible ? 'visible' : 'hidden'}</span> }}
    />)
    const target = await waitFor(() => {
      const found = view.container.querySelector<HTMLElement>('[data-tree-path="0"]')
      expect(found).not.toBeNull()
      return found!
    })
    const surface = view.container.querySelector<HTMLElement>('.katex-html')!
    const original = document.elementsFromPoint
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [target] })
    try {
      fireEvent.mouseMove(target, { clientX: 1, clientY: 2 })
      await waitFor(() => expect(view.getByTestId('tooltip-state').textContent).toBe('hidden'))
      fireEvent.mouseLeave(surface)
      expect(view.getByTestId('tooltip-state').textContent).toBe('hidden')
      fireEvent.click(surface)
      expect(view.queryByTestId('tooltip-state')).toBeNull()
    } finally {
      Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: original })
    }
  })

  it('lets native and ARIA controls inside a Block consume pointer and keyboard interaction before SNL activation', async () => {
    const localClicks = vi.fn()
    const snlClicks = vi.fn()
    const snlHovers = vi.fn()
    const blockMacro = {
      name: 'interactive.block', description: '', source: { entries: ['entry'], urls: [] }, kind: 'const',
      dynamic_arity: false, tags: [],
      styles: [{ style_name: 'default', mode: 'block' as const, template: '', block_template_name: 'interactive', tags: [] }],
    }
    const tree = createSnlSyntaxTreeNode('interactive.block')
    const view = render(<SnlSyntaxTreeView
      tree={tree}
      macro_data_driver={testDriver({ 'interactive.block': blockMacro })}
      interaction_driver={new SnlInteractionDriver({ on_click: snlClicks, on_hover: snlHovers })}
      hooks={{ renderers: { interactive: () => <>
        <button type="button" onClick={localClicks}>toggle block<svg data-testid="toggle-icon"><path /></svg></button>
        <div role="radio" tabIndex={0} data-testid="radio-control" onClick={localClicks}>choice</div>
        <div role="separator" tabIndex={0} data-testid="separator-control" onClick={localClicks}>resize</div>
        <div role="progressbar" tabIndex={0} data-testid="progress-control" onClick={localClicks}>progress</div>
        <span role="cell" data-testid="plain-cell">plain cell</span>
        <div role="separator" data-testid="plain-separator">plain separator</div>
      </> } }}
    />)
    const button = await waitFor(() => view.getByRole('button', { name: 'toggle block' }))
    const icon = view.getByTestId('toggle-icon').querySelector('path')!
    const ariaControls = [
      view.getByTestId('radio-control'),
      view.getByTestId('separator-control'),
      view.getByTestId('progress-control'),
    ]
    const plainStructures = [
      view.getByTestId('plain-cell'),
      view.getByTestId('plain-separator'),
    ]
    expect(button.closest('[data-tree-path]')).not.toBeNull()
    let pointTarget: Element = button
    const original = document.elementsFromPoint
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [pointTarget] })
    try {
      for (const structure of plainStructures) {
        pointTarget = structure
        fireEvent.mouseMove(structure, { clientX: 1, clientY: 2 })
        fireEvent.click(structure)
      }
      expect(snlClicks).toHaveBeenCalled()
      expect(snlHovers).toHaveBeenCalled()
      snlClicks.mockClear()
      snlHovers.mockClear()

      pointTarget = icon
      fireEvent.mouseMove(icon, { clientX: 1, clientY: 2 })
      fireEvent.click(icon)
      expect(localClicks).toHaveBeenCalledOnce()
      expect(snlClicks).not.toHaveBeenCalled()
      expect(snlHovers).not.toHaveBeenCalled()
      expect(fireEvent.keyDown(icon, { key: 'Enter' })).toBe(true)
      for (const control of ariaControls) {
        pointTarget = control
        fireEvent.mouseMove(control, { clientX: 1, clientY: 2 })
        fireEvent.click(control)
        expect(fireEvent.keyDown(control, { key: 'Enter' })).toBe(true)
      }
      expect(localClicks).toHaveBeenCalledTimes(4)
      expect(snlClicks).not.toHaveBeenCalled()
      expect(snlHovers).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: original })
    }
  })

  it('allows an initialized activation controller to replace phase 0 with custom params', async () => {
    const replacement = vi.fn()
    const onHover = vi.fn()
    const controller = new SnlActivationController({
      params: { consumer: 'canvas' },
      handlers: {
        0: ({ params }) => { replacement(params) },
      },
    })
    const tree = createSnlSyntaxTreeNode('sum', { children: [createSnlSyntaxTreeNode('x')] })
    const view = render(
      <SnlSyntaxTreeView
        tree={tree}
        macro_data_driver={driver}
        activation_controller={controller}
        hooks={{ onHover }}
      />,
    )
    const target = await waitFor(() => {
      const found = view.container.querySelector<HTMLElement>('[data-tree-path="0"]')
      expect(found).not.toBeNull()
      return found!
    })
    const original = document.elementsFromPoint
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [target] })
    try {
      fireEvent.mouseMove(target, { clientX: 1, clientY: 2 })
      expect(replacement).toHaveBeenCalledWith({ consumer: 'canvas' })
      expect(onHover).not.toHaveBeenCalled()
      expect(target.classList.contains('snl-single-hover')).toBe(false)
    } finally {
      Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: original })
    }
  })

  it('uses tree paths symmetrically for multiple binder sources across all phases', async () => {
    const events: Array<{ name: string; variableRole: string }> = []
    const tree = parseSnlSyntaxTree('scope(@x,@y,x,y)')
    const view = render(
      <SnlSyntaxTreeView
        tree={tree}
        macro_data_driver={testDriver({})}
        hooks={{ onHover: ({ name, variableRole }) => { events.push({ name, variableRole }) } }}
      />,
    )
    const binderY = await waitFor(() => {
      const found = view.container.querySelector<HTMLElement>('[data-kind="binder"][data-tree-path="1"]')
      expect(found).not.toBeNull()
      return found!
    })
    const binderX = view.container.querySelector<HTMLElement>('[data-kind="binder"][data-tree-path="0"]')!
    const bvarX = view.container.querySelector<HTMLElement>('[data-kind="bvar"][data-source-path="0"]')!
    const bvarY = view.container.querySelector<HTMLElement>('[data-kind="bvar"][data-source-path="1"]')!
    let pointed = bvarX
    const original = document.elementsFromPoint
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [pointed] })
    vi.useFakeTimers()
    try {
      fireEvent.mouseMove(bvarX, { clientX: 5, clientY: 6 })
      expect(bvarX.classList.contains('snl-single-hover')).toBe(true)
      expect(binderX.classList.contains('snl-binder-decl')).toBe(false)
      expect(events.at(-1)).toEqual({ name: 'x', variableRole: 'bvar' })
      act(() => vi.advanceTimersByTime(1000))
      expect(binderX.classList.contains('snl-binder-decl')).toBe(true)
      expect(bvarX.classList.contains('snl-bvar-scope')).toBe(false)
      act(() => vi.advanceTimersByTime(1000))
      expect(bvarX.classList.contains('snl-bvar-scope')).toBe(true)

      fireEvent.click(view.container.querySelector('.katex-html')!)
      pointed = binderY
      fireEvent.mouseMove(binderY, { clientX: 9, clientY: 10 })
      expect(bvarY.classList.contains('snl-bvar-scope')).toBe(false)
      act(() => vi.advanceTimersByTime(1000))
      expect(bvarY.classList.contains('snl-bvar-scope')).toBe(true)
      expect(binderY.classList.contains('snl-binder-decl')).toBe(true)
      expect(bvarX.classList.contains('snl-bvar-scope')).toBe(false)
      expect(events.at(-1)).toEqual({ name: 'y', variableRole: 'bvar' })
    } finally {
      vi.useRealTimers()
      Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: original })
    }
  })

  it('separates immediate, 1-second, and 2-second hover hooks and locks at 2 seconds', async () => {
    const immediate = vi.fn()
    const afterOneSecond = vi.fn()
    const afterTwoSeconds = vi.fn()
    const tree = createSnlSyntaxTreeNode('sum', {
      children: [createSnlSyntaxTreeNode('x'), createSnlSyntaxTreeNode('x')],
    })
    const hooks = {
      onHover: immediate,
      onHover1s: afterOneSecond,
      onHover2s: afterTwoSeconds,
      renderTooltip: (state: { visible: boolean; locked?: boolean }) => (
        <div data-testid="timed-tooltip" data-visible={String(state.visible)} data-locked={String(Boolean(state.locked))} />
      ),
    }
    const { container, getByTestId } = render(
      <SnlSyntaxTreeView tree={tree} macro_data_driver={driver} hooks={hooks as never} />,
    )
    const target = await waitFor(() => {
      const found = container.querySelector<HTMLElement>('[data-tree-path="0"]')
      expect(found).not.toBeNull()
      return found!
    })
    const surface = container.querySelector<HTMLElement>('.katex-html')!
    const original = document.elementsFromPoint
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [target] })
    vi.useFakeTimers()
    try {
      fireEvent.mouseMove(target, { clientX: 10, clientY: 20 })
      expect(immediate).toHaveBeenCalledTimes(1)
      expect(afterOneSecond).not.toHaveBeenCalled()
      expect(afterTwoSeconds).not.toHaveBeenCalled()
      expect(target.classList.contains('snl-single-hover')).toBe(true)
      expect(getByTestId('timed-tooltip').dataset.visible).toBe('false')

      act(() => vi.advanceTimersByTime(1000))
      expect(afterOneSecond).toHaveBeenCalledTimes(1)
      expect(getByTestId('timed-tooltip').dataset.visible).toBe('true')
      expect(getByTestId('timed-tooltip').dataset.locked).toBe('false')

      act(() => vi.advanceTimersByTime(1000))
      expect(afterTwoSeconds).toHaveBeenCalledTimes(1)
      expect(getByTestId('timed-tooltip').dataset.locked).toBe('true')

      fireEvent.mouseLeave(surface)
      expect(getByTestId('timed-tooltip').dataset.visible).toBe('true')
      expect(getByTestId('timed-tooltip').dataset.locked).toBe('true')
    } finally {
      vi.useRealTimers()
      Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: original })
    }
  })

  it('does not let a phase default resurrect an activation deactivated reentrantly by its controller', async () => {
    let lease: SnlInteractionContext['activation']
    const controller = new SnlActivationController({
      params: null,
      handlers: {
        1: ({ runDefault }) => {
          expect(lease?.request_deactivate('explicit')).toBe(true)
          runDefault()
        },
      },
    })
    const tree = createSnlSyntaxTreeNode('sum', { children: [createSnlSyntaxTreeNode('x')] })
    const view = render(<SnlSyntaxTreeView
      tree={tree}
      macro_data_driver={driver}
      activation_controller={controller}
      interaction_driver={new SnlInteractionDriver({ on_hover: (context) => { lease = context.activation } })}
    />)
    const target = await waitFor(() => {
      const found = view.container.querySelector<HTMLElement>('[data-tree-path="0"]')
      expect(found).not.toBeNull()
      return found!
    })
    const original = document.elementsFromPoint
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [target] })
    vi.useFakeTimers()
    try {
      fireEvent.mouseMove(target, { clientX: 1, clientY: 2 })
      expect(target.classList.contains('snl-single-hover')).toBe(true)
      act(() => vi.advanceTimersByTime(1000))
      expect(target.classList.contains('snl-single-hover')).toBe(false)
      expect(view.container.querySelector('.snl-binder-decl, .snl-bvar-scope')).toBeNull()
    } finally {
      Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: original })
      vi.useRealTimers()
    }
  })

  it('shares one explicit hover session across all three phase hooks', async () => {
    const phases: unknown[] = []
    let message: unknown
    const hooks = {
      onHover: (event: any) => { phases.push(event) },
      onHover1s: (event: any) => {
        phases.push(event)
        event.session.data.set('popover', 'opened-at-1s')
      },
      onHover2s: (event: any) => {
        phases.push(event)
        message = event.session.data.get('popover')
      },
    }
    const tree = createSnlSyntaxTreeNode('sum', { children: [createSnlSyntaxTreeNode('x')] })
    const { container } = render(
      <SnlSyntaxTreeView tree={tree} macro_data_driver={driver} hooks={hooks as never} />,
    )
    const target = await waitFor(() => {
      const found = container.querySelector<HTMLElement>('[data-tree-path="0"]')
      expect(found).not.toBeNull()
      return found!
    })
    const original = document.elementsFromPoint
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [target] })
    vi.useFakeTimers()
    try {
      fireEvent.mouseMove(target, { clientX: 1, clientY: 2 })
      act(() => vi.advanceTimersByTime(2000))
      expect(phases).toHaveLength(3)
      expect((phases[1] as any).session).toBe((phases[0] as any).session)
      expect((phases[2] as any).session).toBe((phases[0] as any).session)
      expect(message).toBe('opened-at-1s')
    } finally {
      vi.useRealTimers()
      Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: original })
    }
  })

  it('cancels old hover phases and lock state when the tree changes', async () => {
    const afterOneSecond = vi.fn()
    const afterTwoSeconds = vi.fn()
    const first = createSnlSyntaxTreeNode('sum', { children: [createSnlSyntaxTreeNode('x')] })
    const second = createSnlSyntaxTreeNode('sum', { children: [createSnlSyntaxTreeNode('x'), createSnlSyntaxTreeNode('x')] })
    const view = render(
      <SnlSyntaxTreeView tree={first} macro_data_driver={driver} hooks={{ onHover1s: afterOneSecond, onHover2s: afterTwoSeconds }} />,
    )
    const oldTarget = await waitFor(() => {
      const found = view.container.querySelector<HTMLElement>('[data-tree-path="0"]')
      expect(found).not.toBeNull()
      return found!
    })
    let pointed: HTMLElement = oldTarget
    const original = document.elementsFromPoint
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [pointed] })
    vi.useFakeTimers()
    try {
      fireEvent.mouseMove(oldTarget, { clientX: 1, clientY: 2 })
      view.rerender(
        <SnlSyntaxTreeView tree={second} macro_data_driver={driver} hooks={{ onHover1s: afterOneSecond, onHover2s: afterTwoSeconds }} />,
      )
      act(() => vi.advanceTimersByTime(2000))
      expect(afterOneSecond).not.toHaveBeenCalled()
      expect(afterTwoSeconds).not.toHaveBeenCalled()
      await act(async () => { await Promise.resolve(); await Promise.resolve() })
      pointed = view.container.querySelector<HTMLElement>('[data-tree-path="1"]')!
      expect(pointed).not.toBeNull()
      fireEvent.mouseMove(pointed, { clientX: 3, clientY: 4 })
      act(() => vi.advanceTimersByTime(2000))
      expect(afterTwoSeconds).toHaveBeenCalledTimes(1)
      expect(afterTwoSeconds.mock.calls[0][0].node).not.toBe(second.children[1])
      expect(afterTwoSeconds.mock.calls[0][0].node).toMatchObject({ macro_name: 'x', kind: 'const' })
    } finally {
      vi.useRealTimers()
      Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: original })
    }
  })

  it('isolates phase hook exceptions from default show and lock transitions', async () => {
    const tree = createSnlSyntaxTreeNode('sum', { children: [createSnlSyntaxTreeNode('x')] })
    const view = render(
      <SnlSyntaxTreeView tree={tree} macro_data_driver={driver} hooks={{
        onHover: () => { throw new Error('immediate hook failed') },
        onHover1s: () => { throw new Error('one-second hook failed') },
        onHover2s: () => { throw new Error('two-second hook failed') },
      }} />,
    )
    const target = await waitFor(() => {
      const found = view.container.querySelector<HTMLElement>('[data-tree-path="0"]')
      expect(found).not.toBeNull()
      return found!
    })
    const original = document.elementsFromPoint
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [target] })
    vi.useFakeTimers()
    try {
      expect(() => fireEvent.mouseMove(target, { clientX: 1, clientY: 2 })).not.toThrow()
      expect(() => act(() => vi.advanceTimersByTime(2000))).not.toThrow()
      expect(view.container.querySelector('.snl-hover-tooltip')?.classList.contains('visible')).toBe(true)
      expect(view.container.querySelector('.snl-hover-tooltip')?.getAttribute('data-locked')).toBe('true')
      expect(() => fireEvent.mouseLeave(view.container.querySelector('.katex-html')!)).not.toThrow()
    } finally {
      vi.useRealTimers()
      Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: original })
    }
  })

  it('handles rejected tooltip info and deduplicates hover-to-click resolution', async () => {
    const resolveMacroInfo = vi.fn(async () => { throw new Error('info failed') })
    const tree = createSnlSyntaxTreeNode('sum', { children: [createSnlSyntaxTreeNode('x')] })
    const view = render(
      <SnlSyntaxTreeView tree={tree} macro_data_driver={driver} hooks={{ resolveMacroInfo }} />,
    )
    const target = await waitFor(() => {
      const found = view.container.querySelector<HTMLElement>('[data-tree-path="0"]')
      expect(found).not.toBeNull()
      return found!
    })
    const original = document.elementsFromPoint
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [target] })
    vi.useFakeTimers()
    try {
      fireEvent.mouseMove(target, { clientX: 1, clientY: 2 })
      act(() => vi.advanceTimersByTime(500))
      fireEvent.click(target, { clientX: 1, clientY: 2 })
      await act(async () => { await Promise.resolve() })
      expect(resolveMacroInfo).toHaveBeenCalledTimes(1)
      expect(view.container.querySelector('.tooltip-loading')).toBeNull()
      expect(view.container.querySelector('.tooltip-desc')?.textContent).toContain('info failed')
    } finally {
      vi.useRealTimers()
      Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: original })
    }
  })

  it('locks the node tooltip immediately on click without a custom interaction driver', async () => {
    const tree = createSnlSyntaxTreeNode('sum', {
      children: [createSnlSyntaxTreeNode('x'), createSnlSyntaxTreeNode('x')],
    })
    const { container, getByTestId } = render(
      <SnlSyntaxTreeView
        tree={tree}
        macro_data_driver={driver}
        hooks={{
          renderTooltip: ((state: { visible: boolean; locked?: boolean }) => (
            <div data-testid="click-tooltip" data-visible={String(state.visible)} data-locked={String(Boolean(state.locked))} />
          )) as never,
        }}
      />,
    )
    const target = await waitFor(() => {
      const found = container.querySelector<HTMLElement>('[data-tree-path="0"]')
      expect(found).not.toBeNull()
      return found!
    })
    fireEvent.click(target, { clientX: 30, clientY: 40 })
    expect(getByTestId('click-tooltip').dataset.visible).toBe('true')
    expect(getByTestId('click-tooltip').dataset.locked).toBe('true')
  })

  it('continues loading tooltip info when a pending hover is locked by click', async () => {
    const resolveMacroInfo = vi.fn(async () => ({ description: 'loaded by click' }))
    const tree = createSnlSyntaxTreeNode('sum', {
      children: [createSnlSyntaxTreeNode('x'), createSnlSyntaxTreeNode('x')],
    })
    const { container } = render(
      <SnlSyntaxTreeView tree={tree} macro_data_driver={driver} hooks={{ resolveMacroInfo }} />,
    )
    const target = await waitFor(() => {
      const found = container.querySelector<HTMLElement>('[data-tree-path="0"]')
      expect(found).not.toBeNull()
      return found!
    })
    const original = document.elementsFromPoint
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [target] })
    vi.useFakeTimers()
    try {
      fireEvent.mouseMove(target, { clientX: 10, clientY: 20 })
      fireEvent.click(target, { clientX: 10, clientY: 20 })
      await act(async () => { await vi.advanceTimersByTimeAsync(120) })
      expect(resolveMacroInfo).toHaveBeenCalledTimes(1)
      expect(container.querySelector('.tooltip-loading')).toBeNull()
    } finally {
      vi.useRealTimers()
      Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: original })
    }
  })

  it('uses a pointer cursor whenever a clickable SNL node is hovered', async () => {
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
      interactionSurface.style.color = '#111111'
      fireEvent.mouseMove(target, { clientX: 20, clientY: 30 })
      expect(target.classList.contains('snl-single-hover')).toBe(true)
      const baseColor = interactionSurface.style.getPropertyValue('--snl-base-text-color')
      expect(baseColor).not.toBe('')
      expect(baseColor).toBe(window.getComputedStyle(interactionSurface).color)
      expect(interactionSurface.style.cursor).toBe('pointer')

      fireEvent.keyDown(window, { key: 'Control', ctrlKey: true })
      expect(interactionSurface.style.cursor).toBe('pointer')

      fireEvent.keyUp(window, { key: 'Control' })
      expect(interactionSurface.style.cursor).toBe('pointer')

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
      expect(hovers[0].node).not.toBe(tree.children[1])
      expect(hovers[0].node).toMatchObject({ macro_name: 'x', kind: 'const' })
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
    const formulaDb = {
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
    } as unknown as SnlMacroRecord
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
        kind: 'const',
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
      expect(hovers[0].node).not.toBe(tree)
      expect(hovers[0].node).toMatchObject({ macro_name: 'list', kind: 'const' })
      expect(hovers[0].tree_path).toEqual([])
    } finally {
      Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: original })
    }
  })
})
