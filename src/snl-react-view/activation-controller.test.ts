import { describe, expect, it, vi } from 'vitest'
import { SnlActivationController } from './activation-controller'

describe('SnlActivationController', () => {
  it('runs default behavior when enabled and no replacement exists', () => {
    const fallback = vi.fn()
    new SnlActivationController({ params: { consumer: 1 } }).dispatch(0, 'event', fallback)
    expect(fallback).toHaveBeenCalledOnce()
  })

  it('can disable every default behavior at initialization', () => {
    const fallback = vi.fn()
    new SnlActivationController({ enabled: false, params: null }).dispatch(2, 'event', fallback)
    expect(fallback).not.toHaveBeenCalled()
  })

  it('replaces one phase, receives custom params, and can opt back into the default', () => {
    const fallback = vi.fn()
    const replacement = vi.fn(({ params, runDefault }) => {
      expect(params).toEqual({ consumer: 42 })
      runDefault()
      runDefault()
    })
    const controller = new SnlActivationController({
      params: { consumer: 42 },
      handlers: { 1: replacement },
    })
    controller.dispatch(1, { node: 'x' }, fallback)
    expect(replacement).toHaveBeenCalledOnce()
    expect(fallback).toHaveBeenCalledOnce()
  })

  it('can replace a phase without running the built-in action', () => {
    const fallback = vi.fn()
    const replacement = vi.fn()
    new SnlActivationController({ params: undefined, handlers: { 2: replacement } })
      .dispatch(2, 'event', fallback)
    expect(replacement).toHaveBeenCalledOnce()
    expect(fallback).not.toHaveBeenCalled()
  })

  it('invalidates runDefault after the synchronous handler invocation', async () => {
    const fallback = vi.fn()
    const handler = (async ({ runDefault }: { runDefault(): void }) => {
      await Promise.resolve()
      runDefault()
    }) as unknown as (event: { runDefault(): void }) => void
    const ran = new SnlActivationController({ params: undefined, handlers: { 0: handler } })
      .dispatch(0, 'event', fallback)
    expect(ran).toBe(false)
    await Promise.resolve()
    expect(fallback).not.toHaveBeenCalled()
  })


})
