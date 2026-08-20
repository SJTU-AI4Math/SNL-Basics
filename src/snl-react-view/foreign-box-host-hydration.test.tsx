// @vitest-environment jsdom
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ForeignBoxHost } from './foreign-box-host'
import { ForeignBoxFallback, useForeignBox, type UseForeignBoxResult } from './use-foreign-box'

describe('ForeignBoxHost hydration', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('keeps a stable hydrated fallback boundary while the live overlay is measured and positioned', async () => {
    const callbacks = new Map<number, FrameRequestCallback>()
    let nextRaf = 1
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = nextRaf++; callbacks.set(id, callback); return id })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { callbacks.delete(id) })
    const apiRef = { current: null as UseForeignBoxResult | null }
    const unregister = vi.fn()
    function Consumer() {
      const foreign = useForeignBox({
        identity: { treePath: 'hydrated', generation: 1, producer: 'hydration@1' },
        child: <button data-testid="foreign-child">live child</button>,
        ssrFallback: <span data-testid="fallback">server fallback</span>,
        onUnregister: unregister,
      })
      apiRef.current = foreign
      return <div><span data-testid="marker" ref={foreign.markerRef} />{foreign.ssrFallback}</div>
    }
    const app = <ForeignBoxHost><Consumer /></ForeignBoxHost>
    const html = renderToString(app)
    expect(html).toContain('data-testid="fallback"')

    const container = document.createElement('div')
    container.innerHTML = html
    document.body.append(container)
    const recoverable: unknown[] = []
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    let root!: ReturnType<typeof hydrateRoot>
    await act(async () => {
      root = hydrateRoot(container, app, { onRecoverableError: value => recoverable.push(value) })
      expect(container.querySelectorAll('[data-testid="fallback"]')).toHaveLength(1)
      await Promise.resolve()
    })

    expect(recoverable).toEqual([])
    expect(error.mock.calls.flat().join(' ')).not.toMatch(/hydration|did not match/i)
    expect(container.querySelectorAll('[data-testid="fallback"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-testid="foreign-child"]')).toHaveLength(1)
    expect(apiRef.current?.isAlive()).toBe(true)
    const host = container.querySelector('[data-snl-foreign-box-host]') as HTMLElement
    const marker = container.querySelector('[data-testid="marker"]') as HTMLElement
    const measurement = container.querySelector('[data-testid="foreign-child"]')!.parentElement as HTMLElement
    const wrapper = measurement.parentElement as HTMLElement
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON() {} } as DOMRect)
    vi.spyOn(marker, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 10, height: 10, right: 20, bottom: 30, x: 10, y: 20, toJSON() {} } as DOMRect)
    await act(async () => {
      apiRef.current!.reportMetrics({ width: 12, height: 8, depth: 2, baseline: 'alphabetic' })
      const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback(0))
      await Promise.resolve()
    })
    const fallbackBoundary = container.querySelector('[data-snl-foreign-box-fallback]') as HTMLElement
    expect(container.querySelector('[data-testid="fallback"]')).not.toBeNull()
    expect(fallbackBoundary.hidden).toBe(true)
    expect(fallbackBoundary.hasAttribute('inert')).toBe(true)
    expect(fallbackBoundary.getAttribute('aria-hidden')).toBe('true')
    expect(wrapper.dataset.state).toBe('positioned')
    expect(wrapper.style.visibility).toBe('visible')
    expect(wrapper.hasAttribute('inert')).toBe(false)

    await act(async () => root.unmount())
    expect(unregister).toHaveBeenCalledTimes(1)
    expect(apiRef.current?.isAlive()).toBe(false)
    expect(container.childNodes).toHaveLength(0)
    container.remove()
  })

  it('hands accessibility atomically between a stable hydrated fallback and the live child outside React flush', async () => {
    const callbacks = new Map<number, FrameRequestCallback>()
    let nextRaf = 1
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = nextRaf++; callbacks.set(id, callback); return id })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { callbacks.delete(id) })
    const apiRef = { current: null as UseForeignBoxResult | null }
    let hostTransform = 'none'
    const actualGetComputedStyle = getComputedStyle
    vi.stubGlobal('getComputedStyle', (element: Element) => {
      const style = actualGetComputedStyle(element)
      return element.hasAttribute('data-snl-foreign-box-host')
        ? new Proxy(style, { get(target, property, receiver) { return property === 'transform' ? hostTransform : Reflect.get(target, property, receiver) } })
        : style
    })

    function Consumer() {
      const foreign = useForeignBox({
        identity: { treePath: 'atomic', generation: 1, producer: 'hydration@atomic' },
        child: <button data-testid="foreign-child">live child</button>,
      })
      apiRef.current = foreign
      return <div>
        <span data-testid="marker" ref={foreign.markerRef} />
        <ForeignBoxFallback foreign={foreign}>
          <button data-testid="fallback-child">fallback child</button>
        </ForeignBoxFallback>
      </div>
    }

    const app = <ForeignBoxHost><Consumer /></ForeignBoxHost>
    const html = renderToString(app)
    expect(html).toContain('data-snl-foreign-box-fallback="true"')
    expect(html).not.toContain('data-snl-foreign-box-fallback="true" hidden')

    const container = document.createElement('div')
    container.innerHTML = html
    document.body.append(container)
    const recoverable: unknown[] = []
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    let root!: ReturnType<typeof hydrateRoot>
    await act(async () => {
      root = hydrateRoot(container, app, { onRecoverableError: value => recoverable.push(value) })
      await Promise.resolve()
    })

    expect(recoverable).toEqual([])
    expect(error.mock.calls.flat().join(' ')).not.toMatch(/hydration|did not match/i)
    const host = container.querySelector('[data-snl-foreign-box-host]') as HTMLElement
    const marker = container.querySelector('[data-testid="marker"]') as HTMLElement
    const fallback = container.querySelector('[data-snl-foreign-box-fallback]') as HTMLElement
    const fallbackChild = container.querySelector('[data-testid="fallback-child"]') as HTMLElement
    const liveChild = container.querySelector('[data-testid="foreign-child"]') as HTMLElement
    const measurement = liveChild.parentElement as HTMLElement
    const wrapper = measurement.parentElement as HTMLElement
    const handoffOrder: Array<{ fallbackHidden: boolean; liveVisibility: string; liveInert: boolean }> = []
    const hiddenDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidden')!
    Object.defineProperty(fallback, 'hidden', {
      configurable: true,
      get() { return hiddenDescriptor.get!.call(this) as boolean },
      set(value: boolean) {
        handoffOrder.push({ fallbackHidden: value, liveVisibility: wrapper.style.visibility, liveInert: wrapper.hasAttribute('inert') })
        hiddenDescriptor.set!.call(this, value)
      },
    })
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON() {} } as DOMRect)
    vi.spyOn(marker, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 10, height: 10, right: 20, bottom: 30, x: 10, y: 20, toJSON() {} } as DOMRect)

    const accessibleCount = () => Number(!fallback.hidden && !fallback.hasAttribute('inert') && fallback.getAttribute('aria-hidden') !== 'true')
      + Number(wrapper.style.visibility === 'visible' && !wrapper.hasAttribute('inert') && wrapper.getAttribute('aria-hidden') !== 'true')

    await act(async () => { apiRef.current!.reportMetrics({ width: 12, height: 8, depth: 2, baseline: 'alphabetic' }) })
    expect(accessibleCount()).toBe(1)
    const positionFrame = [...callbacks.values()][0]
    callbacks.clear()
    positionFrame(0)

    expect(handoffOrder.at(-1)).toEqual({ fallbackHidden: true, liveVisibility: 'hidden', liveInert: true })
    expect(fallback.hidden).toBe(true)
    expect(fallback.hasAttribute('inert')).toBe(true)
    expect(fallback.getAttribute('aria-hidden')).toBe('true')
    expect(wrapper.style.visibility).toBe('visible')
    expect(wrapper.hasAttribute('inert')).toBe(false)
    expect(wrapper.getAttribute('aria-hidden')).toBe('false')
    expect(accessibleCount()).toBe(1)

    hostTransform = 'rotate(8deg)'
    const failClosedFrame = [...callbacks.values()][0]
    callbacks.clear()
    failClosedFrame(1)

    expect(handoffOrder.at(-1)).toEqual({ fallbackHidden: false, liveVisibility: 'hidden', liveInert: true })
    expect(wrapper.style.visibility).toBe('hidden')
    expect(wrapper.hasAttribute('inert')).toBe(true)
    expect(wrapper.getAttribute('aria-hidden')).toBe('true')
    expect(fallback.hidden).toBe(false)
    expect(fallback.hasAttribute('inert')).toBe(false)
    expect(fallback.getAttribute('aria-hidden')).toBeNull()
    expect(accessibleCount()).toBe(1)

    await act(async () => { await Promise.resolve() })
    expect(container.querySelector('[data-snl-foreign-box-fallback]')).toBe(fallback)
    expect(container.querySelector('[data-testid="fallback-child"]')).toBe(fallbackChild)
    expect(container.querySelector('[data-testid="foreign-child"]')).toBe(liveChild)
    expect(accessibleCount()).toBe(1)

    const retained = [...callbacks.values()]
    await act(async () => root.unmount())
    retained.forEach(callback => callback(2))
    await Promise.resolve()
    expect(error.mock.calls.flat().join(' ')).not.toMatch(/unmounted component|state update/i)
    expect(container.childNodes).toHaveLength(0)
    container.remove()
  })

})
