// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode, useEffect, useLayoutEffect, useState, type ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HoverPopoverProvider,
  collectPopoverSubtree,
  expandPopoverAncestors,
  useCurrentPopoverId,
  useHoverPopovers,
  type HoverPopover,
} from './hover-popovers'
import { HoverPopoverDismissController, type HoverPopoverDismissRequest } from './popover-dismiss-controller'
import type { SnlActivationLease } from './deactivation-controller'

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

function DescriptorPreviewPinHarness({ subject = 'entry-a', parentId = null }: {
  subject?: string
  parentId?: string | null
}): ReactElement {
  const popovers = useHoverPopovers<string>()
  const origin = (element: HTMLElement) => ({ element, bounds: 'viewport' as const })
  return <button
    data-testid={`descriptor-origin-${subject}`}
    onPointerMove={(event) => popovers.preview(subject, origin(event.currentTarget), event.clientX, event.clientY, parentId)}
    onClick={(event) => popovers.pin(subject, origin(event.currentTarget), event.clientX, event.clientY, parentId)}
  >descriptor {subject}</button>
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

function SettlingPopover(): ReactElement {
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), 0)
    return () => clearTimeout(timer)
  }, [])
  return <span data-settled={settled ? 'true' : 'false'}>{settled ? 'settled' : 'loading'}</span>
}

