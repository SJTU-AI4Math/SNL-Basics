// @vitest-environment jsdom
import { StrictMode, useEffect, useLayoutEffect } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ForeignBoxHost } from './foreign-box-host'
import { assertForeignBoxMetrics, foreignBoxIdentityKey, type ForeignBoxIdentity } from './foreign-box'
import { useForeignBox, type UseForeignBoxResult } from './use-foreign-box'

interface RectInit { left: number; top: number; width: number; height: number }
const rect = ({ left, top, width, height }: RectInit): DOMRect => ({
  left, top, width, height, right: left + width, bottom: top + height,
  x: left, y: top, toJSON: () => ({}),
} as DOMRect)

class TrackingResizeObserver {
  static instances: TrackingResizeObserver[] = []
  readonly targets = new Set<Element>()
  readonly unobserved: Element[] = []
  disconnected = false
  readonly callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    TrackingResizeObserver.instances.push(this)
  }
  observe = (target: Element) => { this.targets.add(target) }
  unobserve = (target: Element) => { this.targets.delete(target); this.unobserved.push(target) }
  disconnect = () => { this.disconnected = true; this.targets.clear() }
  fire(target: Element, width = 30, height = 12) {
    this.callback([{ target, contentRect: rect({ left: 0, top: 0, width, height }) } as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
}

let rafCallbacks: Map<number, FrameRequestCallback>
let nextRaf: number
let cancelledRafs: number[]
let listenerAdds: Array<[EventTarget, string]>
let listenerRemoves: Array<[EventTarget, string]>

beforeEach(() => {
  TrackingResizeObserver.instances = []
  vi.stubGlobal('ResizeObserver', TrackingResizeObserver)
  rafCallbacks = new Map(); nextRaf = 1; cancelledRafs = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextRaf++; rafCallbacks.set(id, callback); return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { cancelledRafs.push(id); rafCallbacks.delete(id) })
  listenerAdds = []; listenerRemoves = []
  const add = EventTarget.prototype.addEventListener
  const remove = EventTarget.prototype.removeEventListener
  vi.spyOn(EventTarget.prototype, 'addEventListener').mockImplementation(function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    listenerAdds.push([this, type]); return add.call(this, type, listener, options)
  })
  vi.spyOn(EventTarget.prototype, 'removeEventListener').mockImplementation(function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
    listenerRemoves.push([this, type]); return remove.call(this, type, listener, options)
  })
})

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function flushRaf(): void {
  const pending = [...rafCallbacks.entries()]
  rafCallbacks.clear()
  for (const [, callback] of pending) callback(0)
}

const identity = (treePath = '0.1', generation = 1, producer = 'renderer:block@r1'): ForeignBoxIdentity => ({
  treePath, generation, producer,
})

function Slot({ id = identity(), label = 'foreign', apiRef, markerKey = 'a', onMetrics, onUnregister }: {
  id?: ForeignBoxIdentity
  label?: string
  apiRef?: { current: UseForeignBoxResult | null }
  markerKey?: string
  onMetrics?: (metrics: { width: number; height: number; depth: number; baseline: 'alphabetic' | 'axis-center' | 'bottom' }) => void
  onUnregister?: () => void
}) {
  const api = useForeignBox({ identity: id, child: <button data-testid="foreign-child">{label}</button>, onMetrics, onUnregister })
  if (apiRef) apiRef.current = api
  return <span key={markerKey} ref={api.markerRef} data-testid="marker" />
}

function EffectSlot({ kind, calls }: { kind: 'layout' | 'passive'; calls: UseForeignBoxResult[] }) {
  const api = useForeignBox({ identity: identity(`strict-${kind}`), child: <span data-testid={`strict-${kind}`}>{kind}</span> })
  const effect = kind === 'layout' ? useLayoutEffect : useEffect
  effect(() => { calls.push(api) }, [api])
  return <span ref={api.markerRef} />
}

describe('ForeignBox contracts', () => {
  it('validates finite nonnegative metrics and complete stable identity', () => {
    expect(assertForeignBoxMetrics({ width: 10, height: 4, depth: 1, baseline: 'alphabetic' })).toEqual({ width: 10, height: 4, depth: 1, baseline: 'alphabetic' })
    for (const value of [NaN, Infinity, -1]) {
      expect(() => assertForeignBoxMetrics({ width: value, height: 1, depth: 0, baseline: 'bottom' })).toThrow()
    }
    expect(foreignBoxIdentityKey(identity('0/1', 4, 'asset:a@rev7'))).not.toBe(foreignBoxIdentityKey(identity('0/1', 3, 'asset:a@rev7')))
    expect(foreignBoxIdentityKey(identity('0/1', 4, 'asset:a@rev7'))).not.toBe(foreignBoxIdentityKey(identity('0/1', 4, 'asset:a@rev8')))
  })
})

