// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { SnlDeactivationController, type SnlActivationSnapshot } from './deactivation-controller'
import { createSnlSyntaxTreeNode } from '../snl-syntax-tree/types'

const activation = (): SnlActivationSnapshot => ({
  activation_id: 7,
  node: createSnlSyntaxTreeNode('x'),
  tree_path: [0],
  target: document.createElement('span'),
  phase: 2,
})

describe('SnlDeactivationController', () => {
  it('preserves default deactivation when no handler is installed', () => {
    const fallback = vi.fn()
    const ran = new SnlDeactivationController({ params: undefined })
      .dispatch('pointer-leave', activation(), { type: 'leave' }, fallback)
    expect(ran).toBe(true)
    expect(fallback).toHaveBeenCalledOnce()
  })

  it('passes immutable activation context and allows one synchronous runDefault', () => {
    const fallback = vi.fn()
    const handler = vi.fn(({ reason, event, params, activation: snapshot, runDefault }) => {
      expect({ reason, event, params }).toEqual({
        reason: 'explicit', event: { source: 'api' }, params: { owner: 'consumer' },
      })
      expect(snapshot).toMatchObject({ activation_id: 7, tree_path: [0], phase: 2 })
      runDefault()
      runDefault()
    })
    const ran = new SnlDeactivationController({
      params: { owner: 'consumer' },
      handlers: { explicit: handler },
    }).dispatch('explicit', activation(), { source: 'api' }, fallback)
    expect(ran).toBe(true)
    expect(handler).toHaveBeenCalledOnce()
    expect(fallback).toHaveBeenCalledOnce()
  })

  it('expires runDefault after the synchronous handler stack', async () => {
    const fallback = vi.fn()
    const handler = (async ({ runDefault }: { runDefault(): void }) => {
      await Promise.resolve()
      runDefault()
    }) as unknown as (dispatch: { runDefault(): void }) => void
    const ran = new SnlDeactivationController({ params: null, handlers: { explicit: handler } })
      .dispatch('explicit', activation(), undefined, fallback)
    expect(ran).toBe(false)
    await Promise.resolve()
    expect(fallback).not.toHaveBeenCalled()
  })

  it('isolates consumer throws and does not infer acceptance', () => {
    const fallback = vi.fn()
    expect(() => new SnlDeactivationController({
      params: null,
      handlers: { explicit: () => { throw new Error('consumer failed') } },
    }).dispatch('explicit', activation(), undefined, fallback)).not.toThrow()
    expect(fallback).not.toHaveBeenCalled()
  })

  it('absorbs rejected thenables while keeping delayed capabilities expired', () => {
    const fallback = vi.fn()
    const rejected = vi.fn()
    const handler = (({ runDefault }: { runDefault(): void }) => ({
      then: (_resolve: () => void, reject: (reason: unknown) => void) => {
        runDefault()
        rejected()
        reject(new Error('async consumer failed'))
      },
    })) as unknown as (dispatch: { runDefault(): void }) => void
    expect(() => new SnlDeactivationController({ params: null, handlers: { explicit: handler } })
      .dispatch('explicit', activation(), undefined, fallback)).not.toThrow()
    expect(rejected).toHaveBeenCalledOnce()
    expect(fallback).not.toHaveBeenCalled()
  })
})
