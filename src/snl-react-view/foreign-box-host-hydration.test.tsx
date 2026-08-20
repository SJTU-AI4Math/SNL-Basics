// @vitest-environment jsdom
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ForeignBoxHost } from './foreign-box-host'
import { useForeignBox, type UseForeignBoxResult } from './use-foreign-box'

describe('ForeignBoxHost hydration', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('keeps the hydrated fallback until the live overlay is measured and positioned', async () => {
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
    const wrapper = container.querySelector('[data-testid="foreign-child"]')!.parentElement as HTMLElement
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON() {} } as DOMRect)
    vi.spyOn(marker, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 10, height: 10, right: 20, bottom: 30, x: 10, y: 20, toJSON() {} } as DOMRect)
    await act(async () => {
      apiRef.current!.reportMetrics({ width: 12, height: 8, depth: 2, baseline: 'alphabetic' })
      const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback(0))
      await Promise.resolve()
    })
    expect(container.querySelector('[data-testid="fallback"]')).toBeNull()
    expect(wrapper.dataset.state).toBe('positioned')
    expect(wrapper.style.visibility).toBe('visible')
    expect(wrapper.hasAttribute('inert')).toBe(false)

    await act(async () => root.unmount())
    expect(unregister).toHaveBeenCalledTimes(1)
    expect(apiRef.current?.isAlive()).toBe(false)
    expect(container.childNodes).toHaveLength(0)
    container.remove()
  })
})