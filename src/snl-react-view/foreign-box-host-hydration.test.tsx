// @vitest-environment jsdom
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ForeignBoxHost } from './foreign-box-host'
import { useForeignBox, type UseForeignBoxResult } from './use-foreign-box'

describe('ForeignBoxHost hydration', () => {
  afterEach(() => vi.restoreAllMocks())

  it('hydrates the server fallback before activating one live overlay registration', async () => {
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
    expect(container.querySelector('[data-testid="fallback"]')).toBeNull()
    expect(container.querySelectorAll('[data-testid="foreign-child"]')).toHaveLength(1)
    expect(apiRef.current?.isAlive()).toBe(true)

    await act(async () => root.unmount())
    expect(unregister).toHaveBeenCalledTimes(1)
    expect(apiRef.current?.isAlive()).toBe(false)
    expect(container.childNodes).toHaveLength(0)
    container.remove()
  })
})