describe('HoverPopoverProvider', () => {
  it('dispatches one immutable all-scope request and deactivates targets leaf-first', () => {
    const order: string[] = []
    const requests: unknown[] = []
    const controller = new HoverPopoverDismissController({
      params: { owner: 'test' },
      on_request: ({ request, runDefault }) => {
        requests.push(request)
        expect(Object.isFrozen(request)).toBe(true)
        expect(Object.isFrozen(request.targets)).toBe(true)
        runDefault()
      },
    })
    let api: ReturnType<typeof useHoverPopovers<string>> | null = null
    render(
      <HoverPopoverProvider<string>
        dismiss_controller={controller}
        renderPopover={(popover) => <span>{popover.subject}</span>}
        options={{ openDelayMs: 0, fadeMs: 0 }}
      >
        <ApiObserver onValue={(value) => { api = value }} />
      </HoverPopoverProvider>,
    )
    const origin = document.createElement('button')
    document.body.appendChild(origin)
    const lease = (id: string): SnlActivationLease => ({
      activation_id: Number(id),
      request_deactivate: () => { order.push(id); return true },
    })
    act(() => {
      const root = api!.spawn('root', origin, 1, 1, null, { activation: lease('1') })
      const child = api!.spawn('child', origin, 2, 2, root, { activation: lease('2') })
      api!.spawn('grandchild', origin, 3, 3, child, { activation: lease('3') })
    })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ reason: 'escape', scope: { kind: 'all' }, cancelable: true })
    expect(order).toEqual(['3', '2', '1'])
    expect(document.querySelectorAll('[data-popover-id]')).toHaveLength(0)
    origin.remove()
  })

  it('supports controlled veto and descendant/subtree explicit scopes', () => {
    const requests: Array<{ reason: string; scope: { kind: string }; targets: readonly { id: string }[] }> = []
    let accept = false
    const controller = new HoverPopoverDismissController({
      params: null,
      on_request: ({ request, runDefault }) => {
        requests.push(request)
        if (accept) runDefault()
      },
    })
    let api: ReturnType<typeof useHoverPopovers<string>> | null = null
    render(<HoverPopoverProvider<string> dismiss_controller={controller} renderPopover={(p) => <span>{p.subject}</span>} options={{ openDelayMs: 0, fadeMs: 0 }}><ApiObserver onValue={(value) => { api = value }} /></HoverPopoverProvider>)
    const origin = document.createElement('button')
    document.body.appendChild(origin)
    let root = ''; let child = ''
    act(() => {
      root = api!.spawn('root', origin, 1, 1, null)
      child = api!.spawn('child', origin, 2, 2, root)
      api!.spawn('grandchild', origin, 3, 3, child)
    })
    act(() => api!.dismissDescendants(child))
    expect(requests.at(-1)).toMatchObject({ reason: 'explicit-api', scope: { kind: 'descendants' } })
    expect(screen.getByText('grandchild')).toBeTruthy()
    accept = true
    act(() => api!.dismissSubtree(child))
    expect(requests.at(-1)).toMatchObject({ reason: 'explicit-api', scope: { kind: 'subtree' } })
    expect(screen.getByText('root')).toBeTruthy()
    expect(screen.queryByText('child')).toBeNull()
    expect(screen.queryByText('grandchild')).toBeNull()
    const requestCount = requests.length
    act(() => api!.dismissSubtree(child))
    expect(requests).toHaveLength(requestCount)
    origin.remove()
  })

  it('dispatches one non-overlapping pointer-exit request for a nested unfrozen tree', () => {
    const requests: HoverPopoverDismissRequest<string>[] = []
    const controller = new HoverPopoverDismissController<null, string>({
      params: null,
      on_request: ({ request, runDefault }) => { requests.push(request); runDefault() },
    })
    let api: ReturnType<typeof useHoverPopovers<string>> | null = null
    render(<HoverPopoverProvider<string> dismiss_controller={controller} renderPopover={(p) => <span>{p.subject}</span>} options={{ openDelayMs: 0, fadeMs: 0 }}><ApiObserver onValue={(value) => { api = value }} /></HoverPopoverProvider>)
    const origin = document.createElement('button')
    document.body.appendChild(origin)
    act(() => {
      const root = api!.spawn('root', origin, 1, 1, null)
      api!.spawn('child', origin, 2, 2, root)
    })
    fireEvent.pointerMove(document, { clientX: 900, clientY: 700 })
    expect(requests).toHaveLength(1)
    expect(requests[0].reason).toBe('pointer-exit')
    expect(requests[0].targets.map((target) => target.subject)).toEqual(['child', 'root'])
    origin.remove()
  })

  it('makes accepted dismissal authoritative within the same call stack', () => {
    const requests: HoverPopoverDismissRequest<string>[] = []
    const deactivated = vi.fn(() => true)
    const controller = new HoverPopoverDismissController<null, string>({
      params: null,
      on_request: ({ request, runDefault }) => { requests.push(request); runDefault() },
    })
    let api: ReturnType<typeof useHoverPopovers<string>> | null = null
    render(<HoverPopoverProvider<string> dismiss_controller={controller} renderPopover={(p) => <span>{p.subject}</span>} options={{ openDelayMs: 0, fadeMs: 1000 }}><ApiObserver onValue={(value) => { api = value }} /></HoverPopoverProvider>)
    const origin = document.createElement('button')
    document.body.appendChild(origin)
    let id = ''
    act(() => { id = api!.spawn('root', origin, 1, 1, null, { activation: { activation_id: 1, request_deactivate: deactivated } }) })
    act(() => {
      api!.dismissSubtree(id)
      api!.dismissSubtree(id)
    })
    expect(requests).toHaveLength(1)
    expect(deactivated).toHaveBeenCalledOnce()
    expect(document.querySelector(`[data-popover-id="${id}"]`)?.getAttribute('data-phase')).toBe('closing')
    origin.remove()
  })

  it('reserves accepted targets before a deactivation lease can reenter dismissal', () => {
    const requests: HoverPopoverDismissRequest<string>[] = []
    let api: ReturnType<typeof useHoverPopovers<string>> | null = null
    let id = ''
    let deactivations = 0
    const controller = new HoverPopoverDismissController<null, string>({
      params: null,
      on_request: ({ request, runDefault }) => { requests.push(request); runDefault() },
    })
    render(<HoverPopoverProvider<string> dismiss_controller={controller} renderPopover={(p) => <span>{p.subject}</span>} options={{ openDelayMs: 0, fadeMs: 1000 }}><ApiObserver onValue={(value) => { api = value }} /></HoverPopoverProvider>)
    const origin = document.createElement('button')
    document.body.appendChild(origin)
    act(() => {
      id = api!.spawn('root', origin, 1, 1, null, { activation: {
        activation_id: 1,
        request_deactivate: () => {
          deactivations += 1
          if (deactivations === 1) api!.dismissSubtree(id)
          return true
        },
      } })
    })
    act(() => api!.dismissSubtree(id))
    expect(requests).toHaveLength(1)
    expect(deactivations).toBe(1)
    origin.remove()
  })

  it('uses a synchronously rebound activation lease when immediately dismissed', () => {
    const oldLease = vi.fn(() => true)
    const newLease = vi.fn(() => true)
    let api: ReturnType<typeof useHoverPopovers<string>> | null = null
    render(<HoverPopoverProvider<string> renderPopover={(p) => <span>{p.subject}</span>} options={{ openDelayMs: 0, fadeMs: 0 }}><ApiObserver onValue={(value) => { api = value }} /></HoverPopoverProvider>)
    const origin = document.createElement('button')
    document.body.appendChild(origin)
    let id = ''
    act(() => { id = api!.spawn('root', origin, 1, 1, null, { activation: { activation_id: 1, request_deactivate: oldLease } }) })
    act(() => {
      expect(api!.preview('root', origin, 2, 2, null, { activation: { activation_id: 2, request_deactivate: newLease } })).toBe(id)
      api!.dismissSubtree(id)
    })
    expect(oldLease).not.toHaveBeenCalled()
    expect(newLease).toHaveBeenCalledOnce()
    origin.remove()
  })

  it('flushes pending and live removal notifications before a teardown callback can reenter', () => {
    const requests: HoverPopoverDismissRequest<string>[] = []
    const removed: string[] = []
    const deactivated = vi.fn(() => true)
    let api: ReturnType<typeof useHoverPopovers<string>> | null = null
    let reentered = false
    let ghostId = ''
    const controller = new HoverPopoverDismissController<null, string>({
      params: null,
      on_request: ({ request, runDefault }) => { requests.push(request); runDefault() },
      on_removed: (targets) => {
        removed.push(...targets.map((target) => target.subject))
        if (!reentered) {
          reentered = true
          api!.dismissAll()
          ghostId = api!.spawn('ghost', document.body, 0, 0, null)
        }
      },
    })
    const view = render(<HoverPopoverProvider<string> dismiss_controller={controller} renderPopover={(p) => <span>{p.subject}</span>} options={{ openDelayMs: 0, fadeMs: 1000 }}><ApiObserver onValue={(value) => { api = value }} /></HoverPopoverProvider>)
    const origin = document.createElement('button')
    document.body.appendChild(origin)
    let pending = ''
    act(() => {
      pending = api!.spawn('pending', origin, 1, 1, null, { activation: { activation_id: 1, request_deactivate: deactivated } })
      api!.spawn('live', origin, 2, 2, null, { activation: { activation_id: 2, request_deactivate: deactivated } })
    })
    act(() => api!.dismissSubtree(pending))
    expect(deactivated).toHaveBeenCalledOnce()
    view.unmount()
    expect(requests).toHaveLength(1)
    expect(deactivated).toHaveBeenCalledOnce()
    expect(removed.sort()).toEqual(['live', 'pending'])
    expect(api!.isAlive(ghostId)).toBe(false)
    origin.remove()
  })

  it('re-arms the provider before descendant layout effects replay in StrictMode', () => {
    const observed: Array<{ id: string; alive: boolean }> = []

    function Harness() {
      const api = useHoverPopovers<string>()
      useLayoutEffect(() => {
        const id = api.spawn('layout', document.body, 0, 0, null)
        observed.push({ id, alive: api.isAlive(id) })
      }, [api])
      return null
    }

    render(
      <StrictMode>
        <HoverPopoverProvider<string>
          renderPopover={(popover) => <span>{popover.subject}</span>}
          options={{ openDelayMs: 0, fadeMs: 0 }}
        >
          <Harness />
        </HoverPopoverProvider>
      </StrictMode>,
    )

    expect(observed).toHaveLength(2)
    expect(observed.every(({ alive }) => alive)).toBe(true)
    expect(screen.getAllByText('layout')).toHaveLength(1)
  })

  it('forces non-cancelable owner-unmount but does not dispatch on provider teardown', () => {
    const requests: Array<{ reason: string; cancelable: boolean }> = []
    const controller = new HoverPopoverDismissController({
      params: null,
      on_request: ({ request }) => { requests.push(request) },
    })
    let api: ReturnType<typeof useHoverPopovers<string>> | null = null
    const view = render(<HoverPopoverProvider<string> dismiss_controller={controller} renderPopover={() => <span>preview</span>} options={{ openDelayMs: 0, fadeMs: 0 }}><ApiObserver onValue={(value) => { api = value }} /></HoverPopoverProvider>)
    const origin = document.createElement('button')
    document.body.appendChild(origin)
    let id = ''
    act(() => { id = api!.spawn('root', origin, 1, 1, null) })
    act(() => api!.cancelUnfrozen(id, 'owner-unmount'))
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ reason: 'owner-unmount', cancelable: false })
    expect(screen.queryByText('preview')).toBeNull()
    act(() => { api!.spawn('next', origin, 1, 1, null) })
    view.unmount()
    expect(requests).toHaveLength(1)
    origin.remove()
  })

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

  it('promotes a descriptor preview in place across native pointerdown and click', () => {
    const snapshots: HoverPopover<string>[] = []
    render(
      <HoverPopoverProvider<string>
        renderPopover={(popover) => { snapshots.push(popover); return <span>descriptor preview</span> }}
        options={{ openDelayMs: 0, fadeMs: 0 }}
      >
        <DescriptorPreviewPinHarness />
      </HoverPopoverProvider>,
    )
    const origin = screen.getByTestId('descriptor-origin-entry-a')
    vi.spyOn(origin, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 100, 40))
    fireEvent.pointerMove(origin, { clientX: 24, clientY: 36 })
    const preview = snapshots.at(-1)!
    expect(preview.frozen).toBe(false)

    fireEvent.pointerDown(origin, { clientX: 24, clientY: 36 })
    expect(document.querySelector(`[data-popover-id="${preview.id}"]`)).not.toBeNull()
    fireEvent.pointerUp(origin, { clientX: 24, clientY: 36 })
    fireEvent.click(origin, { clientX: 24, clientY: 36 })

    const pinned = snapshots.at(-1)!
    expect(document.querySelectorAll('[data-popover-id]')).toHaveLength(1)
    expect(pinned.id).toBe(preview.id)
    expect(pinned.originElement).toBe(origin)
    expect(pinned.originRect).toBe(preview.originRect)
    expect(pinned.frozen).toBe(true)
  })

  it('preserves settled placement when pinning a fresh equivalent descriptor', () => {
    vi.useFakeTimers()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 })
    let api: ReturnType<typeof useHoverPopovers<string>> | null = null
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-popover-id')) {
        const settled = this.querySelector('[data-settled="true"]') !== null
        return new DOMRect(0, 0, settled ? 224 : 304, 120)
      }
      return new DOMRect(64, 180, 24, 20)
    })
    render(
      <HoverPopoverProvider<string>
        renderPopover={() => <SettlingPopover />}
        options={{ openDelayMs: 0, fadeMs: 0, offset: 12, viewportMargin: 8 }}
      >
        <ApiObserver onValue={(value) => { api = value }} />
      </HoverPopoverProvider>,
    )
    const origin = document.createElement('button')
    document.body.appendChild(origin)
    let id = ''
    act(() => { id = api!.preview('entry-a', { element: origin, bounds: 'viewport' }, 76, 200, null) })
    const frame = document.querySelector(`[data-popover-id="${id}"]`) as HTMLElement
    expect(frame.style.left).toBe('8px')

    act(() => vi.runOnlyPendingTimers())
    expect(screen.getByText('settled')).toBeTruthy()
    expect(frame.style.left).toBe('8px')

    act(() => {
      expect(api!.pin('entry-a', { element: origin, bounds: 'viewport' }, 76, 200, null)).toBe(id)
    })
    const frozen = frame.dataset.frozen
    const pinnedLeft = frame.style.left
    rectSpy.mockRestore()
    origin.remove()
    expect(frozen).toBe('true')
    expect(pinnedLeft).toBe('8px')
  })

  it('promotes a nested descriptor preview in place and preserves its parent', () => {
    let api: ReturnType<typeof useHoverPopovers<string>> | null = null
    const snapshots = new Map<string, HoverPopover<string>>()
    render(
      <HoverPopoverProvider<string>
        renderPopover={(popover) => { snapshots.set(popover.subject, popover); return <span>{popover.subject}</span> }}
        options={{ openDelayMs: 0, fadeMs: 0 }}
      >
        <ApiObserver onValue={(value) => { api = value }} />
      </HoverPopoverProvider>,
    )
    const rootOrigin = document.createElement('button')
    const childOrigin = document.createElement('button')
    vi.spyOn(rootOrigin, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 80, 20))
    vi.spyOn(childOrigin, 'getBoundingClientRect').mockReturnValue(new DOMRect(120, 50, 60, 20))
    document.body.append(rootOrigin, childOrigin)
    let rootId = ''; let childId = ''
    act(() => {
      rootId = api!.preview('root descriptor', { element: rootOrigin, bounds: 'viewport' }, 20, 20, null)
      childId = api!.preview('child descriptor', { element: childOrigin, bounds: 'viewport' }, 130, 60, rootId)
    })

    fireEvent.pointerDown(childOrigin, { clientX: 130, clientY: 60 })
    expect(api!.isAlive(rootId)).toBe(true)
    expect(api!.isAlive(childId)).toBe(true)
    act(() => {
      expect(api!.pin('child descriptor', { element: childOrigin, bounds: 'viewport' }, 130, 60, rootId)).toBe(childId)
    })
    expect(snapshots.get('child descriptor')).toMatchObject({ id: childId, parentId: rootId, frozen: true })
    expect(document.querySelectorAll('[data-popover-id]')).toHaveLength(2)
    rootOrigin.remove(); childOrigin.remove()
  })

  it('replaces an unrelated pinned root when a distinct root preview is activated', () => {
    let api: ReturnType<typeof useHoverPopovers<string>> | null = null
    const snapshots = new Map<string, HoverPopover<string>>()
    render(
      <StrictMode>
        <HoverPopoverProvider<string>
          renderPopover={(popover) => { snapshots.set(popover.subject, popover); return <span>{popover.subject}</span> }}
          options={{ openDelayMs: 0, fadeMs: 0 }}
        >
          <ApiObserver onValue={(value) => { api = value }} />
        </HoverPopoverProvider>
      </StrictMode>,
    )
    const originA = document.createElement('button')
    const originB = document.createElement('button')
    document.body.append(originA, originB)
    act(() => { api!.pin('root A', { element: originA, bounds: 'viewport' }, 20, 20, null) })
    let previewB = ''
    act(() => { previewB = api!.preview('root B', { element: originB, bounds: 'viewport' }, 120, 20, null) })

    fireEvent.pointerDown(originB, { clientX: 120, clientY: 20 })
    fireEvent.pointerUp(originB, { clientX: 120, clientY: 20 })
    act(() => { expect(api!.pin('root B', { element: originB, bounds: 'viewport' }, 120, 20, null)).toBe(previewB) })

    expect(snapshots.get('root B')).toMatchObject({ id: previewB, parentId: null, frozen: true })
    expect(screen.queryByText('root A')).toBeNull()
    expect(document.querySelectorAll('[data-popover-id]')).toHaveLength(1)
    originA.remove(); originB.remove()
  })

  it('preserves a nested parent while replacing the activated child sibling subtree', () => {
    let api: ReturnType<typeof useHoverPopovers<string>> | null = null
    render(
      <StrictMode>
        <HoverPopoverProvider<string>
          renderPopover={(popover) => <span>{popover.subject}</span>}
          options={{ openDelayMs: 0, fadeMs: 0 }}
        >
          <ApiObserver onValue={(value) => { api = value }} />
        </HoverPopoverProvider>
      </StrictMode>,
    )
    const rootOrigin = document.createElement('button')
    const childAOrigin = document.createElement('button')
    const childBOrigin = document.createElement('button')
    document.body.append(rootOrigin, childAOrigin, childBOrigin)
    let rootId = ''
    act(() => { rootId = api!.pin('root', { element: rootOrigin, bounds: 'viewport' }, 20, 20, null) })
    act(() => { api!.pin('child A', { element: childAOrigin, bounds: 'viewport' }, 40, 40, rootId) })
    let childBId = ''
    act(() => { childBId = api!.preview('child B', { element: childBOrigin, bounds: 'viewport' }, 80, 40, rootId) })

    fireEvent.pointerDown(childBOrigin, { clientX: 80, clientY: 40 })
    fireEvent.pointerUp(childBOrigin, { clientX: 80, clientY: 40 })
    act(() => { expect(api!.pin('child B', { element: childBOrigin, bounds: 'viewport' }, 80, 40, rootId)).toBe(childBId) })

    expect(api!.isAlive(rootId)).toBe(true)
    expect(screen.getByText('root')).toBeTruthy()
    expect(screen.queryByText('child A')).toBeNull()
    expect(screen.getByText('child B').parentElement?.getAttribute('data-frozen')).toBe('true')
    expect(document.querySelectorAll('[data-popover-id]')).toHaveLength(2)
    rootOrigin.remove(); childAOrigin.remove(); childBOrigin.remove()
  })

  it('keeps a nested descriptor preview when its origin is clicked inside the parent frame', () => {
    const snapshots = new Map<string, HoverPopover<string>>()
    render(
      <HoverPopoverProvider<string>
        renderPopover={(popover) => {
          snapshots.set(popover.subject, popover)
          return popover.subject === 'root'
            ? <DescriptorPreviewPinHarness subject="child" parentId={popover.id} />
            : <span>{popover.subject}</span>
        }}
        options={{ openDelayMs: 0, fadeMs: 0 }}
      >
        <DescriptorPreviewPinHarness subject="root" />
      </HoverPopoverProvider>,
    )
    const rootOrigin = screen.getByTestId('descriptor-origin-root')
    vi.spyOn(rootOrigin, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 80, 30))
    fireEvent.pointerMove(rootOrigin, { clientX: 20, clientY: 20 })
    fireEvent.click(rootOrigin, { clientX: 20, clientY: 20 })
    const rootId = snapshots.get('root')!.id
    const childOrigin = screen.getByTestId('descriptor-origin-child')
    vi.spyOn(childOrigin, 'getBoundingClientRect').mockReturnValue(new DOMRect(30, 40, 80, 30))
    fireEvent.pointerMove(childOrigin, { clientX: 40, clientY: 50 })
    const childId = snapshots.get('child')!.id

    fireEvent.pointerDown(childOrigin, { clientX: 40, clientY: 50 })
    fireEvent.pointerUp(childOrigin, { clientX: 40, clientY: 50 })
    fireEvent.click(childOrigin, { clientX: 40, clientY: 50 })

    expect(snapshots.get('root')).toMatchObject({ id: rootId, frozen: true })
    expect(snapshots.get('child')).toMatchObject({ id: childId, parentId: rootId, frozen: true })
    expect(document.querySelectorAll('[data-popover-id]')).toHaveLength(2)
  })

  it('keeps legacy bounds policies while a viewport descriptor controls click-only placement', () => {
    const resolveBounds = vi.fn(() => ({ left: 0, top: 0, right: 320, bottom: 240 }))
    let api: ReturnType<typeof useHoverPopovers<string>> | null = null
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    render(
      <HoverPopoverProvider<string>
        resolveBounds={resolveBounds}
        renderPopover={(popover) => <span>{popover.subject}</span>}
        options={{ openDelayMs: 0, fadeMs: 0, offset: 12, viewportMargin: 8 }}
      >
        <ApiObserver onValue={(value) => { api = value }} />
      </HoverPopoverProvider>,
    )
    const element = document.createElement('button')
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(480, 100, 40, 20))
    document.body.appendChild(element)

    act(() => { api!.pin('descriptor', { element, bounds: 'viewport' }, 500, 120, null) })
    expect(resolveBounds).not.toHaveBeenCalled()
    expect((screen.getByText('descriptor').parentElement as HTMLElement).style.left).toBe('512px')
    act(() => api!.dismissAll())

    act(() => { api!.pin('element', element, 500, 120, null) })
    expect(resolveBounds).toHaveBeenCalledWith(element)
    expect((screen.getByText('element').parentElement as HTMLElement).style.left).toBe('312px')
    act(() => api!.dismissAll())

    const detachedRect = new DOMRect(480, 100, 40, 20)
    resolveBounds.mockClear()
    act(() => { api!.pin('rect', detachedRect, 500, 120, null) })
    expect(resolveBounds).not.toHaveBeenCalled()
    expect((screen.getByText('rect').parentElement as HTMLElement).style.left).toBe('512px')
    element.remove()
  })

  it('refreshes reused descriptor geometry and viewport-to-nearest bounds policy in place', () => {
    const snapshots: HoverPopover<string>[] = []
    const resolveBounds = vi.fn(() => ({ left: 0, top: 0, right: 260, bottom: 180 }))
    let api: ReturnType<typeof useHoverPopovers<string>> | null = null
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    render(
      <StrictMode>
        <HoverPopoverProvider<string>
          resolveBounds={resolveBounds}
          renderPopover={(popover) => { snapshots.push(popover); return <span>reused descriptor</span> }}
          options={{ openDelayMs: 0, fadeMs: 0, offset: 0, viewportMargin: 0 }}
        >
          <ApiObserver onValue={(value) => { api = value }} />
        </HoverPopoverProvider>
      </StrictMode>,
    )
    const element = document.createElement('button')
    document.body.appendChild(element)
    const firstRect = new DOMRect(480, 100, 40, 20)
    const nextRect = new DOMRect(500, 120, 40, 20)
    let id = ''
    act(() => { id = api!.preview('reused', { element, rect: firstRect, bounds: 'viewport' }, 500, 120, null) })
    const firstLeft = (screen.getByText('reused descriptor').parentElement as HTMLElement).style.left
    expect(resolveBounds).not.toHaveBeenCalled()

    act(() => {
      expect(api!.pin('reused', { element, rect: nextRect, bounds: 'nearest-scroll-container' }, 520, 140, null)).toBe(id)
    })

    expect(snapshots.at(-1)).toMatchObject({ id, frozen: true })
    expect(snapshots.at(-1)!.originRect).toBe(nextRect)
    expect(resolveBounds).toHaveBeenCalledWith(element)
    expect((screen.getByText('reused descriptor').parentElement as HTMLElement).style.left).not.toBe(firstLeft)
    element.remove()
  })

  it('remeasures a live reused descriptor without an explicit rect while keeping its identity', () => {
    const snapshots: HoverPopover<string>[] = []
    let api: ReturnType<typeof useHoverPopovers<string>> | null = null
    render(
      <StrictMode>
        <HoverPopoverProvider<string>
          renderPopover={(popover) => { snapshots.push(popover); return <span>live reused descriptor</span> }}
          options={{ openDelayMs: 0, fadeMs: 0, offset: 0 }}
        >
          <ApiObserver onValue={(value) => { api = value }} />
        </HoverPopoverProvider>
      </StrictMode>,
    )
    const element = document.createElement('button')
    let rect = new DOMRect(10, 20, 40, 20)
    vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => rect)
    document.body.appendChild(element)
    let id = ''
    act(() => { id = api!.preview('live reused', { element, bounds: 'viewport' }, 20, 30, null) })
    rect = new DOMRect(110, 120, 40, 20)

    act(() => {
      expect(api!.preview('live reused', { element, bounds: 'viewport' }, 120, 130, null)).toBe(id)
    })

    expect(snapshots.at(-1)).toMatchObject({ id })
    expect(snapshots.at(-1)!.originRect.left).toBe(110)
    expect(snapshots.at(-1)!.originRect.top).toBe(120)
    expect((screen.getByText('live reused descriptor').parentElement as HTMLElement).style.left).toBe('120px')
    element.remove()
  })

  it('remeasures a descriptor element on scroll without changing its bounds policy', () => {
    const snapshots: HoverPopover<string>[] = []
    const resolveBounds = vi.fn(() => ({ left: 0, top: 0, right: 300, bottom: 200 }))
    let api: ReturnType<typeof useHoverPopovers<string>> | null = null
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    render(
      <HoverPopoverProvider<string>
        resolveBounds={resolveBounds}
        renderPopover={(popover) => { snapshots.push(popover); return <span>moving</span> }}
        options={{ openDelayMs: 0, fadeMs: 0, offset: 0 }}
      >
        <ApiObserver onValue={(value) => { api = value }} />
      </HoverPopoverProvider>,
    )
    const element = document.createElement('button')
    let rect = new DOMRect(10, 20, 40, 20)
    vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => rect)
    document.body.appendChild(element)
    act(() => { api!.pin('moving', { element, rect, bounds: 'viewport' }, 20, 30, null) })
    expect((screen.getByText('moving').parentElement as HTMLElement).style.left).toBe('20px')

    rect = new DOMRect(110, 120, 40, 20)
    act(() => { document.dispatchEvent(new Event('scroll')) })
    expect(snapshots.at(-1)!.originRect.left).toBe(110)
    expect((screen.getByText('moving').parentElement as HTMLElement).style.left).toBe('120px')
    expect(resolveBounds).not.toHaveBeenCalled()
    element.remove()
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

  it('keeps the old sibling and still creates the new pin when sibling dismissal is vetoed', () => {
    const reasons: string[] = []
    const controller = new HoverPopoverDismissController({
      params: null,
      on_request: ({ request }) => { reasons.push(request.reason) },
    })
    render(<HoverPopoverProvider<string> dismiss_controller={controller} renderPopover={(popover) => <div>origin:{popover.originElement?.id}</div>} options={{ openDelayMs: 0, fadeMs: 0 }}><SwitchPinHarness /></HoverPopoverProvider>)
    fireEvent.click(screen.getByText('pin first'))
    fireEvent.click(screen.getByText('pin second'))
    expect(reasons).toEqual(['sibling-replaced'])
    expect(screen.getByText('origin:first-origin')).toBeTruthy()
    expect(screen.getByText('origin:second-origin')).toBeTruthy()
    expect(document.querySelectorAll('[data-popover-id]')).toHaveLength(2)
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
