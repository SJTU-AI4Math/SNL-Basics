import { describe, expect, it, vi } from 'vitest'
import {
  ReleasedSvgTemplateAssetError,
  StaleSvgTemplateAssetError,
  SvgTemplateAssetRegistry,
  type SvgTemplateAssetIdentity,
} from './svg-template-asset-registry'

function identity(revision: string, source = 'diagram.svg'): SvgTemplateAssetIdentity {
  return { source, baseIdentity: 'workspace-a', revision }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('SvgTemplateAssetRegistry', () => {
  it('binds results to identity and epoch and rejects stale async replies', async () => {
    const old = deferred<string>()
    const fresh = deferred<string>()
    const loader = vi.fn((asset: SvgTemplateAssetIdentity, _signal: AbortSignal) =>
      asset.revision === 'old' ? old.promise : fresh.promise)
    const registry = new SvgTemplateAssetRegistry({ loader, maxSettled: 2 })

    const oldHandle = registry.acquire(identity('old'), 1)
    const freshHandle = registry.acquire(identity('fresh'), 2)
    fresh.resolve('<svg id="fresh"/>')
    await expect(freshHandle.promise).resolves.toMatchObject({ value: '<svg id="fresh"/>', requestEpoch: 2 })
    old.resolve('<svg id="old"/>')
    await expect(oldHandle.promise).rejects.toBeInstanceOf(StaleSvgTemplateAssetError)
    oldHandle.release()
    freshHandle.release()
  })

  it('bounds settled cache entries and invalidates source/base/revision identities', async () => {
    const loader = vi.fn(async (asset: SvgTemplateAssetIdentity) => asset.revision)
    const registry = new SvgTemplateAssetRegistry({ loader, maxSettled: 1 })
    const first = registry.acquire(identity('r1', 'one.svg'), 1)
    await first.promise
    first.release()
    const second = registry.acquire(identity('r2', 'two.svg'), 1)
    await second.promise
    second.release()
    expect(registry.snapshot()).toMatchObject({ pending: 0, settled: 1 })
    registry.invalidate(identity('r2', 'two.svg'))
    expect(registry.snapshot()).toEqual({ pending: 0, settled: 0, consumers: 0, authorities: 0 })
  })

  it('aborts and removes pending work after the last consumer releases', async () => {
    let observedSignal: AbortSignal | undefined
    const loader = vi.fn((_asset: SvgTemplateAssetIdentity, signal: AbortSignal) => {
      observedSignal = signal
      return new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)))
    })
    const registry = new SvgTemplateAssetRegistry({ loader, maxSettled: 2 })
    const first = registry.acquire(identity('r1'), 1)
    const replay = registry.acquire(identity('r1'), 1)
    first.release()
    expect(observedSignal?.aborted).toBe(false)
    replay.release()
    await Promise.all([
      expect(first.promise).rejects.toBeDefined(),
      expect(replay.promise).rejects.toBeDefined(),
    ])
    expect(observedSignal?.aborted).toBe(true)
    expect(registry.snapshot()).toEqual({ pending: 0, settled: 0, consumers: 0, authorities: 0 })
  })

  it('registers pending work before synchronous reentry and aborts after the final release', async () => {
    const loading = deferred<string>()
    const signals: AbortSignal[] = []
    let reentrantHandle: ReturnType<SvgTemplateAssetRegistry<string>['acquire']> | undefined
    let reentered = false
    const loader = vi.fn((_asset: SvgTemplateAssetIdentity, signal: AbortSignal) => {
      signals.push(signal)
      signal.addEventListener('abort', () => loading.reject(signal.reason), { once: true })
      if (!reentered) {
        reentered = true
        reentrantHandle = registry.acquire(identity('r1'), 1)
      }
      return loading.promise
    })
    const registry = new SvgTemplateAssetRegistry({ loader, maxSettled: 2 })

    const outerHandle = registry.acquire(identity('r1'), 1)

    expect(loader).toHaveBeenCalledTimes(1)
    expect(reentrantHandle).toBeDefined()
    expect(registry.snapshot()).toEqual({ pending: 1, settled: 0, consumers: 2, authorities: 1 })
    reentrantHandle!.release()
    expect(signals).toHaveLength(1)
    expect(signals[0].aborted).toBe(false)
    expect(registry.snapshot()).toEqual({ pending: 1, settled: 0, consumers: 1, authorities: 1 })

    outerHandle.release()
    await Promise.all([
      expect(reentrantHandle!.promise).rejects.toBeInstanceOf(ReleasedSvgTemplateAssetError),
      expect(outerHandle.promise).rejects.toBeInstanceOf(ReleasedSvgTemplateAssetError),
    ])
    expect(signals[0].aborted).toBe(true)
    expect(registry.snapshot()).toEqual({ pending: 0, settled: 0, consumers: 0, authorities: 0 })
  })

  it('prevents a released shared handle from receiving success or rejection', async () => {
    const success = deferred<string>()
    const successRegistry = new SvgTemplateAssetRegistry({ loader: () => success.promise, maxSettled: 2 })
    const releasedSuccess = successRegistry.acquire(identity('success'), 1)
    const liveSuccess = successRegistry.acquire(identity('success'), 1)
    releasedSuccess.release()
    releasedSuccess.release()
    success.resolve('loaded')
    await Promise.all([
      expect(releasedSuccess.promise).rejects.toBeInstanceOf(ReleasedSvgTemplateAssetError),
      expect(liveSuccess.promise).resolves.toMatchObject({ value: 'loaded' }),
    ])
    liveSuccess.release()

    const failure = deferred<string>()
    const failureRegistry = new SvgTemplateAssetRegistry({ loader: () => failure.promise, maxSettled: 2 })
    const releasedFailure = failureRegistry.acquire(identity('failure'), 1)
    const liveFailure = failureRegistry.acquire(identity('failure'), 1)
    releasedFailure.release()
    const loaderError = new Error('loader failed')
    failure.reject(loaderError)
    await Promise.all([
      expect(releasedFailure.promise).rejects.toBeInstanceOf(ReleasedSvgTemplateAssetError),
      expect(liveFailure.promise).rejects.toBe(loaderError),
    ])
    liveFailure.release()
    expect(failureRegistry.snapshot()).toEqual({ pending: 0, settled: 0, consumers: 0, authorities: 0 })
  })

  it('cleans up pending state when the loader throws synchronously', async () => {
    const loaderError = new Error('synchronous loader failure')
    const registry = new SvgTemplateAssetRegistry<string>({
      loader: () => { throw loaderError },
      maxSettled: 2,
    })

    const handle = registry.acquire(identity('sync-throw'), 1)
    expect(registry.snapshot()).toEqual({ pending: 1, settled: 0, consumers: 1, authorities: 1 })
    await expect(handle.promise).rejects.toBe(loaderError)
    expect(registry.snapshot()).toEqual({ pending: 0, settled: 0, consumers: 0, authorities: 1 })
    handle.release()
    expect(registry.snapshot()).toEqual({ pending: 0, settled: 0, consumers: 0, authorities: 0 })
  })

  it('bounds authority metadata across eviction, final release, and invalidation', async () => {
    const registry = new SvgTemplateAssetRegistry<string>({
      loader: async (asset) => asset.revision,
      maxSettled: 2,
    })
    for (let index = 0; index < 20; index += 1) {
      const handle = registry.acquire(identity(`r${index}`, `source-${index}.svg`), index)
      await handle.promise
      handle.release()
    }
    expect(registry.snapshot()).toEqual({ pending: 0, settled: 2, consumers: 0, authorities: 2 })
    registry.invalidate(identity('r19', 'source-19.svg'))
    expect(registry.snapshot()).toEqual({ pending: 0, settled: 1, consumers: 0, authorities: 1 })

    const never = new SvgTemplateAssetRegistry<string>({
      loader: () => new Promise(() => {}),
      maxSettled: 2,
    })
    const pending = never.acquire(identity('never'), 1)
    expect(never.snapshot().authorities).toBe(1)
    pending.release()
    expect(never.snapshot()).toEqual({ pending: 0, settled: 0, consumers: 0, authorities: 0 })
  })

  it('keeps authority through settlement until the handle releases', async () => {
    const registry = new SvgTemplateAssetRegistry<string>({ loader: async () => 'value', maxSettled: 0 })
    const handle = registry.acquire(identity('r1'), 1)
    await expect(handle.promise).resolves.toMatchObject({ value: 'value' })
    expect(registry.snapshot()).toEqual({ pending: 0, settled: 0, consumers: 0, authorities: 1 })
    handle.release()
    handle.release()
    expect(registry.snapshot()).toEqual({ pending: 0, settled: 0, consumers: 0, authorities: 0 })
  })

  it('supports StrictMode-style release and replay without reviving stale work', async () => {
    const calls: Array<{ deferred: ReturnType<typeof deferred<string>>; signal: AbortSignal }> = []
    const registry = new SvgTemplateAssetRegistry<string>({
      loader: (_asset, signal) => {
        const result = deferred<string>()
        calls.push({ deferred: result, signal })
        signal.addEventListener('abort', () => result.reject(signal.reason), { once: true })
        return result.promise
      },
      maxSettled: 2,
    })
    const first = registry.acquire(identity('r1'), 1)
    first.release()
    await expect(first.promise).rejects.toBeDefined()
    const replay = registry.acquire(identity('r1'), 1)
    calls[1].deferred.resolve('replayed')
    await expect(replay.promise).resolves.toMatchObject({ value: 'replayed' })
    expect(calls[0].signal.aborted).toBe(true)
    replay.release()
  })
})
