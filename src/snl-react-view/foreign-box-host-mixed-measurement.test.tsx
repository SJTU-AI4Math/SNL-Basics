// @vitest-environment jsdom
import { useLayoutEffect, type ReactNode } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ForeignBoxHost, useForeignBoxRegistry, type ForeignBoxRegistration } from './foreign-box-host'

// Real public registrations and DOM boundaries; RO records are controlled here.
// Physical geometry is separately exercised by the Chromium production probe.
class Observer {
  static all: Observer[] = []
  targets = new Set<Element>()
  removed: Element[] = []
  disconnected = false
  readonly callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) { this.callback = callback; Observer.all.push(this) }
  observe = (target: Element) => { this.targets.add(target) }
  unobserve = (target: Element) => { this.targets.delete(target); this.removed.push(target) }
  disconnect = () => { this.disconnected = true; this.targets.clear() }
  fire(target: Element, width: number, height: number) {
    this.callback([{ target, contentRect: { width, height } } as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
}
let frames: Map<number, FrameRequestCallback>
let seq: number
beforeEach(() => {
  Observer.all = []; frames = new Map(); seq = 0
  vi.stubGlobal('ResizeObserver', Observer)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++seq, cb); return seq })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
function frame() { const batch = [...frames.values()]; frames.clear(); act(() => batch.forEach(cb => cb(0))) }
function Register({ name, child, capture, metrics }: {
  name: string; child: ReactNode; capture: (api: ForeignBoxRegistration) => void; metrics: ReturnType<typeof vi.fn>
}) {
  const registry = useForeignBoxRegistry()
  useLayoutEffect(() => {
    const api = registry.register({ identity: { treePath: name, generation: 1, producer: name }, child, alignment: 'center', onMetrics: metrics })
    capture(api)
    api.setMarker(document.querySelector(`[data-marker="${name}"]`))
    return () => api.unregister()
  }, [registry])
  return <span data-marker={name} />
}
const shell = (root: HTMLElement, name: string) => root.querySelector<HTMLElement>(`.snl-foreign-box[data-tree-path="${name}"]`)!

it('initial measurementRef rejects an already-present descendant measurement owner before any RAF', () => {
  const metrics = vi.fn(); let api!: ForeignBoxRegistration
  const view = render(<ForeignBoxHost><Register name="outer" capture={a => { api = a }} metrics={metrics}
    child={<div>a+<div className="snl-foreign-box-measure"><span data-snl-foreign-intrinsic="true">badge</span></div>+b</div>} /></ForeignBoxHost>)
  const wrapper = shell(view.container, 'outer'); const measure = wrapper.firstElementChild!
  const badge = measure.querySelector('[data-snl-foreign-intrinsic]')!
  const observer = Observer.all.find(o => o.targets.has(view.container.firstElementChild!))!
  expect(observer).toBeDefined()
  // This is deliberately before frame(): it isolates measurementRef from retargeting.
  expect(observer.targets.has(measure)).toBe(true)
  expect(observer.targets.has(badge)).toBe(false)
  act(() => { observer.fire(badge, 30, 12); observer.fire(measure, 160, 48) })
  expect(metrics).toHaveBeenCalledTimes(1)
  expect(metrics).toHaveBeenLastCalledWith(expect.objectContaining({ width: 160, height: 48 }))
  frame(); expect(wrapper.style.width).toBe('160px'); expect(wrapper.style.transform).toBe('translate(-80px, -24px)')
  act(() => api.unregister())
  expect(observer.removed).toContain(measure)
  const count = metrics.mock.calls.length
  observer.fire(measure, 999, 999); expect(metrics).toHaveBeenCalledTimes(count)
})

it('RAF retains the whole slot across nested-host appearance, growth, disappearance and late observers', () => {
  const outerMetrics = vi.fn(); const innerMetrics = vi.fn()
  let outer!: ForeignBoxRegistration; let inner!: ForeignBoxRegistration
  const view = render(<ForeignBoxHost><Register name="outer" capture={a => { outer = a }} metrics={outerMetrics} child={<span>a+pending+b</span>} /></ForeignBoxHost>)
  const wrapper = shell(view.container, 'outer'); const whole = wrapper.firstElementChild!
  const parentObserver = Observer.all.find(o => o.targets.has(whole))!
  expect(parentObserver).toBeDefined()
  act(() => parentObserver.fire(whole, 180, 50)); frame()
  act(() => outer.update({ alignment: 'center', onMetrics: outerMetrics, child: <div>a+<ForeignBoxHost><Register name="inner" capture={a => { inner = a }} metrics={innerMetrics}
    child={<span data-snl-foreign-intrinsic="true"><button>badge</button></span>} /></ForeignBoxHost>+b</div> }))
  const innerWrapper = shell(view.container, 'inner')
  const badge = innerWrapper.querySelector<HTMLElement>('[data-snl-foreign-intrinsic]')!
  const button = badge.firstElementChild!; const innerMarker = view.container.querySelector('[data-marker="inner"]')!
  const childObserver = Observer.all.find(o => o.targets.has(badge))!
  expect(childObserver).toBeDefined(); expect(childObserver).not.toBe(parentObserver)
  frame()
  expect(parentObserver.targets.has(whole)).toBe(true)
  expect(parentObserver.targets.has(badge)).toBe(false)
  expect(childObserver.targets.has(whole)).toBe(false)
  act(() => { parentObserver.fire(badge, 30, 12); childObserver.fire(badge, 30, 12); parentObserver.fire(whole, 180, 50) }); frame()
  expect(outerMetrics.mock.calls.every(([m]) => m.width === 180)).toBe(true)
  expect(innerMetrics).toHaveBeenLastCalledWith(expect.objectContaining({ width: 30, height: 12 }))
  expect(wrapper.style.transform).toBe('translate(-90px, -25px)')
  act(() => { childObserver.fire(badge, 70, 20); parentObserver.fire(whole, 220, 58) }); frame()
  expect(wrapper.style.width).toBe('220px'); expect(wrapper.style.transform).toBe('translate(-110px, -29px)')
  expect(shell(view.container, 'outer')).toBe(wrapper); expect(wrapper.firstElementChild).toBe(whole)
  expect(shell(view.container, 'inner')).toBe(innerWrapper); expect(badge.firstElementChild).toBe(button)
  expect(view.container.querySelector('[data-marker="inner"]')).toBe(innerMarker)
  act(() => inner.unregister()); frame()
  expect(childObserver.removed).toContain(badge)
  expect(parentObserver.removed).not.toContain(whole)
  const calls = innerMetrics.mock.calls.length
  act(() => { childObserver.fire(badge, 999, 999); parentObserver.fire(badge, 999, 999); parentObserver.fire(whole, 120, 40) }); frame()
  expect(innerMetrics).toHaveBeenCalledTimes(calls); expect(wrapper.style.width).toBe('120px')
  view.unmount()
  expect(Observer.all.length).toBeGreaterThanOrEqual(2)
  expect(Observer.all.every(o => o.disconnected && o.targets.size === 0)).toBe(true)
  expect(frames.size).toBe(0)
  childObserver.fire(badge, 999, 999); parentObserver.fire(whole, 999, 999)
  expect(frames.size).toBe(0); expect(innerMetrics).toHaveBeenCalledTimes(calls)
})

it('still retargets to an owned late intrinsic surface and back, rejecting removed-target records', () => {
  let api!: ForeignBoxRegistration; const metrics = vi.fn()
  const view = render(<ForeignBoxHost><Register name="own" capture={a => { api = a }} metrics={metrics} child={<span>loading</span>} /></ForeignBoxHost>)
  const wrapper = shell(view.container, 'own'); const measure = wrapper.firstElementChild!
  const observer = Observer.all.find(o => o.targets.has(measure))!
  act(() => api.update({ child: <span data-snl-foreign-intrinsic="true">ready</span>, onMetrics: metrics }))
  const intrinsic = measure.firstElementChild!; frame()
  expect(observer.targets.has(intrinsic)).toBe(true); expect(observer.removed).toContain(measure)
  act(() => observer.fire(intrinsic, 44, 22)); expect(wrapper.style.width).not.toBe('44px'); frame()
  expect(wrapper.style.width).toBe('44px')
  act(() => api.update({ child: <span>gone</span>, onMetrics: metrics })); frame()
  expect(observer.targets.has(measure)).toBe(true); expect(observer.removed).toContain(intrinsic)
  const calls = metrics.mock.calls.length
  act(() => observer.fire(intrinsic, 999, 999)); expect(metrics).toHaveBeenCalledTimes(calls)
  act(() => observer.fire(measure, 88, 33)); frame(); expect(wrapper.style.width).toBe('88px')
  view.unmount(); expect(observer.disconnected).toBe(true)
})
