import { describe, expect, it, vi } from 'vitest'
import {
  HoverPopoverDismissController,
  type HoverPopoverDismissRequest,
} from './popover-dismiss-controller'

const request = (): HoverPopoverDismissRequest<string> => ({
  reason: 'escape',
  scope: { kind: 'all' },
  targets: Object.freeze([]),
  cancelable: true,
})

describe('HoverPopoverDismissController', () => {
  it('accepts by default and runs the internal mutation exactly once', () => {
    const fallback = vi.fn()
    const accepted = new HoverPopoverDismissController({ params: undefined })
      .dispatch(request(), fallback)
    expect(accepted).toBe(true)
    expect(fallback).toHaveBeenCalledOnce()
  })

  it('dispatches one immutable request and expires the runDefault capability', async () => {
    const fallback = vi.fn()
    let captured: (() => void) | undefined
    const on_request = vi.fn(({ request: value, params, runDefault }) => {
      expect(Object.isFrozen(value)).toBe(true)
      expect(Object.isFrozen(value.targets)).toBe(true)
      expect(params).toEqual({ consumer: 1 })
      captured = runDefault
      runDefault()
      runDefault()
    })
    const accepted = new HoverPopoverDismissController({ params: { consumer: 1 }, on_request })
      .dispatch(Object.freeze(request()), fallback)
    expect(accepted).toBe(true)
    expect(on_request).toHaveBeenCalledOnce()
    expect(fallback).toHaveBeenCalledOnce()
    await Promise.resolve()
    captured?.()
    expect(fallback).toHaveBeenCalledOnce()
  })

  it('isolates request and removal notification errors', () => {
    const fallback = vi.fn()
    const controller = new HoverPopoverDismissController({
      params: null,
      on_request: () => { throw new Error('request failed') },
      on_removed: () => { throw new Error('notification failed') },
    })
    expect(() => controller.dispatch(request(), fallback)).not.toThrow()
    expect(fallback).not.toHaveBeenCalled()
    expect(() => controller.notifyRemoved([])).not.toThrow()
  })

  it('absorbs rejected thenables without reviving runDefault', () => {
    const fallback = vi.fn()
    const rejected = vi.fn()
    const on_request = (({ runDefault }: { runDefault(): void }) => ({
      then: (_resolve: () => void, reject: (reason: unknown) => void) => {
        runDefault()
        rejected()
        reject(new Error('async consumer failed'))
      },
    })) as unknown as ({ runDefault }: { runDefault(): void }) => void
    expect(() => new HoverPopoverDismissController({ params: null, on_request })
      .dispatch(request(), fallback)).not.toThrow()
    expect(rejected).toHaveBeenCalledOnce()
    expect(fallback).not.toHaveBeenCalled()
  })
})
