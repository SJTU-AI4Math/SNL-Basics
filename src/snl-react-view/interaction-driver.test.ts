// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { fireEvent, render, waitFor } from '@testing-library/react'
import {
  SnlInteractionDriver,
  encodeTreePath,
  decodeTreePath,
  resolveTreePath,
} from './interaction-driver'
import type { SnlInteractionContext } from './interaction-driver'
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import { testDriver } from './test-helpers'

function makeTree(): SnlSyntaxTree {
  return {
    macro_name: 'root',
    kind: '',
    mdata: null,
    children: [
      {
        macro_name: 'child0',
        kind: '',
        mdata: null,
        children: [
          { macro_name: 'grandchild0_0', kind: '', mdata: null, children: [] },
          { macro_name: 'grandchild0_1', kind: '', mdata: null, children: [] },
        ],
      },
      { macro_name: 'child1', kind: '', mdata: null, children: [] },
    ],
  }
}

function makeContext(overrides: Partial<SnlInteractionContext> = {}): SnlInteractionContext {
  return {
    node: makeTree(),
    tree_path: [],
    macro: null,
    target: document.createElement('span'),
    client_x: 100,
    client_y: 200,
    ctrl_key: false,
    meta_key: false,
    shift_key: false,
    alt_key: false,
    ...overrides,
  }
}

describe('TreePath utilities', () => {
  it('encodeTreePath encodes empty path as empty string', () => {
    expect(encodeTreePath([])).toBe('')
  })

  it('encodeTreePath encodes indices with dots', () => {
    expect(encodeTreePath([0, 2, 1])).toBe('0.2.1')
  })

  it('decodeTreePath decodes empty string to empty array', () => {
    expect(decodeTreePath('')).toEqual([])
  })

  it('decodeTreePath decodes dot-separated indices', () => {
    expect(decodeTreePath('0.2.1')).toEqual([0, 2, 1])
  })

  it('resolveTreePath resolves root with empty path', () => {
    const tree = makeTree()
    expect(resolveTreePath(tree, [])).toBe(tree)
  })

  it('resolveTreePath resolves deep path', () => {
    const tree = makeTree()
    const node = resolveTreePath(tree, [0, 1])
    expect(node?.macro_name).toBe('grandchild0_1')
  })

  it('resolveTreePath returns undefined for invalid path', () => {
    const tree = makeTree()
    expect(resolveTreePath(tree, [5])).toBeUndefined()
    expect(resolveTreePath(tree, [0, 0, 0])).toBeUndefined()
  })

  it('handles duplicate macro names at different paths', () => {
    const tree: SnlSyntaxTree = {
      macro_name: 'sum',
      kind: '',
      mdata: null,
      children: [
        { macro_name: 'x', kind: '', mdata: null, children: [] },
        { macro_name: 'x', kind: '', mdata: null, children: [] },
      ],
    }
    const first = resolveTreePath(tree, [0])
    const second = resolveTreePath(tree, [1])
    // Both resolve to 'x' nodes but at different paths
    expect(first?.macro_name).toBe('x')
    expect(second?.macro_name).toBe('x')
    expect(first).not.toBe(second)
  })
})