describe('ForeignBoxHost lifecycle', () => {
  it('keeps one child DOM node while staging, measuring, and positioning', () => {
    const apiRef = { current: null as UseForeignBoxResult | null }
    const view = render(<ForeignBoxHost><Slot apiRef={apiRef} /></ForeignBoxHost>)
    const child = view.getByTestId('foreign-child')
    const wrapper = child.parentElement as HTMLElement
    const marker = view.getByTestId('marker')
    const host = view.container.querySelector('[data-snl-foreign-box-host]') as HTMLElement
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(rect({ left: 10, top: 20, width: 300, height: 200 }))
    vi.spyOn(marker, 'getBoundingClientRect').mockReturnValue(rect({ left: 42, top: 70, width: 20, height: 10 }))
    Object.defineProperties(host, { scrollLeft: { value: 3, configurable: true }, scrollTop: { value: 5, configurable: true } })

    expect(wrapper.dataset.state).toBe('staging')
    act(() => apiRef.current!.reportMetrics({ width: 30, height: 12, depth: 2, baseline: 'alphabetic' }))
    expect(rafCallbacks.size).toBe(1)
    act(flushRaf)

    expect(view.getByTestId('foreign-child')).toBe(child)
    expect(wrapper.dataset.state).toBe('positioned')
    expect(wrapper.style.transform).toBe('translate(35px, 55px)')
    expect(wrapper.style.width).toBe('30px')
    expect(wrapper.style.height).toBe('14px')
    expect(TrackingResizeObserver.instances).toHaveLength(1)
  })

  it('rejects stale generation and producer callbacks', () => {
    const oldRef = { current: null as UseForeignBoxResult | null }
    const metrics = vi.fn()
    const view = render(<ForeignBoxHost><Slot id={identity('same', 1, 'producer@1')} apiRef={oldRef} onMetrics={metrics} /></ForeignBoxHost>)
    const retained = oldRef.current!
    view.rerender(<ForeignBoxHost><Slot id={identity('same', 2, 'producer@2')} apiRef={oldRef} onMetrics={metrics} /></ForeignBoxHost>)
    act(() => retained.reportMetrics({ width: 99, height: 99, depth: 0, baseline: 'bottom' }))
    expect(metrics).not.toHaveBeenCalled()
    expect(rafCallbacks.size).toBeLessThanOrEqual(1)
  })

  it('uses one observer and one RAF for sibling updates', () => {
    const a = { current: null as UseForeignBoxResult | null }
    const b = { current: null as UseForeignBoxResult | null }
    const view = render(<ForeignBoxHost><Slot id={identity('a')} apiRef={a} /><Slot id={identity('b')} apiRef={b} /></ForeignBoxHost>)
    act(() => {
      a.current!.reportMetrics({ width: 10, height: 5, depth: 0, baseline: 'bottom' })
      b.current!.reportMetrics({ width: 20, height: 6, depth: 1, baseline: 'alphabetic' })
    })
    expect(TrackingResizeObserver.instances).toHaveLength(1)
    expect(rafCallbacks.size).toBe(1)
    act(flushRaf)
    expect(view.getAllByTestId('foreign-child').map(node => node.parentElement?.style.width)).toEqual(['10px', '20px'])
  })

  it('unobserves a replaced marker and positions from only the live marker', () => {
    const apiRef = { current: null as UseForeignBoxResult | null }
    const view = render(<ForeignBoxHost><Slot apiRef={apiRef} markerKey="old" /></ForeignBoxHost>)
    const oldMarker = view.getByTestId('marker')
    view.rerender(<ForeignBoxHost><Slot apiRef={apiRef} markerKey="new" /></ForeignBoxHost>)
    const newMarker = view.getByTestId('marker')
    expect(newMarker).not.toBe(oldMarker)
    expect(TrackingResizeObserver.instances[0].unobserved).toContain(oldMarker)
    expect(TrackingResizeObserver.instances[0].targets.has(oldMarker)).toBe(false)
    expect(TrackingResizeObserver.instances[0].targets.has(newMarker)).toBe(true)
  })

  it('drops detached marker targets during the centralized geometry batch', () => {
    const apiRef = { current: null as UseForeignBoxResult | null }
    const view = render(<ForeignBoxHost><Slot apiRef={apiRef} /></ForeignBoxHost>)
    const marker = view.getByTestId('marker')
    act(() => {
      marker.remove()
      window.dispatchEvent(new Event('scroll'))
      flushRaf()
    })
    expect(TrackingResizeObserver.instances[0].unobserved).toContain(marker)
    expect(TrackingResizeObserver.instances[0].targets.has(marker)).toBe(false)
  })

  it('unregisters a removed slot and releases its observed targets', () => {
    const apiRef = { current: null as UseForeignBoxResult | null }
    const unregister = vi.fn()
    const view = render(<ForeignBoxHost><Slot apiRef={apiRef} onUnregister={unregister} /></ForeignBoxHost>)
    const marker = view.getByTestId('marker')
    const wrapper = view.getByTestId('foreign-child').parentElement!
    expect(TrackingResizeObserver.instances[0].targets.has(wrapper)).toBe(true)
    view.rerender(<ForeignBoxHost />)
    expect(unregister).toHaveBeenCalledTimes(1)
    expect(apiRef.current!.isAlive()).toBe(false)
    expect(view.queryByTestId('foreign-child')).toBeNull()
    expect(TrackingResizeObserver.instances[0].unobserved).toEqual(expect.arrayContaining([marker, wrapper]))
  })

  it('rearms descendant layout and passive registrations through StrictMode replay', () => {
    const layout: UseForeignBoxResult[] = []; const passive: UseForeignBoxResult[] = []
    const view = render(<StrictMode><ForeignBoxHost><EffectSlot kind="layout" calls={layout} /><EffectSlot kind="passive" calls={passive} /></ForeignBoxHost></StrictMode>)
    expect(layout.length).toBeGreaterThanOrEqual(2)
    expect(passive.length).toBeGreaterThanOrEqual(2)
    expect(layout.at(-1)!.isAlive()).toBe(true)
    expect(passive.at(-1)!.isAlive()).toBe(true)
    expect(view.getAllByTestId('strict-layout')).toHaveLength(1)
    expect(view.getAllByTestId('strict-passive')).toHaveLength(1)
  })

  it('fails closed for retained APIs and observer/RAF callbacks after real unmount', async () => {
    const apiRef = { current: null as UseForeignBoxResult | null }
    const unregister = vi.fn()
    const view = render(<ForeignBoxHost><Slot apiRef={apiRef} onUnregister={unregister} /></ForeignBoxHost>)
    const retainedApi = apiRef.current!
    const observer = TrackingResizeObserver.instances[0]
    const wrapper = view.getByTestId('foreign-child').parentElement!
    act(() => retainedApi.reportMetrics({ width: 4, height: 5, depth: 0, baseline: 'bottom' }))
    const retainedRaf = [...rafCallbacks.values()][0]
    view.unmount()
    await Promise.resolve()
    expect(observer.disconnected).toBe(true)
    expect(cancelledRafs).toHaveLength(1)
    expect(rafCallbacks.size).toBe(0)
    expect(unregister).toHaveBeenCalledTimes(1)
    const before = wrapper.getAttribute('style')
    act(() => {
      retainedApi.reportMetrics({ width: 90, height: 90, depth: 0, baseline: 'bottom' })
      retainedApi.markerRef(document.createElement('span'))
      observer.fire(wrapper, 90, 90)
      retainedRaf(0)
    })
    expect(retainedApi.isAlive()).toBe(false)
    expect(wrapper.getAttribute('style')).toBe(before)
    expect(rafCallbacks.size).toBe(0)
    expect(TrackingResizeObserver.instances).toHaveLength(1)
  })

  it('sets the teardown gate before external unregister callbacks can reenter', async () => {
    const apiRef = { current: null as UseForeignBoxResult | null }
    let aliveDuringCallback = true
    const view = render(<ForeignBoxHost><Slot apiRef={apiRef} onUnregister={() => {
      aliveDuringCallback = apiRef.current!.isAlive()
      apiRef.current!.reportMetrics({ width: 10, height: 10, depth: 0, baseline: 'bottom' })
      apiRef.current!.markerRef(document.createElement('span'))
    }} /></ForeignBoxHost>)
    view.unmount()
    await Promise.resolve()
    expect(aliveDuringCallback).toBe(false)
    expect(rafCallbacks.size).toBe(0)
  })

  it('centralizes and fully cleans scroll/resize/visualViewport seams', () => {
    const viewport = new EventTarget()
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true })
    expect(window.visualViewport).toBe(viewport)
    const windowAdd = vi.spyOn(window, 'addEventListener')
    const windowRemove = vi.spyOn(window, 'removeEventListener')
    const viewportAdd = vi.spyOn(viewport, 'addEventListener')
    const viewportRemove = vi.spyOn(viewport, 'removeEventListener')
    const view = render(<ForeignBoxHost><Slot id={identity('a')} /><Slot id={identity('b')} /></ForeignBoxHost>)
    expect(windowAdd).toHaveBeenCalledWith('scroll', expect.any(Function), true)
    expect(windowAdd).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(viewportAdd).toHaveBeenCalledWith('scroll', expect.any(Function))
    expect(viewportAdd).toHaveBeenCalledWith('resize', expect.any(Function))
    view.unmount()
    expect(windowRemove).toHaveBeenCalledWith('scroll', expect.any(Function), true)
    expect(windowRemove).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(viewportRemove).toHaveBeenCalledWith('scroll', expect.any(Function))
    expect(viewportRemove).toHaveBeenCalledWith('resize', expect.any(Function))
  })
})
