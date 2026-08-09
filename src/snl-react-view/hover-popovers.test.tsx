// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HoverPopoverProvider,
  collectPopoverSubtree,
  expandPopoverAncestors,
  useCurrentPopoverId,
  useHoverPopovers,
  type HoverPopover,
} from './hover-popovers'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('generic hover popover state', () => {
  const tree: Array<Pick<HoverPopover<string>, 'id' | 'parentId'>> = [
    { id: 'root', parentId: null },
    { id: 'child', parentId: 'root' },
    { id: 'grandchild', parentId: 'child' },
    { id: 'sibling', parentId: null },
  ]

  it('collects a dismissed popover and all descendants', () => {
    expect([...collectPopoverSubtree('child', tree)]).toEqual(['child', 'grandchild'])
  })

  it('keeps every ancestor of a popover under the pointer', () => {
    expect([...expandPopoverAncestors(new Set(['grandchild']), tree)]).toEqual([
      'grandchild',
      'child',
      'root',
    ])
  })
})

function Harness(): ReactElement {
  const popovers = useHoverPopovers<string>()
  const parentId = useCurrentPopoverId()
  return (
    <button
      onClick={(event) => popovers.spawn(
        'entry-a',
        event.currentTarget,
        20,
        30,
        parentId,
      )}
    >
      spawn
    </button>
  )
}

function PinHarness(): ReactElement {
  const popovers = useHoverPopovers<string>()
  return <><button onClick={(event) => popovers.pin('entry-a', event.currentTarget, 20, 30, null)}>pin</button><div data-testid="stopped-blank" onPointerDown={(event) => event.stopPropagation()}>blank</div></>
}

function SwitchPinHarness(): ReactElement {
  const popovers = useHoverPopovers<string>()
  return <>
    <button id="first-origin" onClick={(event) => popovers.pin('entry-a', event.currentTarget, 20, 30, null)}>pin first</button>
    <button id="second-origin" onClick={(event) => popovers.pin('entry-a', event.currentTarget, 40, 50, null)}>pin second</button>
  </>
}

function RootPreviewHarness(): ReactElement {
  const popovers = useHoverPopovers<string>()
  return <button onMouseMove={(event) => popovers.preview('parent', event.currentTarget, 20, 30, null)}>preview parent</button>
}

function ChildPinHarness(): ReactElement {
  const popovers = useHoverPopovers<string>()
  const parentId = useCurrentPopoverId()
  return <button onClick={(event) => popovers.pin('child', event.currentTarget, 40, 50, parentId)}>pin child</button>
}

function ApiObserver({ onValue }: { onValue(api: ReturnType<typeof useHoverPopovers<string>>): void }): null {
  onValue(useHoverPopovers<string>())
  return null
}

