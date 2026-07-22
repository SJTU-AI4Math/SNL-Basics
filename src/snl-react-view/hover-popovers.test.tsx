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

function ApiObserver({ onValue }: { onValue(api: ReturnType<typeof useHoverPopovers<string>>): void }): null {
  onValue(useHoverPopovers<string>())
  return null
}

describe('HoverPopoverProvider', () => {
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
