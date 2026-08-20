// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Component, StrictMode, Suspense, startTransition, useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ForeignBoxHost, useForeignBoxRegistry } from './foreign-box-host'
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
let listenerAdds: Array<[EventTarget, string, EventListenerOrEventListenerObject | null, boolean | AddEventListenerOptions | undefined]>
let listenerRemoves: Array<[EventTarget, string, EventListenerOrEventListenerObject | null, boolean | EventListenerOptions | undefined]>

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
    listenerAdds.push([this, type, listener, options]); return add.call(this, type, listener, options)
  })
  vi.spyOn(EventTarget.prototype, 'removeEventListener').mockImplementation(function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
    listenerRemoves.push([this, type, listener, options]); return remove.call(this, type, listener, options)
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

function Slot({ id = identity(), label = 'foreign', apiRef, markerKey = 'a', onMetrics, onUnregister, ssrFallback }: {
  id?: ForeignBoxIdentity
  label?: string
  apiRef?: { current: UseForeignBoxResult | null }
  markerKey?: string
  onMetrics?: (metrics: { width: number; height: number; depth: number; baseline: 'alphabetic' | 'axis-center' | 'bottom' }) => void
  onUnregister?: () => void
  ssrFallback?: React.ReactNode
}) {
  const api = useForeignBox({ identity: id, child: <button data-testid="foreign-child">{label}</button>, onMetrics, onUnregister, ssrFallback })
  if (apiRef) apiRef.current = api
  return <><span key={markerKey} ref={api.markerRef} data-testid="marker" />{ssrFallback === undefined ? null : api.ssrFallback}</>
}

function EffectSlot({ kind, calls }: { kind: 'layout' | 'passive'; calls: boolean[] }) {
  const api = useForeignBox({ identity: identity(`strict-${kind}`), child: <span data-testid={`strict-${kind}`}>{kind}</span> })
  const effect = kind === 'layout' ? useLayoutEffect : useEffect
  effect(() => { calls.push(api.isAlive()) }, [api])
  return <span ref={api.markerRef} />
}

function RegistryCapture({ setRegistry }: { setRegistry: (registry: ReturnType<typeof useForeignBoxRegistry>) => void }) {
  setRegistry(useForeignBoxRegistry())
  return null
}

describe('ForeignBox contracts', () => {
  it('validates finite nonnegative metrics and complete stable identity', () => {
    expect(assertForeignBoxMetrics({ width: 10, height: 4, depth: 1, baseline: 'alphabetic' })).toEqual({ width: 10, height: 4, depth: 1, baseline: 'alphabetic' })
    for (const value of [NaN, Infinity, -1]) {
      expect(() => assertForeignBoxMetrics({ width: value, height: 1, depth: 0, baseline: 'bottom' })).toThrow()
    }
    expect(foreignBoxIdentityKey(identity('', 0, 'root@r1'))).toBe('["",0,"root@r1"]')
    expect(foreignBoxIdentityKey(identity('0/1', 4, 'asset:a@rev7'))).not.toBe(foreignBoxIdentityKey(identity('0/1', 3, 'asset:a@rev7')))
    expect(foreignBoxIdentityKey(identity('0/1', 4, 'asset:a@rev7'))).not.toBe(foreignBoxIdentityKey(identity('0/1', 4, 'asset:a@rev8')))
  })

  it('reads public identity and metrics fields once and returns frozen primitive snapshots', () => {
    const reads = { treePath: 0, generation: 0, producer: 0, width: 0, height: 0, depth: 0, baseline: 0 }
    const changingIdentity = {
      get treePath() { reads.treePath++; return reads.treePath === 1 ? 'slot' : 'changed' },
      get generation() { reads.generation++; return reads.generation === 1 ? 1 : 2 },
      get producer() { reads.producer++; return reads.producer === 1 ? 'p@1' : 'p@2' },
    }
    expect(foreignBoxIdentityKey(changingIdentity)).toBe('["slot",1,"p@1"]')
    expect(reads).toMatchObject({ treePath: 1, generation: 1, producer: 1 })
    const metrics = assertForeignBoxMetrics({
      get width() { reads.width++; return reads.width === 1 ? 10 : 99 },
      get height() { reads.height++; return reads.height === 1 ? 4 : 99 },
      get depth() { reads.depth++; return reads.depth === 1 ? 1 : 99 },
      get baseline() { reads.baseline++; return reads.baseline === 1 ? 'alphabetic' as const : 'bottom' as const },
    })
    expect(metrics).toEqual({ width: 10, height: 4, depth: 1, baseline: 'alphabetic' })
    expect(Object.isFrozen(metrics)).toBe(true)
    expect(reads).toMatchObject({ width: 1, height: 1, depth: 1, baseline: 1 })
  })
})

describe('ForeignBoxHost lifecycle', () => {
  it('registers the root tree path as a live slot', () => {
    const apiRef = { current: null as UseForeignBoxResult | null }
    const view = render(<ForeignBoxHost><Slot id={identity('', 0, 'root@1')} apiRef={apiRef} /></ForeignBoxHost>)
    expect(apiRef.current!.isAlive()).toBe(true)
    expect(view.getByTestId('foreign-child').parentElement?.getAttribute('data-tree-path')).toBe('')
  })

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

  it('retires the previous authority when a replacement registers at the same tree path', () => {
    const oldRef = { current: null as UseForeignBoxResult | null }
    const nextRef = { current: null as UseForeignBoxResult | null }
    const oldMetrics = vi.fn(); const nextMetrics = vi.fn()
    render(<ForeignBoxHost>
      <Slot id={identity('same-slot', 1, 'old@1')} apiRef={oldRef} onMetrics={oldMetrics} />
      <Slot id={identity('same-slot', 2, 'new@2')} apiRef={nextRef} onMetrics={nextMetrics} />
    </ForeignBoxHost>)
    expect(oldRef.current!.isAlive()).toBe(false)
    expect(nextRef.current!.isAlive()).toBe(true)
    act(() => oldRef.current!.reportMetrics({ width: 99, height: 99, depth: 0, baseline: 'bottom' }))
    expect(oldMetrics).not.toHaveBeenCalled()
    expect(nextMetrics).not.toHaveBeenCalled()
  })

  it('resets marker and geometry before notifying a replaced authority with a fresh wrapper', () => {
    let registry!: ReturnType<typeof useForeignBoxRegistry>
    const view = render(<ForeignBoxHost><RegistryCapture setRegistry={value => { registry = value }} /></ForeignBoxHost>)
    const oldUnregister = vi.fn()
    let oldAliveDuringCallback = true
    let wrapperDuringCallback: {
      state: string | undefined
      visibility: string
      ariaHidden: string | null
      inert: boolean
      connected: boolean
      transform: string
      width: string
      height: string
      depth: string
    } | null = null
    let wrapper!: HTMLElement
    let old!: ReturnType<typeof registry.register>
    act(() => {
      old = registry.register({
        identity: identity('direct-slot', 1, 'old@1'),
        child: <button data-testid="direct-old">old</button>,
        onUnregister: () => {
          oldAliveDuringCallback = old.isAlive()
          wrapperDuringCallback = {
            state: wrapper.dataset.state,
            visibility: wrapper.style.visibility,
            ariaHidden: wrapper.getAttribute('aria-hidden'),
            inert: wrapper.hasAttribute('inert'),
            connected: wrapper.isConnected,
            transform: wrapper.style.transform,
            width: wrapper.style.width,
            height: wrapper.style.height,
            depth: wrapper.style.getPropertyValue('--snl-foreign-box-depth'),
          }
          oldUnregister()
        },
      })
    })
    wrapper = view.getByTestId('direct-old').parentElement as HTMLElement
    const host = view.container.querySelector('[data-snl-foreign-box-host]') as HTMLElement
    const marker = document.createElement('span')
    host.append(marker)
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(rect({ left: 0, top: 0, width: 100, height: 100 }))
    vi.spyOn(marker, 'getBoundingClientRect').mockReturnValue(rect({ left: 20, top: 30, width: 10, height: 10 }))
    act(() => {
      old.setMarker(marker)
      old.reportMetrics({ width: 12, height: 8, depth: 2, baseline: 'alphabetic' })
      flushRaf()
    })
    expect(wrapper.dataset.state).toBe('positioned')

    let next!: ReturnType<typeof registry.register>
    act(() => {
      next = registry.register({ identity: identity('direct-slot', 2, 'new@2'), child: <button data-testid="direct-new">new</button> })
    })
    expect(oldUnregister).toHaveBeenCalledTimes(1)
    expect(oldAliveDuringCallback).toBe(false)
    expect(wrapperDuringCallback).toEqual({
      state: 'staging', visibility: 'hidden', ariaHidden: 'true', inert: true, connected: true,
      transform: '', width: '', height: '', depth: '',
    })
    expect(old.isAlive()).toBe(false)
    expect(next.isAlive()).toBe(true)
    const nextWrapper = view.getByTestId('direct-new').parentElement as HTMLElement
    expect(nextWrapper).not.toBe(wrapper)
    expect(nextWrapper.dataset.state).toBe('staging')
    expect(nextWrapper.style.visibility).toBe('hidden')
    expect(nextWrapper.style.transform).toBe('')
    expect(nextWrapper.style.width).toBe('')
    expect(TrackingResizeObserver.instances[0].targets.has(marker)).toBe(false)
    expect(TrackingResizeObserver.instances[0].unobserved).toContain(wrapper)

    const nextMarker = document.createElement('span')
    host.append(nextMarker)
    act(() => { next.setMarker(nextMarker); flushRaf() })
    expect(nextWrapper.dataset.state).toBe('staging')
    old.unregister()
    expect(oldUnregister).toHaveBeenCalledTimes(1)
  })

  it('stages a positioned wrapper before an explicit unregister callback observes it', () => {
    let registry!: ReturnType<typeof useForeignBoxRegistry>
    const view = render(<ForeignBoxHost><RegistryCapture setRegistry={value => { registry = value }} /></ForeignBoxHost>)
    let wrapper!: HTMLElement
    let aliveDuringCallback = true
    let wrapperDuringCallback: Record<string, string | boolean | undefined | null> | null = null
    let registration!: ReturnType<typeof registry.register>
    act(() => {
      registration = registry.register({
        identity: identity('explicit-unregister', 1, 'owner@1'),
        child: <button data-testid="explicit-child">child</button>,
        onUnregister: () => {
          aliveDuringCallback = registration.isAlive()
          wrapperDuringCallback = {
            state: wrapper.dataset.state,
            visibility: wrapper.style.visibility,
            ariaHidden: wrapper.getAttribute('aria-hidden'),
            inert: wrapper.hasAttribute('inert'),
            connected: wrapper.isConnected,
            transform: wrapper.style.transform,
            width: wrapper.style.width,
            height: wrapper.style.height,
            depth: wrapper.style.getPropertyValue('--snl-foreign-box-depth'),
          }
        },
      })
    })
    wrapper = view.getByTestId('explicit-child').parentElement as HTMLElement
    const host = view.container.querySelector('[data-snl-foreign-box-host]') as HTMLElement
    const marker = document.createElement('span')
    host.append(marker)
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(rect({ left: 0, top: 0, width: 100, height: 100 }))
    vi.spyOn(marker, 'getBoundingClientRect').mockReturnValue(rect({ left: 20, top: 30, width: 10, height: 10 }))
    act(() => {
      registration.setMarker(marker)
      registration.reportMetrics({ width: 12, height: 8, depth: 2, baseline: 'alphabetic' })
      flushRaf()
    })
    expect(wrapper.dataset.state).toBe('positioned')

    act(() => registration.unregister())

    expect(aliveDuringCallback).toBe(false)
    expect(wrapperDuringCallback).toEqual({
      state: 'staging', visibility: 'hidden', ariaHidden: 'true', inert: true, connected: true,
      transform: '', width: '', height: '', depth: '',
    })
    expect(TrackingResizeObserver.instances[0].unobserved).toEqual(expect.arrayContaining([marker, wrapper]))
  })

  it('does not let an outer replacement overwrite authority registered reentrantly by the old callback', () => {
    let registry!: ReturnType<typeof useForeignBoxRegistry>
    render(<ForeignBoxHost><RegistryCapture setRegistry={value => { registry = value }} /></ForeignBoxHost>)
    let third!: ReturnType<typeof registry.register>
    let old!: ReturnType<typeof registry.register>
    act(() => {
      old = registry.register({
        identity: identity('reentrant-slot', 1, 'old@1'),
        child: <span>old</span>,
        onUnregister: () => {
          expect(old.isAlive()).toBe(false)
          third = registry.register({ identity: identity('reentrant-slot', 3, 'third@3'), child: <span>third</span> })
        },
      })
    })
    let second!: ReturnType<typeof registry.register>
    act(() => {
      second = registry.register({ identity: identity('reentrant-slot', 2, 'second@2'), child: <span>second</span> })
    })
    expect(old.isAlive()).toBe(false)
    expect(second.isAlive()).toBe(false)
    expect(third.isAlive()).toBe(true)
  })

  it('updates fresh JSX and callbacks in place without unregistering or losing focus and metrics', () => {
    const apiRef = { current: null as UseForeignBoxResult | null }
    const unregister = vi.fn(); const firstMetrics = vi.fn(); const nextMetrics = vi.fn()
    const view = render(<ForeignBoxHost><Slot apiRef={apiRef} label="first" onMetrics={firstMetrics} onUnregister={unregister} /></ForeignBoxHost>)
    const child = view.getByTestId('foreign-child') as HTMLButtonElement
    const wrapper = child.parentElement as HTMLElement
    const marker = view.getByTestId('marker')
    const host = view.container.querySelector('[data-snl-foreign-box-host]') as HTMLElement
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(rect({ left: 0, top: 0, width: 300, height: 200 }))
    vi.spyOn(marker, 'getBoundingClientRect').mockReturnValue(rect({ left: 20, top: 30, width: 20, height: 10 }))
    child.focus()
    act(() => { apiRef.current!.reportMetrics({ width: 30, height: 12, depth: 2, baseline: 'alphabetic' }); flushRaf() })
    view.rerender(<ForeignBoxHost><Slot apiRef={apiRef} label="second" onMetrics={nextMetrics} onUnregister={unregister} /></ForeignBoxHost>)
    expect(view.getByTestId('foreign-child')).toBe(child)
    expect(document.activeElement).toBe(child)
    expect(wrapper.dataset.state).toBe('positioned')
    expect(wrapper.style.height).toBe('14px')
    expect(unregister).not.toHaveBeenCalled()
    act(() => TrackingResizeObserver.instances[0].fire(wrapper, 31, 14))
    expect(nextMetrics).toHaveBeenCalled()
    expect(firstMetrics).toHaveBeenCalledTimes(1)
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

  it('keeps staging foreign controls inert and hidden until positioning, preserving the child node', () => {
    const apiRef = { current: null as UseForeignBoxResult | null }
    const view = render(<ForeignBoxHost><Slot apiRef={apiRef} /></ForeignBoxHost>)
    const child = view.getByTestId('foreign-child'); const wrapper = child.parentElement as HTMLElement
    const marker = view.getByTestId('marker'); const host = view.container.querySelector('[data-snl-foreign-box-host]') as HTMLElement
    const overlay = view.container.querySelector('.snl-foreign-box-overlay') as HTMLElement
    expect(overlay.hasAttribute('aria-hidden')).toBe(false)
    expect(wrapper.style.visibility).toBe('hidden')
    expect(wrapper.getAttribute('aria-hidden')).toBe('true')
    expect(wrapper.hasAttribute('inert')).toBe(true)
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(rect({ left: 0, top: 0, width: 100, height: 100 }))
    vi.spyOn(marker, 'getBoundingClientRect').mockReturnValue(rect({ left: 20, top: 20, width: 10, height: 10 }))
    act(() => { apiRef.current!.reportMetrics({ width: 10, height: 8, depth: 0, baseline: 'bottom' }); flushRaf() })
    expect(view.getByTestId('foreign-child')).toBe(child)
    expect(wrapper.style.visibility).toBe('visible')
    expect(wrapper.getAttribute('aria-hidden')).toBe('false')
    expect(wrapper.hasAttribute('inert')).toBe(false)
    act(() => apiRef.current!.markerRef(null))
    expect(wrapper.style.visibility).toBe('hidden')
    expect(wrapper.getAttribute('aria-hidden')).toBe('true')
    expect(wrapper.hasAttribute('inert')).toBe(true)
  })

  it('maps scaled viewport rectangles into untransformed host-local coordinates', () => {
    const apiRef = { current: null as UseForeignBoxResult | null }
    const view = render(<ForeignBoxHost><Slot apiRef={apiRef} /></ForeignBoxHost>)
    const marker = view.getByTestId('marker'); const wrapper = view.getByTestId('foreign-child').parentElement as HTMLElement
    const host = view.container.querySelector('[data-snl-foreign-box-host]') as HTMLElement
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element) => ({
      transform: element === host ? 'matrix(2, 0, 0, 2, 10, 20)' : 'none',
    }) as CSSStyleDeclaration)
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(rect({ left: 100, top: 50, width: 200, height: 100 }))
    vi.spyOn(marker, 'getBoundingClientRect').mockReturnValue(rect({ left: 140, top: 90, width: 20, height: 20 }))
    Object.defineProperties(host, {
      offsetWidth: { value: 100, configurable: true }, offsetHeight: { value: 50, configurable: true },
      scrollLeft: { value: 3, configurable: true }, scrollTop: { value: 4, configurable: true },
    })
    act(() => { apiRef.current!.reportMetrics({ width: 10, height: 8, depth: 0, baseline: 'bottom' }); flushRaf() })
    expect(wrapper.style.transform).toBe('translate(23px, 24px)')
  })

  it('subtracts the scaled host border before mapping viewport coordinates to the scrolled padding edge', () => {
    const apiRef = { current: null as UseForeignBoxResult | null }
    const view = render(<ForeignBoxHost><Slot apiRef={apiRef} /></ForeignBoxHost>)
    const marker = view.getByTestId('marker'); const wrapper = view.getByTestId('foreign-child').parentElement as HTMLElement
    const host = view.container.querySelector('[data-snl-foreign-box-host]') as HTMLElement
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element) => ({
      transform: element === host ? 'matrix(2, 0, 0, 2, 10, 20)' : 'none',
    }) as CSSStyleDeclaration)
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(rect({ left: 100, top: 50, width: 200, height: 100 }))
    vi.spyOn(marker, 'getBoundingClientRect').mockReturnValue(rect({ left: 140, top: 90, width: 20, height: 20 }))
    Object.defineProperties(host, {
      offsetWidth: { value: 100, configurable: true }, offsetHeight: { value: 50, configurable: true },
      clientLeft: { value: 4, configurable: true }, clientTop: { value: 6, configurable: true },
      scrollLeft: { value: 3, configurable: true }, scrollTop: { value: 4, configurable: true },
    })
    act(() => { apiRef.current!.reportMetrics({ width: 10, height: 8, depth: 0, baseline: 'bottom' }); flushRaf() })
    expect(wrapper.style.transform).toBe('translate(19px, 18px)')
  })

  it('atomically hides and clears a positioned wrapper when the host becomes rotated', () => {
    const apiRef = { current: null as UseForeignBoxResult | null }
    const view = render(<ForeignBoxHost><Slot apiRef={apiRef} /></ForeignBoxHost>)
    const marker = view.getByTestId('marker'); const wrapper = view.getByTestId('foreign-child').parentElement as HTMLElement
    const host = view.container.querySelector('[data-snl-foreign-box-host]') as HTMLElement
    let hostTransform = 'none'
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element) => ({
      transform: element === host ? hostTransform : 'none',
    }) as CSSStyleDeclaration)
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(rect({ left: 0, top: 0, width: 100, height: 100 }))
    vi.spyOn(marker, 'getBoundingClientRect').mockReturnValue(rect({ left: 20, top: 30, width: 10, height: 10 }))

    act(() => { apiRef.current!.reportMetrics({ width: 10, height: 8, depth: 2, baseline: 'alphabetic' }); flushRaf() })
    expect(wrapper.dataset.state).toBe('positioned')
    expect(wrapper.style.transform).toBe('translate(20px, 30px)')

    hostTransform = 'rotate(10deg)'
    act(() => { window.dispatchEvent(new Event('scroll')); flushRaf() })
    expect(wrapper.dataset.state).toBe('unsupported-transform')
    expect(wrapper.dataset.geometryError).toBe('unsupported-transform')
    expect(wrapper.style.visibility).toBe('hidden')
    expect(wrapper.getAttribute('aria-hidden')).toBe('true')
    expect(wrapper.hasAttribute('inert')).toBe(true)
    expect(wrapper.style.transform).toBe('')
    expect(wrapper.style.width).toBe('')
    expect(wrapper.style.height).toBe('')
    expect(wrapper.style.getPropertyValue('--snl-foreign-box-depth')).toBe('')
  })

  it('retains intrinsic staging measurement while transform support is unavailable', () => {
    const stylesheet = document.createElement('style')
    stylesheet.textContent = readFileSync(resolve(process.cwd(), 'src/snl-react-view/style.css'), 'utf8')
    document.head.append(stylesheet)
    try {
      let registry!: ReturnType<typeof useForeignBoxRegistry>
      const metrics = vi.fn()
      const view = render(<ForeignBoxHost><RegistryCapture setRegistry={value => { registry = value }} /></ForeignBoxHost>)
      let registration!: ReturnType<typeof registry.register>
      act(() => {
        registration = registry.register({
          identity: identity('wide-intrinsic', 1, 'wide@1'),
          child: <div data-testid="wide-intrinsic-child" style={{ width: '240px' }}>wide</div>,
          onMetrics: metrics,
        })
      })
      const wrapper = view.getByTestId('wide-intrinsic-child').parentElement as HTMLElement
      const host = view.container.querySelector('[data-snl-foreign-box-host]') as HTMLElement
      const marker = document.createElement('span')
      host.append(marker)
      let hostTransform = 'none'
      const actualGetComputedStyle = window.getComputedStyle.bind(window)
      vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element) => (
        element === host ? { transform: hostTransform } as CSSStyleDeclaration : actualGetComputedStyle(element)
      ))
      vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(rect({ left: 0, top: 0, width: 80, height: 100 }))
      vi.spyOn(marker, 'getBoundingClientRect').mockReturnValue(rect({ left: 10, top: 20, width: 10, height: 10 }))

      act(() => {
        registration.setMarker(marker)
        registration.reportMetrics({ width: 240, height: 12, depth: 0, baseline: 'bottom' })
        flushRaf()
      })
      expect(wrapper.dataset.state).toBe('positioned')
      expect(wrapper.style.width).toBe('240px')
      metrics.mockClear()

      hostTransform = 'rotate(4deg)'
      act(flushRaf)
      const unsupportedStyle = actualGetComputedStyle(wrapper)
      expect(wrapper.dataset.state).toBe('unsupported-transform')
      expect(unsupportedStyle.width).toBe('max-content')
      expect(unsupportedStyle.opacity).toBe('0')
      expect(unsupportedStyle.pointerEvents).toBe('none')
      expect(unsupportedStyle.transform).toBe('translate(-100000px, -100000px)')
      expect(wrapper.style.visibility).toBe('hidden')
      expect(wrapper.hasAttribute('inert')).toBe(true)
      expect(wrapper.getAttribute('aria-hidden')).toBe('true')

      const retainedWidth = unsupportedStyle.width === 'max-content' ? 240 : 80
      act(() => TrackingResizeObserver.instances[0].fire(wrapper, retainedWidth, 12))
      expect(metrics).toHaveBeenCalledWith({ width: 240, height: 12, depth: 0, baseline: 'bottom' })
      expect(metrics.mock.calls.some(([value]) => value.width === 80)).toBe(false)

      hostTransform = 'none'
      act(flushRaf)
      expect(wrapper.dataset.state).toBe('positioned')
      expect(wrapper.style.width).toBe('240px')
    } finally {
      stylesheet.remove()
    }
  })

  it.each([
    ['reflection', 'matrix(-1, 0, 0, 1, 0, 0)'],
    ['finite micro-skew', 'matrix(1, 0.000000000001, 0, 1, 0, 0)'],
    ['rotate(180)', 'matrix(-1, 0, 0, -1, 0, 0)'],
    ['3D transform', 'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)'],
  ])('fails closed after a positioned host changes to %s', (_label: string, unsupportedTransform: string) => {
    const apiRef = { current: null as UseForeignBoxResult | null }
    const view = render(<ForeignBoxHost><Slot apiRef={apiRef} /></ForeignBoxHost>)
    const marker = view.getByTestId('marker'); const wrapper = view.getByTestId('foreign-child').parentElement as HTMLElement
    const host = view.container.querySelector('[data-snl-foreign-box-host]') as HTMLElement
    let hostTransform = 'none'
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element) => ({
      transform: element === host ? hostTransform : 'none',
    }) as CSSStyleDeclaration)
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(rect({ left: 0, top: 0, width: 100, height: 100 }))
    vi.spyOn(marker, 'getBoundingClientRect').mockReturnValue(rect({ left: 20, top: 30, width: 10, height: 10 }))
    act(() => { apiRef.current!.reportMetrics({ width: 10, height: 8, depth: 2, baseline: 'alphabetic' }); flushRaf() })
    expect(wrapper.dataset.state).toBe('positioned')

    hostTransform = unsupportedTransform
    act(() => { window.dispatchEvent(new Event('scroll')); flushRaf() })
    expect(wrapper.dataset.state).toBe('unsupported-transform')
    expect(wrapper.style.visibility).toBe('hidden')
    expect(wrapper.style.transform).toBe('')
    expect(wrapper.style.width).toBe('')
  })

  it('fails closed when an ancestor affecting the host becomes rotated', () => {
    const apiRef = { current: null as UseForeignBoxResult | null }
    const view = render(<ForeignBoxHost><Slot apiRef={apiRef} /></ForeignBoxHost>)
    const marker = view.getByTestId('marker'); const wrapper = view.getByTestId('foreign-child').parentElement as HTMLElement
    const host = view.container.querySelector('[data-snl-foreign-box-host]') as HTMLElement
    let ancestorTransform = 'none'
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element) => ({
      transform: element === document.body ? ancestorTransform : 'none',
    }) as CSSStyleDeclaration)
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(rect({ left: 0, top: 0, width: 100, height: 100 }))
    vi.spyOn(marker, 'getBoundingClientRect').mockReturnValue(rect({ left: 20, top: 30, width: 10, height: 10 }))
    act(() => { apiRef.current!.reportMetrics({ width: 10, height: 8, depth: 0, baseline: 'bottom' }); flushRaf() })
    expect(wrapper.dataset.state).toBe('positioned')

    ancestorTransform = 'matrix(0, 1, -1, 0, 0, 0)'
    act(() => { window.dispatchEvent(new Event('scroll')); flushRaf() })
    expect(wrapper.dataset.state).toBe('unsupported-transform')
    expect(wrapper.style.visibility).toBe('hidden')
    expect(wrapper.style.transform).toBe('')
  })

  it('fails closed on the next shared frame when a host or ancestor transform changes without events', () => {
    const a = { current: null as UseForeignBoxResult | null }
    const b = { current: null as UseForeignBoxResult | null }
    const view = render(<div data-testid="ancestor"><ForeignBoxHost>
      <Slot id={identity('a')} apiRef={a} /><Slot id={identity('b')} apiRef={b} />
    </ForeignBoxHost></div>)
    const ancestor = view.getByTestId('ancestor')
    const host = view.container.querySelector('[data-snl-foreign-box-host]') as HTMLElement
    const markers = view.getAllByTestId('marker')
    const wrappers = view.getAllByTestId('foreign-child').map(node => node.parentElement as HTMLElement)
    let unsupported: Element | null = null
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element) => ({
      transform: element === unsupported ? 'rotate(10deg)' : 'none',
    }) as CSSStyleDeclaration)
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(rect({ left: 0, top: 0, width: 100, height: 100 }))
    markers.forEach((marker, index) => vi.spyOn(marker, 'getBoundingClientRect').mockReturnValue(rect({ left: 10 + index * 20, top: 20, width: 10, height: 10 })))
    act(() => {
      a.current!.reportMetrics({ width: 10, height: 8, depth: 0, baseline: 'bottom' })
      b.current!.reportMetrics({ width: 10, height: 8, depth: 0, baseline: 'bottom' })
      flushRaf()
    })
    expect(wrappers.every(wrapper => wrapper.dataset.state === 'positioned')).toBe(true)
    expect(rafCallbacks.size).toBe(1)

    unsupported = ancestor
    act(flushRaf)
    expect(wrappers.every(wrapper => wrapper.dataset.state === 'unsupported-transform')).toBe(true)
    expect(wrappers.every(wrapper => wrapper.style.visibility === 'hidden')).toBe(true)
    expect(rafCallbacks.size).toBe(1)
  })

  it('retires queued observer records with the replaced wrapper authority', () => {
    let registry!: ReturnType<typeof useForeignBoxRegistry>
    const view = render(<ForeignBoxHost><RegistryCapture setRegistry={value => { registry = value }} /></ForeignBoxHost>)
    const oldMetrics = vi.fn(); const nextMetrics = vi.fn()
    act(() => { registry.register({ identity: identity('record-slot', 1, 'old@1'), child: <span data-testid="record-old">old</span>, onMetrics: oldMetrics }) })
    const oldWrapper = view.getByTestId('record-old').parentElement as HTMLElement
    const observer = TrackingResizeObserver.instances[0]
    let next!: ReturnType<typeof registry.register>
    act(() => { next = registry.register({ identity: identity('record-slot', 2, 'new@2'), child: <span data-testid="record-new">new</span>, onMetrics: nextMetrics }) })
    const nextWrapper = view.getByTestId('record-new').parentElement as HTMLElement
    expect(nextWrapper).not.toBe(oldWrapper)

    act(() => observer.fire(oldWrapper, 99, 77))
    expect(oldMetrics).not.toHaveBeenCalled()
    expect(nextMetrics).not.toHaveBeenCalled()
    expect(nextWrapper.dataset.state).toBe('staging')

    act(() => next.reportMetrics({ width: 12, height: 8, depth: 0, baseline: 'bottom' }))
    expect(nextMetrics).toHaveBeenCalledTimes(1)
  })

  it('isolates queued observer records when an exact identity registers twice', () => {
    let registry!: ReturnType<typeof useForeignBoxRegistry>
    const view = render(<ForeignBoxHost><RegistryCapture setRegistry={value => { registry = value }} /></ForeignBoxHost>)
    const oldMetrics = vi.fn(); const nextMetrics = vi.fn(); const oldUnregister = vi.fn()
    const exactIdentity = identity('exact-record-slot', 7, 'same-producer@7')
    let old!: ReturnType<typeof registry.register>
    act(() => {
      old = registry.register({
        identity: exactIdentity,
        child: <span data-testid="exact-record-old">old</span>,
        onMetrics: oldMetrics,
        onUnregister: oldUnregister,
      })
    })
    const oldWrapper = view.getByTestId('exact-record-old').parentElement as HTMLElement
    const observer = TrackingResizeObserver.instances[0]
    const oldRecord = {
      target: oldWrapper,
      contentRect: rect({ left: 0, top: 0, width: 99, height: 77 }),
    } as unknown as ResizeObserverEntry

    let next!: ReturnType<typeof registry.register>
    act(() => {
      next = registry.register({
        identity: exactIdentity,
        child: <span data-testid="exact-record-new">new</span>,
        onMetrics: nextMetrics,
      })
    })
    const nextWrapper = view.getByTestId('exact-record-new').parentElement as HTMLElement
    expect(oldUnregister).toHaveBeenCalledTimes(1)
    expect(old.isAlive()).toBe(false)
    expect(next.isAlive()).toBe(true)
    expect(nextWrapper).not.toBe(oldWrapper)
    expect(nextWrapper.dataset.state).toBe('staging')

    act(() => observer.callback([oldRecord], observer as unknown as ResizeObserver))
    expect(oldMetrics).not.toHaveBeenCalled()
    expect(nextMetrics).not.toHaveBeenCalled()
    expect(nextWrapper.dataset.state).toBe('staging')

    const host = view.container.querySelector('[data-snl-foreign-box-host]') as HTMLElement
    const marker = document.createElement('span')
    host.append(marker)
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(rect({ left: 0, top: 0, width: 100, height: 100 }))
    vi.spyOn(marker, 'getBoundingClientRect').mockReturnValue(rect({ left: 12, top: 18, width: 10, height: 10 }))
    act(() => {
      next.setMarker(marker)
      observer.fire(nextWrapper, 42, 12)
      flushRaf()
    })
    expect(nextMetrics).toHaveBeenCalledWith({ width: 42, height: 12, depth: 0, baseline: 'bottom' })
    expect(nextWrapper.dataset.state).toBe('positioned')
    expect(nextWrapper.style.transform).toBe('translate(12px, 18px)')
    expect(nextWrapper.style.width).toBe('42px')
  })

  it('keeps fallback until positioned and restores it after transform support is lost', () => {
    const apiRef = { current: null as UseForeignBoxResult | null }
    const view = render(<ForeignBoxHost><Slot apiRef={apiRef} ssrFallback={<span data-testid="fallback">fallback</span>} /></ForeignBoxHost>)
    const host = view.container.querySelector('[data-snl-foreign-box-host]') as HTMLElement
    const marker = view.getByTestId('marker')
    const wrapper = view.getByTestId('foreign-child').parentElement as HTMLElement
    const fallbackBoundary = view.container.querySelector('[data-snl-foreign-box-fallback]') as HTMLElement
    const fallbackChild = view.getByTestId('fallback')
    let hostTransform = 'none'
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element) => ({ transform: element === host ? hostTransform : 'none' }) as CSSStyleDeclaration)
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(rect({ left: 0, top: 0, width: 100, height: 100 }))
    vi.spyOn(marker, 'getBoundingClientRect').mockReturnValue(rect({ left: 10, top: 20, width: 10, height: 10 }))
    expect(fallbackBoundary.hidden).toBe(false)
    expect(wrapper.hasAttribute('inert')).toBe(true)

    act(() => { apiRef.current!.reportMetrics({ width: 10, height: 8, depth: 0, baseline: 'bottom' }); flushRaf() })
    expect(view.getByTestId('fallback')).toBe(fallbackChild)
    expect(fallbackBoundary.hidden).toBe(true)
    expect(fallbackBoundary.hasAttribute('inert')).toBe(true)
    expect(wrapper.dataset.state).toBe('positioned')
    expect(wrapper.hasAttribute('inert')).toBe(false)

    hostTransform = 'rotate(4deg)'
    act(flushRaf)
    expect(view.getByTestId('fallback')).toBe(fallbackChild)
    expect(fallbackBoundary.hidden).toBe(false)
    expect(fallbackBoundary.hasAttribute('inert')).toBe(false)
    expect(wrapper.dataset.state).toBe('unsupported-transform')
    expect(wrapper.hasAttribute('inert')).toBe(true)
  })

  it('observes targets registered before host layout observer creation and reacts to marker geometry', () => {
    const apiRef = { current: null as UseForeignBoxResult | null }
    const view = render(<ForeignBoxHost><Slot apiRef={apiRef} /></ForeignBoxHost>)
    const marker = view.getByTestId('marker'); const wrapper = view.getByTestId('foreign-child').parentElement as HTMLElement
    const host = view.container.querySelector('[data-snl-foreign-box-host]') as HTMLElement
    expect(TrackingResizeObserver.instances[0].targets).toEqual(new Set([host, marker, wrapper]))
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(rect({ left: 10, top: 10, width: 100, height: 100 }))
    vi.spyOn(marker, 'getBoundingClientRect').mockReturnValue(rect({ left: 35, top: 45, width: 10, height: 10 }))
    act(() => { apiRef.current!.reportMetrics({ width: 10, height: 8, depth: 0, baseline: 'bottom' }); flushRaf() })
    vi.spyOn(marker, 'getBoundingClientRect').mockReturnValue(rect({ left: 55, top: 65, width: 10, height: 10 }))
    act(() => { TrackingResizeObserver.instances[0].fire(marker); flushRaf() })
    expect(wrapper.style.transform).toBe('translate(45px, 55px)')
  })

  it('keeps positive-depth wrapper measurement at a stable fixed point', () => {
    const apiRef = { current: null as UseForeignBoxResult | null }; const metrics = vi.fn()
    const view = render(<ForeignBoxHost><Slot apiRef={apiRef} onMetrics={metrics} /></ForeignBoxHost>)
    const wrapper = view.getByTestId('foreign-child').parentElement as HTMLElement
    act(() => { apiRef.current!.reportMetrics({ width: 30, height: 12, depth: 2, baseline: 'alphabetic' }); flushRaf() })
    expect(wrapper.style.height).toBe('14px')
    act(() => { TrackingResizeObserver.instances[0].fire(wrapper, 30, 14); flushRaf() })
    act(() => { TrackingResizeObserver.instances[0].fire(wrapper, 30, 14); flushRaf() })
    expect(metrics.mock.calls.at(-1)?.[0]).toEqual({ width: 30, height: 12, depth: 2, baseline: 'alphabetic' })
    expect(wrapper.style.height).toBe('14px')
    expect(rafCallbacks.size).toBe(1)
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
    const wrapper = view.getByTestId('foreign-child').parentElement as HTMLElement
    const host = view.container.querySelector('[data-snl-foreign-box-host]') as HTMLElement
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(rect({ left: 10, top: 10, width: 100, height: 100 }))
    vi.spyOn(newMarker, 'getBoundingClientRect').mockReturnValue(rect({ left: 60, top: 70, width: 10, height: 10 }))
    act(() => { apiRef.current!.reportMetrics({ width: 10, height: 5, depth: 0, baseline: 'bottom' }); TrackingResizeObserver.instances[0].fire(newMarker); flushRaf() })
    expect(wrapper.style.transform).toBe('translate(50px, 60px)')
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
    expect(rafCallbacks.size).toBe(0)
    expect(cancelledRafs).toHaveLength(1)
  })

  it('rearms descendant layout and passive registrations through StrictMode replay', () => {
    const layout: boolean[] = []; const passive: boolean[] = []
    const view = render(<StrictMode><ForeignBoxHost><EffectSlot kind="layout" calls={layout} /><EffectSlot kind="passive" calls={passive} /></ForeignBoxHost></StrictMode>)
    expect(layout.length).toBeGreaterThanOrEqual(2)
    expect(passive.length).toBeGreaterThanOrEqual(2)
    expect(layout.every(Boolean)).toBe(true)
    expect(passive.every(Boolean)).toBe(true)
    expect(view.getAllByTestId('strict-layout')).toHaveLength(1)
    expect(view.getAllByTestId('strict-passive')).toHaveLength(1)
  })

  it('keeps the current fallback ref attached through StrictMode replay', () => {
    const apiRef = { current: null as UseForeignBoxResult | null }
    const view = render(<StrictMode><ForeignBoxHost><Slot
      id={identity('strict-fallback', 1, 'owner@1')}
      apiRef={apiRef}
      ssrFallback={<span>fallback</span>}
    /></ForeignBoxHost></StrictMode>)
    const host = view.container.querySelector('[data-snl-foreign-box-host]') as HTMLElement
    const marker = view.getByTestId('marker')
    const fallback = view.container.querySelector('[data-snl-foreign-box-fallback]') as HTMLElement
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(rect({ left: 0, top: 0, width: 100, height: 100 }))
    vi.spyOn(marker, 'getBoundingClientRect').mockReturnValue(rect({ left: 10, top: 20, width: 10, height: 10 }))

    expect(fallback.hidden).toBe(false)
    act(() => { apiRef.current!.reportMetrics({ width: 10, height: 8, depth: 0, baseline: 'bottom' }); flushRaf() })
    expect(fallback.hidden).toBe(true)
    expect(fallback.hasAttribute('inert')).toBe(true)
    expect(fallback.getAttribute('aria-hidden')).toBe('true')
  })

  it('leaves a fallback ref from an error-abandoned render fully inert', () => {
    const arbitrary = document.createElement('div')
    arbitrary.hidden = true
    arbitrary.setAttribute('inert', 'custom')
    arbitrary.setAttribute('aria-hidden', 'mixed')
    const before = arbitrary.outerHTML
    let abandonedFallbackRef: UseForeignBoxResult['fallbackRef'] | null = null

    class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
      state = { failed: false }
      static getDerivedStateFromError() { return { failed: true } }
      render() { return this.state.failed ? <span data-testid="caught">caught</span> : this.props.children }
    }
    function ThrowingSlot(): ReactNode {
      abandonedFallbackRef = useForeignBox({ identity: identity('error-owner', 1, 'error@1'), child: <span>never committed</span> }).fallbackRef
      throw new Error('abandon this render')
    }

    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const view = render(<ForeignBoxHost><ErrorBoundary><ThrowingSlot /></ErrorBoundary></ForeignBoxHost>)
    expect(view.getByTestId('caught')).not.toBeNull()
    expect(abandonedFallbackRef).not.toBeNull()

    act(() => abandonedFallbackRef!(arbitrary))
    expect(arbitrary.outerHTML).toBe(before)
    expect(error).toHaveBeenCalled()
  })

  it('keeps the committed fallback owner through suspended replacement, then hands ownership to its commit', async () => {
    const apis = new Map<number, UseForeignBoxResult>()
    let setGeneration!: (generation: number) => void
    let release!: () => void
    let replacementReady = false
    const replacementWait = new Promise<void>(resolve => { release = resolve })

    function RetargetableSlot({ generation }: { generation: number }) {
      const api = useForeignBox({
        identity: identity('suspense-owner', generation, `owner@${generation}`),
        child: <span data-testid={`live-${generation}`}>live {generation}</span>,
        ssrFallback: <span data-testid={`fallback-${generation}`}>fallback {generation}</span>,
      })
      apis.set(generation, api)
      if (generation === 2 && !replacementReady) throw replacementWait
      return <>{api.ssrFallback}</>
    }
    function Harness() {
      const [generation, updateGeneration] = useState(1)
      setGeneration = updateGeneration
      return <Suspense fallback={<span data-testid="suspended">suspended</span>}><RetargetableSlot generation={generation} /></Suspense>
    }

    const view = render(<ForeignBoxHost><Harness /></ForeignBoxHost>)
    const committedA = apis.get(1)!
    expect(committedA.isAlive()).toBe(true)

    act(() => startTransition(() => setGeneration(2)))
    const speculativeB = apis.get(2)!
    expect(speculativeB.isAlive()).toBe(false)
    expect(view.getByTestId('fallback-1')).not.toBeNull()

    const acceptedByA = view.container.querySelector('[data-snl-foreign-box-fallback]') as HTMLElement
    acceptedByA.hidden = true
    acceptedByA.setAttribute('inert', 'custom')
    acceptedByA.setAttribute('aria-hidden', 'mixed')
    act(() => committedA.fallbackRef(acceptedByA))
    expect(acceptedByA.hidden).toBe(false)
    expect(acceptedByA.hasAttribute('inert')).toBe(false)
    expect(acceptedByA.getAttribute('aria-hidden')).toBeNull()

    const rejectedByB = document.createElement('div')
    rejectedByB.hidden = true
    rejectedByB.setAttribute('inert', 'custom')
    rejectedByB.setAttribute('aria-hidden', 'mixed')
    const rejectedByBBefore = rejectedByB.outerHTML
    act(() => speculativeB.fallbackRef(rejectedByB))
    expect(rejectedByB.outerHTML).toBe(rejectedByBBefore)

    await act(async () => {
      replacementReady = true
      release()
      await replacementWait
    })
    const committedB = apis.get(2)!
    expect(committedA.isAlive()).toBe(false)
    expect(committedB.isAlive()).toBe(true)
    expect(view.getByTestId('fallback-2')).not.toBeNull()

    const staleTarget = document.createElement('div')
    staleTarget.hidden = true
    staleTarget.setAttribute('inert', 'custom')
    staleTarget.setAttribute('aria-hidden', 'mixed')
    const staleBefore = staleTarget.outerHTML
    act(() => committedA.fallbackRef(staleTarget))
    expect(staleTarget.outerHTML).toBe(staleBefore)

    act(() => committedB.fallbackRef(staleTarget))
    expect(staleTarget.hidden).toBe(false)
    expect(staleTarget.hasAttribute('inert')).toBe(false)
    expect(staleTarget.getAttribute('aria-hidden')).toBeNull()
  })

  it('does not let a stale null ref clear the current fallback or disable its next handoff', () => {
    const apiRef = { current: null as UseForeignBoxResult | null }
    const view = render(<ForeignBoxHost><Slot
      id={identity('fallback-null', 1, 'owner@1')}
      apiRef={apiRef}
      ssrFallback={<span>fallback</span>}
    /></ForeignBoxHost>)
    const host = view.container.querySelector('[data-snl-foreign-box-host]') as HTMLElement
    let marker = view.getByTestId('marker')
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(rect({ left: 0, top: 0, width: 100, height: 100 }))
    vi.spyOn(marker, 'getBoundingClientRect').mockReturnValue(rect({ left: 10, top: 20, width: 10, height: 10 }))
    act(() => { apiRef.current!.reportMetrics({ width: 10, height: 8, depth: 0, baseline: 'bottom' }); flushRaf() })
    const staleFallbackRef = apiRef.current!.fallbackRef

    view.rerender(<ForeignBoxHost><Slot
      id={identity('fallback-null', 2, 'owner@2')}
      apiRef={apiRef}
      ssrFallback={<span>fallback</span>}
    /></ForeignBoxHost>)
    const currentFallback = view.container.querySelector('[data-snl-foreign-box-fallback]') as HTMLElement
    expect(currentFallback.hidden).toBe(false)
    act(() => {
      staleFallbackRef(currentFallback)
      staleFallbackRef(null)
    })
    expect(currentFallback.hidden).toBe(false)
    expect(currentFallback.hasAttribute('inert')).toBe(false)
    expect(currentFallback.getAttribute('aria-hidden')).toBeNull()

    marker = view.getByTestId('marker')
    vi.spyOn(marker, 'getBoundingClientRect').mockReturnValue(rect({ left: 12, top: 22, width: 10, height: 10 }))
    act(() => { apiRef.current!.reportMetrics({ width: 11, height: 9, depth: 0, baseline: 'bottom' }); flushRaf() })
    expect(currentFallback.hidden).toBe(true)
    expect(currentFallback.hasAttribute('inert')).toBe(true)
    expect(currentFallback.getAttribute('aria-hidden')).toBe('true')
  })

  it('leaves arbitrary fallback nodes untouched through a retained ref after real unmount', () => {
    const apiRef = { current: null as UseForeignBoxResult | null }
    const view = render(<ForeignBoxHost><Slot apiRef={apiRef} ssrFallback={<span>fallback</span>} /></ForeignBoxHost>)
    const retainedFallbackRef = apiRef.current!.fallbackRef
    const arbitrary = document.createElement('div')
    arbitrary.hidden = true
    arbitrary.setAttribute('inert', 'custom')
    arbitrary.setAttribute('aria-hidden', 'mixed')
    const before = arbitrary.outerHTML

    view.unmount()
    act(() => retainedFallbackRef(arbitrary))

    expect(arbitrary.outerHTML).toBe(before)
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
    const ownedAdds = listenerAdds.filter(([target, type]) => (target === window || target === viewport) && (type === 'scroll' || type === 'resize'))
    const ownedRemoves = listenerRemoves.filter(([target, type]) => (target === window || target === viewport) && (type === 'scroll' || type === 'resize'))
    for (const [target, type, callback, options] of ownedAdds) {
      expect(ownedRemoves.some(([removedTarget, removedType, removedCallback, removedOptions]) =>
        removedTarget === target && removedType === type && removedCallback === callback && removedOptions === options)).toBe(true)
    }
    act(() => { window.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('resize')); viewport.dispatchEvent(new Event('scroll')) })
    expect(rafCallbacks.size).toBe(0)
  })
})