describe('HoverPopoverProvider', () => {
  it('makes click-only pins visible immediately without waiting for hover delay', () => {
    vi.useFakeTimers()
    let phase: HoverPopover<string>['phase'] | null = null
    render(
      <HoverPopoverProvider<string>
        renderPopover={(popover) => { phase = popover.phase; return <div>delayed pin</div> }}
        options={{ openDelayMs: 1000, fadeMs: 0 }}
      >
        <PinHarness />
      </HoverPopoverProvider>,
    )
    fireEvent.click(screen.getByText('pin'))
    expect(phase).toBe('visible')
    expect(document.querySelector('[data-frozen="true"]')).not.toBeNull()
    act(() => vi.advanceTimersByTime(1000))
    expect(phase).toBe('visible')
  })

  it('deduplicates repeated previews and preserves a pinned recursive child', () => {
    render(
      <HoverPopoverProvider<string>
        renderPopover={(popover) => popover.subject === 'parent'
          ? <><span>parent preview</span><ChildPinHarness /></>
          : <span>pinned child preview</span>}
        options={{ openDelayMs: 0, fadeMs: 0 }}
      >
        <RootPreviewHarness />
      </HoverPopoverProvider>,
    )
    const origin = screen.getByText('preview parent')
    fireEvent.mouseMove(origin)
    fireEvent.mouseMove(origin)
    expect(document.querySelectorAll('[data-popover-id]')).toHaveLength(1)
    fireEvent.click(screen.getByText('pin child'))
    expect(document.querySelectorAll('[data-popover-id]')).toHaveLength(2)
    fireEvent.pointerMove(document, { clientX: 900, clientY: 700 })
    expect(screen.queryByText('parent preview')).toBeNull()
    expect(screen.getByText('pinned child preview')).toBeTruthy()
    expect(document.querySelectorAll('[data-popover-id]')).toHaveLength(1)
  })

  it('switches same-subject pins by exact origin identity', () => {
    render(
      <HoverPopoverProvider<string>
        renderPopover={(popover) => <div>origin:{popover.originElement?.id}</div>}
        options={{ openDelayMs: 0, fadeMs: 0 }}
      >
        <SwitchPinHarness />
      </HoverPopoverProvider>,
    )
    fireEvent.click(screen.getByText('pin first'))
    expect(screen.getByText('origin:first-origin')).toBeTruthy()
    const firstId = document.querySelector('[data-popover-id]')?.getAttribute('data-popover-id')
    fireEvent.pointerDown(screen.getByText('pin first'))
    fireEvent.click(screen.getByText('pin first'))
    expect(document.querySelectorAll('[data-popover-id]')).toHaveLength(1)
    expect(document.querySelector('[data-popover-id]')?.getAttribute('data-popover-id')).toBe(firstId)
    fireEvent.click(screen.getByText('pin second'))
    expect(screen.queryByText('origin:first-origin')).toBeNull()
    expect(screen.getByText('origin:second-origin')).toBeTruthy()
    expect(document.querySelectorAll('[data-popover-id]')).toHaveLength(1)
  })

  it('dismisses pinned popovers on outside pointer-down and Escape', () => {
    const view = render(
      <HoverPopoverProvider<string>
        renderPopover={() => <button>inside popover</button>}
        options={{ openDelayMs: 0, fadeMs: 0 }}
      >
        <PinHarness />
      </HoverPopoverProvider>,
    )
    fireEvent.click(screen.getByText('pin'))
    expect(screen.getByText('inside popover')).toBeTruthy()
    fireEvent.pointerDown(screen.getByText('inside popover'))
    expect(screen.getByText('inside popover')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('inside popover')).toBeNull()

    fireEvent.click(screen.getByText('pin'))
    fireEvent.pointerDown(screen.getByTestId('stopped-blank'))
    expect(screen.queryByText('inside popover')).toBeNull()

    fireEvent.click(screen.getByText('pin'))
    fireEvent.pointerDown(view.container)
    expect(screen.queryByText('inside popover')).toBeNull()
  })

  it('clicking a recursive layer clears only deeper layers', () => {
    let api: ReturnType<typeof useHoverPopovers<string>> | null = null
    render(
      <HoverPopoverProvider<string>
        renderPopover={(popover) => <span>{popover.subject}</span>}
        options={{ openDelayMs: 0, fadeMs: 0 }}
      >
        <ApiObserver onValue={(value) => { api = value }} />
      </HoverPopoverProvider>,
    )
    const origin = document.createElement('button')
    document.body.appendChild(origin)
    let root = ''
    let child = ''
    act(() => {
      root = api!.spawn('root layer', origin, 10, 10, null)
      child = api!.spawn('child layer', origin, 20, 20, root)
      api!.spawn('grandchild layer', origin, 30, 30, child)
    })
    expect(document.querySelectorAll('[data-popover-id]')).toHaveLength(3)
    fireEvent.pointerDown(document.querySelector(`[data-popover-id="${child}"]`)!)
    expect(screen.getByText('root layer')).toBeTruthy()
    expect(screen.getByText('child layer')).toBeTruthy()
    expect(screen.queryByText('grandchild layer')).toBeNull()
    expect(document.querySelectorAll('[data-popover-id]')).toHaveLength(2)
    origin.remove()
  })

  it('keeps the consumer action context stable while the popover stack moves', () => {
    let api: ReturnType<typeof useHoverPopovers<string>> | null = null
    let renders = 0
    render(
      <HoverPopoverProvider<string>
        renderPopover={() => <div>preview</div>}
        options={{ openDelayMs: 0, fadeMs: 0 }}
      >
        <ApiObserver onValue={(value) => { api = value; renders += 1 }} />
      </HoverPopoverProvider>,
    )
    const origin = document.createElement('button')
    document.body.appendChild(origin)
    let id = ''
    act(() => { id = api!.spawn('entry-a', origin, 10, 20, null) })
    act(() => api!.updatePointer(id, 30, 40))
    expect(renders).toBe(1)
  })

  it('renders consumer-owned content through a shared portal stack', () => {
    render(
      <HoverPopoverProvider<string>
        renderPopover={(popover) => <div>popover:{popover.subject}</div>}
        options={{ openDelayMs: 0, fadeMs: 0 }}
      >
        <Harness />
      </HoverPopoverProvider>,
    )

    fireEvent.click(screen.getByText('spawn'))
    expect(screen.getByText('popover:entry-a')).toBeTruthy()
  })

  it('supports a configurable automatic freeze timer', () => {
    vi.useFakeTimers()
    let frozen = false
    render(
      <HoverPopoverProvider<string>
        renderPopover={(popover) => {
          frozen = popover.frozen
          return <div>state</div>
        }}
        options={{ openDelayMs: 0, fadeMs: 0, freezeDelayMs: 1000 }}
      >
        <Harness />
      </HoverPopoverProvider>,
    )

    fireEvent.click(screen.getByText('spawn'))
    expect(frozen).toBe(false)
    act(() => vi.advanceTimersByTime(1000))
    expect(frozen).toBe(true)
    vi.useRealTimers()
  })
})