describe('SnlInteractionDriver', () => {
  describe('dispatch_click', () => {
    it('calls on_click for non-ctrl click', async () => {
      const onClick = vi.fn()
      const driver = new SnlInteractionDriver({ on_click: onClick })
      await driver.dispatch_click(makeContext({ ctrl_key: false }))
      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('calls on_ctrl_click for ctrl+click', async () => {
      const onCtrlClick = vi.fn()
      const onClick = vi.fn()
      const driver = new SnlInteractionDriver({ on_click: onClick, on_ctrl_click: onCtrlClick })
      await driver.dispatch_click(makeContext({ ctrl_key: true }))
      expect(onCtrlClick).toHaveBeenCalledTimes(1)
      expect(onClick).not.toHaveBeenCalled()
    })

    it('falls back to on_click when ctrl+click with no on_ctrl_click', async () => {
      const onClick = vi.fn()
      const driver = new SnlInteractionDriver({ on_click: onClick })
      await driver.dispatch_click(makeContext({ ctrl_key: true }))
      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('does NOT treat meta_key as ctrl', async () => {
      const onCtrlClick = vi.fn()
      const onClick = vi.fn()
      const driver = new SnlInteractionDriver({ on_click: onClick, on_ctrl_click: onCtrlClick })
      // Meta key only (macOS Cmd) should NOT trigger ctrl_click
      await driver.dispatch_click(makeContext({ ctrl_key: false, meta_key: true }))
      expect(onCtrlClick).not.toHaveBeenCalled()
      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('does nothing when no callbacks defined', async () => {
      const driver = new SnlInteractionDriver({})
      // Should not throw
      await driver.dispatch_click(makeContext())
    })
  })

  describe('dispatch_hover', () => {
    it('calls on_hover with context', async () => {
      const onHover = vi.fn()
      const driver = new SnlInteractionDriver({ on_hover: onHover })
      const ctx = makeContext({ tree_path: [0, 1] })
      await driver.dispatch_hover(ctx)
      expect(onHover).toHaveBeenCalledWith(ctx)
    })

    it('does nothing when no on_hover defined', async () => {
      const driver = new SnlInteractionDriver({})
      await driver.dispatch_hover(makeContext())
    })
  })

  describe('dispatch_leave', () => {
    it('calls on_leave', async () => {
      const onLeave = vi.fn()
      const driver = new SnlInteractionDriver({ on_leave: onLeave })
      await driver.dispatch_leave()
      expect(onLeave).toHaveBeenCalledTimes(1)
    })
  })

  describe('async callbacks', () => {
    it('awaits async on_click', async () => {
      const order: string[] = []
      const driver = new SnlInteractionDriver({
        on_click: async () => {
          await new Promise((r) => setTimeout(r, 10))
          order.push('click_done')
        },
      })
      await driver.dispatch_click(makeContext())
      order.push('after_dispatch')
      expect(order).toEqual(['click_done', 'after_dispatch'])
    })
  })

  describe('context includes all modifier keys', () => {
    it('passes all modifier key states through', async () => {
      let received: SnlInteractionContext | null = null
      const driver = new SnlInteractionDriver({
        on_click: (ctx) => { received = ctx },
      })
      await driver.dispatch_click(makeContext({
        ctrl_key: true,
        meta_key: true,
        shift_key: true,
        alt_key: true,
      }))
      // ctrl_key is true so on_click is called (fallback since no on_ctrl_click)
      expect(received!.ctrl_key).toBe(true)
      expect(received!.meta_key).toBe(true)
      expect(received!.shift_key).toBe(true)
      expect(received!.alt_key).toBe(true)
    })
  })
})

describe('SnlSyntaxTreeView delegated interactions', () => {
  function duplicateNameTree(): SnlSyntaxTree {
    return {
      macro_name: '#0 / #1', env_mode: 'text', kind: '', mdata: { identity: 'root' },
      children: [
        {
          macro_name: '#0', env_mode: 'text', kind: '', mdata: { identity: 'outer' },
          children: [
            { macro_name: 'duplicate', env_mode: 'text', kind: '', mdata: { identity: 'nested' }, children: [] },
          ],
        },
        { macro_name: 'duplicate', env_mode: 'text', kind: '', mdata: { identity: 'sibling' }, children: [] },
      ],
    }
  }

  it('delegates a nested duplicate-name click to the real node and tree_path', async () => {
    const tree = duplicateNameTree()
    const onClick = vi.fn()
    const { container } = render(createElement(SnlSyntaxTreeView, {
      tree,
      macro_data_driver: testDriver({}),
      interaction_driver: new SnlInteractionDriver({ on_click: onClick }),
    }))
    await waitFor(() => expect(container.querySelector('[data-tree-path="0.0"]')).not.toBeNull())
    fireEvent.click(container.querySelector('[data-tree-path="0.0"]')!)
    await waitFor(() => expect(onClick).toHaveBeenCalledTimes(1))
    const ctx = onClick.mock.calls[0][0] as SnlInteractionContext
    expect(ctx.tree_path).toEqual([0, 0])
    expect(ctx.node).toBe(tree.children[0].children[0])
    expect(ctx.node.mdata).toEqual({ identity: 'nested' })
  })

  it('delegates Ctrl-click to on_ctrl_click with the real nested path', async () => {
    const tree = duplicateNameTree()
    const onClick = vi.fn()
    const onCtrlClick = vi.fn()
    const { container } = render(createElement(SnlSyntaxTreeView, {
      tree,
      macro_data_driver: testDriver({}),
      interaction_driver: new SnlInteractionDriver({ on_click: onClick, on_ctrl_click: onCtrlClick }),
    }))
    await waitFor(() => expect(container.querySelector('[data-tree-path="0.0"]')).not.toBeNull())
    fireEvent.click(container.querySelector('[data-tree-path="0.0"]')!, { ctrlKey: true })
    await waitFor(() => expect(onCtrlClick).toHaveBeenCalledTimes(1))
    expect(onClick).not.toHaveBeenCalled()
    expect((onCtrlClick.mock.calls[0][0] as SnlInteractionContext).tree_path).toEqual([0, 0])
  })

  it('keeps Meta-click distinct from Ctrl-click in delegated dispatch', async () => {
    const tree = duplicateNameTree()
    const onClick = vi.fn()
    const onCtrlClick = vi.fn()
    const { container } = render(createElement(SnlSyntaxTreeView, {
      tree,
      macro_data_driver: testDriver({}),
      interaction_driver: new SnlInteractionDriver({ on_click: onClick, on_ctrl_click: onCtrlClick }),
    }))
    await waitFor(() => expect(container.querySelector('[data-tree-path="1"]')).not.toBeNull())
    fireEvent.click(container.querySelector('[data-tree-path="1"]')!, { metaKey: true })
    await waitFor(() => expect(onClick).toHaveBeenCalledTimes(1))
    expect(onCtrlClick).not.toHaveBeenCalled()
    const ctx = onClick.mock.calls[0][0] as SnlInteractionContext
    expect(ctx.tree_path).toEqual([1])
    expect(ctx.meta_key).toBe(true)
    expect(ctx.ctrl_key).toBe(false)
    expect(ctx.node).toBe(tree.children[1])
  })
})
