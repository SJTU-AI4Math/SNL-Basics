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

  it('starts fresh work when the same identity advances to a higher epoch', async () => {
    const old = deferred<string>()
    const fresh = deferred<string>()
    const loader = vi.fn()
      .mockImplementationOnce(() => old.promise)
      .mockImplementationOnce(() => fresh.promise)
    const registry = new SvgTemplateAssetRegistry({ loader, maxSettled: 2 })
    const asset = identity('r1')

    const oldHandle = registry.acquire(asset, 1)
    const freshHandle = registry.acquire(asset, 2)
    expect(loader).toHaveBeenCalledTimes(2)

    fresh.resolve('<svg id="fresh"/>')
    await expect(freshHandle.promise).resolves.toMatchObject({ value: '<svg id="fresh"/>', requestEpoch: 2 })
    old.resolve('<svg id="old"/>')
    await expect(oldHandle.promise).rejects.toBeInstanceOf(StaleSvgTemplateAssetError)
    oldHandle.release()
    freshHandle.release()
  })

  it('keeps a fresh authority alive across same-epoch abort reentry and immediate release', async () => {
    const aborts: number[] = []
    let reentrantHandle: ReturnType<SvgTemplateAssetRegistry['acquire']> | undefined
    const loader = vi.fn((_asset: SvgTemplateAssetIdentity, signal: AbortSignal) => {
      const call = loader.mock.calls.length
      if (call === 3) return Promise.resolve('<svg id="outer-fresh"/>')
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborts.push(call)
          reject(signal.reason)
          if (call === 1) {
            reentrantHandle = registry.acquire(identity('fresh'), 2)
            void reentrantHandle.promise.catch(() => {})
            reentrantHandle.release()
          }
        }, { once: true })
      })
    })
    const registry = new SvgTemplateAssetRegistry({ loader, maxSettled: 1 })

    const oldHandle = registry.acquire(identity('old'), 1)
    void oldHandle.promise.catch(() => {})
    const freshHandle = registry.acquire(identity('fresh'), 2)
    void freshHandle.promise.catch(() => {})

    expect(loader).toHaveBeenCalledTimes(3)
    expect(aborts).toEqual([1, 2])
    expect(registry.snapshot()).toEqual({
      pending: 1, settled: 0, consumers: 1, authorities: 1, authorityHistory: 0,
    })
    await Promise.all([
      expect(oldHandle.promise).rejects.toBeInstanceOf(StaleSvgTemplateAssetError),
      expect(reentrantHandle!.promise).rejects.toBeInstanceOf(ReleasedSvgTemplateAssetError),
      expect(freshHandle.promise).resolves.toMatchObject({
        value: '<svg id="outer-fresh"/>', requestEpoch: 2,
      }),
    ])
    expect(registry.snapshot()).toEqual({
      pending: 0, settled: 1, consumers: 0, authorities: 1, authorityHistory: 0,
    })

    oldHandle.release()
    freshHandle.release()
    registry.invalidate(identity('fresh'))
    expect(registry.snapshot()).toEqual({
      pending: 0, settled: 0, consumers: 0, authorities: 0, authorityHistory: 1,
    })
  })

  it('rejects an outer epoch superseded by abort reentry before registering detached work', async () => {
    const epoch3Load = deferred<string>()
    const revisions: string[] = []
    let epoch3Handle: ReturnType<SvgTemplateAssetRegistry['acquire']> | undefined
    let aborts = 0
    const loader = vi.fn((asset: SvgTemplateAssetIdentity, signal: AbortSignal) => {
      revisions.push(asset.revision)
      if (asset.revision === 'r3') return epoch3Load.promise
      if (asset.revision === 'r2') return Promise.resolve('detached-epoch-2')
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborts += 1
          reject(signal.reason)
          epoch3Handle = registry.acquire(identity('r3'), 3)
          void epoch3Handle.promise.catch(() => {})
        }, { once: true })
      })
    })
    const registry = new SvgTemplateAssetRegistry({ loader, maxSettled: 1 })

    const epoch1Handle = registry.acquire(identity('r1'), 1)
    void epoch1Handle.promise.catch(() => {})
    const epoch2Handle = registry.acquire(identity('r2'), 2)
    void epoch2Handle.promise.catch(() => {})

    expect(revisions).toEqual(['r1', 'r3'])
    expect(loader).toHaveBeenCalledTimes(2)
    expect(aborts).toBe(1)
    expect(registry.snapshot()).toEqual({
      pending: 1, settled: 0, consumers: 1, authorities: 1, authorityHistory: 0,
    })

    epoch3Load.resolve('epoch-3')
    await Promise.all([
      expect(epoch1Handle.promise).rejects.toBeInstanceOf(StaleSvgTemplateAssetError),
      expect(epoch2Handle.promise).rejects.toBeInstanceOf(StaleSvgTemplateAssetError),
      expect(epoch3Handle!.promise).resolves.toMatchObject({ value: 'epoch-3', requestEpoch: 3 }),
    ])
    expect(registry.snapshot()).toEqual({
      pending: 0, settled: 1, consumers: 0, authorities: 1, authorityHistory: 0,
    })

    epoch1Handle.release()
    epoch2Handle.release()
    epoch3Handle!.release()
    registry.invalidate(identity('r3'))
    expect(registry.snapshot()).toEqual({
      pending: 0, settled: 0, consumers: 0, authorities: 0, authorityHistory: 1,
    })
  })

  it('discards a leaked pending entry that belongs to a detached authority before key reuse', async () => {
    const revisions: string[] = []
    const aborts: number[] = []
    const loader = vi.fn((asset: SvgTemplateAssetIdentity, signal: AbortSignal) => {
      const call = loader.mock.calls.length
      revisions.push(asset.revision)
      if (call === 3) return Promise.resolve('epoch-4')
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborts.push(call)
          reject(signal.reason)
        }, { once: true })
      })
    })
    const registry = new SvgTemplateAssetRegistry({ loader, maxSettled: 1 })
    type PendingProbe = { authorityState: { references: number } }
    const internals = registry as unknown as {
      pending: Map<string, PendingProbe>
      retainAuthority(state: PendingProbe['authorityState']): void
    }
    const epoch2Key = JSON.stringify(['workspace-a', 'diagram.svg', 'r2'])

    const epoch2Handle = registry.acquire(identity('r2'), 2)
    void epoch2Handle.promise.catch(() => {})
    const detachedEntry = internals.pending.get(epoch2Key)
    expect(detachedEntry).toBeDefined()

    const epoch3Handle = registry.acquire(identity('r3'), 3)
    void epoch3Handle.promise.catch(() => {})
    internals.retainAuthority(detachedEntry!.authorityState)
    internals.pending.set(epoch2Key, detachedEntry!)

    const epoch4Handle = registry.acquire(identity('r2'), 4)
    void epoch4Handle.promise.catch(() => {})
    expect(revisions).toEqual(['r2', 'r3', 'r2'])
    expect(loader).toHaveBeenCalledTimes(3)
    expect(aborts).toEqual([1, 2])
    expect(registry.snapshot()).toEqual({
      pending: 1, settled: 0, consumers: 1, authorities: 1, authorityHistory: 0,
    })

    await Promise.all([
      expect(epoch2Handle.promise).rejects.toBeInstanceOf(StaleSvgTemplateAssetError),
      expect(epoch3Handle.promise).rejects.toBeInstanceOf(StaleSvgTemplateAssetError),
      expect(epoch4Handle.promise).resolves.toMatchObject({ value: 'epoch-4', requestEpoch: 4 }),
    ])
    expect(registry.snapshot()).toEqual({
      pending: 0, settled: 1, consumers: 0, authorities: 1, authorityHistory: 0,
    })

    epoch2Handle.release()
    epoch3Handle.release()
    epoch4Handle.release()
    registry.invalidate(identity('r2'))
    expect(registry.snapshot()).toEqual({
      pending: 0, settled: 0, consumers: 0, authorities: 0, authorityHistory: 1,
    })
  })

  it('shares current work installed by abort reentry while discarding mismatched pending work', async () => {
    const loads: Array<ReturnType<typeof deferred<string>>> = []
    let reenterOnDetachedAbort = false
    let reentrantHandle: ReturnType<SvgTemplateAssetRegistry['acquire']> | undefined
    const loader = vi.fn((_asset: SvgTemplateAssetIdentity, signal: AbortSignal) => {
      const call = loader.mock.calls.length
      const load = deferred<string>()
      loads.push(load)
      signal.addEventListener('abort', () => {
        load.reject(signal.reason)
        if (call === 1 && reenterOnDetachedAbort) {
          reentrantHandle = registry.acquire(identity('r2'), 4)
          void reentrantHandle.promise.catch(() => {})
        }
      }, { once: true })
      return load.promise
    })
    const registry = new SvgTemplateAssetRegistry({ loader, maxSettled: 1 })
    type PendingProbe = { authorityState: { references: number } }
    const pending = (registry as unknown as { pending: Map<string, PendingProbe> }).pending
    const key = JSON.stringify(['workspace-a', 'diagram.svg', 'r2'])

    const epoch2Handle = registry.acquire(identity('r2'), 2)
    void epoch2Handle.promise.catch(() => {})
    const detachedEntry = pending.get(key)
    expect(detachedEntry).toBeDefined()
    pending.delete(key)

    const epoch3Handle = registry.acquire(identity('r3'), 3)
    void epoch3Handle.promise.catch(() => {})
    pending.set(key, detachedEntry!)
    reenterOnDetachedAbort = true

    const outerHandle = registry.acquire(identity('r2'), 4)
    void outerHandle.promise.catch(() => {})

    expect(loader).toHaveBeenCalledTimes(3)
    expect(reentrantHandle).toBeDefined()
    expect(registry.snapshot()).toEqual({
      pending: 1, settled: 0, consumers: 2, authorities: 1, authorityHistory: 0,
    })

    loads[2].resolve('shared-epoch-4')
    await Promise.all([
      expect(epoch2Handle.promise).rejects.toBeInstanceOf(StaleSvgTemplateAssetError),
      expect(epoch3Handle.promise).rejects.toBeInstanceOf(StaleSvgTemplateAssetError),
      expect(reentrantHandle!.promise).resolves.toMatchObject({ value: 'shared-epoch-4', requestEpoch: 4 }),
      expect(outerHandle.promise).resolves.toMatchObject({ value: 'shared-epoch-4', requestEpoch: 4 }),
    ])
    expect(registry.snapshot()).toEqual({
      pending: 0, settled: 1, consumers: 0, authorities: 1, authorityHistory: 0,
    })

    epoch2Handle.release()
    epoch3Handle.release()
    reentrantHandle!.release()
    outerHandle.release()
    registry.invalidate(identity('r2'))
    expect(registry.snapshot()).toEqual({
      pending: 0, settled: 0, consumers: 0, authorities: 0, authorityHistory: 1,
    })
  })

  it('isolates identity from caller and loader mutation through result delivery', async () => {
    const loaded = deferred<string>()
    let loaderIdentity: { source: string; baseIdentity: string; revision: string } | undefined
    let seenAtCall: SvgTemplateAssetIdentity | undefined
    const registry = new SvgTemplateAssetRegistry({
      loader: async (asset) => {
        seenAtCall = { ...asset }
        loaderIdentity = asset as { source: string; baseIdentity: string; revision: string }
        loaderIdentity.source = 'loader-sync.svg'
        return loaded.promise
      },
      maxSettled: 1,
    })
    const mutable = { source: 'old.svg', baseIdentity: 'workspace-a', revision: 'r1' }
    const handle = registry.acquire(mutable, 1)

    mutable.source = 'new.svg'
    mutable.baseIdentity = 'workspace-b'
    mutable.revision = 'r2'
    loaderIdentity!.revision = 'loader-late'
    loaded.resolve('<svg id="old"/>')

    await expect(handle.promise).resolves.toMatchObject({
      identity: { source: 'old.svg', baseIdentity: 'workspace-a', revision: 'r1' },
      requestEpoch: 1,
      value: '<svg id="old"/>',
    })
    expect(seenAtCall).toEqual({ source: 'old.svg', baseIdentity: 'workspace-a', revision: 'r1' })
    expect(loaderIdentity).not.toBe(mutable)
    handle.release()
    registry.invalidate({ source: 'old.svg', baseIdentity: 'workspace-a', revision: 'r1' })
    expect(registry.snapshot()).toMatchObject({ pending: 0, settled: 0 })
  })

  it('rejects non-string identity fields before loader or registry mutation', () => {
    const loader = vi.fn(async () => '<svg />')
    const registry = new SvgTemplateAssetRegistry({ loader, maxSettled: 2 })
    const malicious = {
      toJSON: vi.fn(() => 'diagram.svg'),
      toString: vi.fn(() => 'diagram.svg'),
    }
    const invalidIdentities = [
      { source: malicious, baseIdentity: 'workspace-a', revision: 'r1' },
      { source: 'diagram.svg', baseIdentity: malicious, revision: 'r1' },
      { source: 'diagram.svg', baseIdentity: 'workspace-a', revision: malicious },
      { source: 1, baseIdentity: 'workspace-a', revision: 'r1' },
      { source: 'diagram.svg', baseIdentity: null, revision: 'r1' },
    ]

    for (const invalid of invalidIdentities) {
      expect(() => registry.acquire(invalid as unknown as SvgTemplateAssetIdentity, 1)).toThrow(/identity|string/i)
    }
    expect(malicious.toJSON).not.toHaveBeenCalled()
    expect(malicious.toString).not.toHaveBeenCalled()
    expect(loader).not.toHaveBeenCalled()
    expect(registry.snapshot()).toEqual({ pending: 0, settled: 0, consumers: 0, authorities: 0, authorityHistory: 0 })
  })

  it('rejects non-string invalidation identities without targeting a matching coerced key', async () => {
    const loader = vi.fn(async () => '<svg id="cached" />')
    const registry = new SvgTemplateAssetRegistry({ loader, maxSettled: 2 })
    const handle = registry.acquire(identity('r1'), 1)
    await handle.promise
    handle.release()
    const maliciousRevision = { toJSON: vi.fn(() => 'r1') }

    expect(() => registry.invalidate({
      source: 'diagram.svg',
      baseIdentity: 'workspace-a',
      revision: maliciousRevision,
    } as unknown as SvgTemplateAssetIdentity)).toThrow(/identity|string/i)
    expect(maliciousRevision.toJSON).not.toHaveBeenCalled()
    expect(registry.snapshot()).toMatchObject({ settled: 1, authorities: 1 })

    const cached = registry.acquire(identity('r1'), 1)
    await expect(cached.promise).resolves.toMatchObject({ value: '<svg id="cached" />' })
    expect(loader).toHaveBeenCalledTimes(1)
    cached.release()
  })

  it('rejects mutable non-string loader values without poisoning the settled cache', async () => {
    const mutableDomLike = { outerHTML: '<svg id="poison" />' }
    const loader = vi.fn()
      .mockResolvedValueOnce(mutableDomLike as unknown as string)
      .mockResolvedValueOnce('<svg id="safe" />')
    const registry = new SvgTemplateAssetRegistry({ loader, maxSettled: 2 })

    const poisoned = registry.acquire(identity('r1'), 1)
    await expect(poisoned.promise).rejects.toThrow(/string/i)
    mutableDomLike.outerHTML = '<svg id="mutated" />'
    poisoned.release()
    expect(registry.snapshot()).toMatchObject({ pending: 0, settled: 0 })

    const retry = registry.acquire(identity('r1'), 1)
    await expect(retry.promise).resolves.toMatchObject({ value: '<svg id="safe" />' })
    expect(loader).toHaveBeenCalledTimes(2)
    retry.release()
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
    expect(registry.snapshot()).toEqual({ pending: 0, settled: 0, consumers: 0, authorities: 0, authorityHistory: 2 })
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
    expect(registry.snapshot()).toEqual({ pending: 0, settled: 0, consumers: 0, authorities: 0, authorityHistory: 1 })
  })

  it('registers pending work before synchronous reentry and aborts after the final release', async () => {
    const loading = deferred<string>()
    const signals: AbortSignal[] = []
    let reentrantHandle: ReturnType<SvgTemplateAssetRegistry['acquire']> | undefined
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
    expect(registry.snapshot()).toEqual({ pending: 1, settled: 0, consumers: 2, authorities: 1, authorityHistory: 0 })
    reentrantHandle!.release()
    expect(signals).toHaveLength(1)
    expect(signals[0].aborted).toBe(false)
    expect(registry.snapshot()).toEqual({ pending: 1, settled: 0, consumers: 1, authorities: 1, authorityHistory: 0 })

    outerHandle.release()
    await Promise.all([
      expect(reentrantHandle!.promise).rejects.toBeInstanceOf(ReleasedSvgTemplateAssetError),
      expect(outerHandle.promise).rejects.toBeInstanceOf(ReleasedSvgTemplateAssetError),
    ])
    expect(signals[0].aborted).toBe(true)
    expect(registry.snapshot()).toEqual({ pending: 0, settled: 0, consumers: 0, authorities: 0, authorityHistory: 1 })
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
    expect(failureRegistry.snapshot()).toEqual({ pending: 0, settled: 0, consumers: 0, authorities: 0, authorityHistory: 1 })
  })

  it('cleans up pending state when the loader throws synchronously', async () => {
    const loaderError = new Error('synchronous loader failure')
    const registry = new SvgTemplateAssetRegistry({
      loader: () => { throw loaderError },
      maxSettled: 2,
    })

    const handle = registry.acquire(identity('sync-throw'), 1)
    expect(registry.snapshot()).toEqual({ pending: 1, settled: 0, consumers: 1, authorities: 1, authorityHistory: 0 })
    await expect(handle.promise).rejects.toBe(loaderError)
    expect(registry.snapshot()).toEqual({ pending: 0, settled: 0, consumers: 0, authorities: 1, authorityHistory: 0 })
    handle.release()
    expect(registry.snapshot()).toEqual({ pending: 0, settled: 0, consumers: 0, authorities: 0, authorityHistory: 1 })
  })

  it('bounds authority metadata across eviction, final release, and invalidation', async () => {
    const registry = new SvgTemplateAssetRegistry({
      loader: async (asset) => asset.revision,
      maxSettled: 2,
    })
    for (let index = 0; index < 20; index += 1) {
      const handle = registry.acquire(identity(`r${index}`, `source-${index}.svg`), index)
      await handle.promise
      handle.release()
    }
    expect(registry.snapshot()).toEqual({ pending: 0, settled: 2, consumers: 0, authorities: 2, authorityHistory: 18 })
    registry.invalidate(identity('r19', 'source-19.svg'))
    expect(registry.snapshot()).toEqual({ pending: 0, settled: 1, consumers: 0, authorities: 1, authorityHistory: 19 })

    const never = new SvgTemplateAssetRegistry({
      loader: () => new Promise(() => {}),
      maxSettled: 2,
    })
    const pending = never.acquire(identity('never'), 1)
    expect(never.snapshot().authorities).toBe(1)
    pending.release()
    expect(never.snapshot()).toEqual({ pending: 0, settled: 0, consumers: 0, authorities: 0, authorityHistory: 1 })
  })

  it('keeps authority through settlement until the handle releases', async () => {
    const registry = new SvgTemplateAssetRegistry({ loader: async () => 'value', maxSettled: 0 })
    const handle = registry.acquire(identity('r1'), 1)
    await expect(handle.promise).resolves.toMatchObject({ value: 'value' })
    expect(registry.snapshot()).toEqual({ pending: 0, settled: 0, consumers: 0, authorities: 1, authorityHistory: 0 })
    handle.release()
    handle.release()
    expect(registry.snapshot()).toEqual({ pending: 0, settled: 0, consumers: 0, authorities: 0, authorityHistory: 1 })
  })

  it('supports StrictMode-style release and replay without reviving stale work', async () => {
    const calls: Array<{ deferred: ReturnType<typeof deferred<string>>; signal: AbortSignal }> = []
    const registry = new SvgTemplateAssetRegistry({
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
  it('rejects epoch rollback after maxSettled-zero cleanup without calling the loader', async () => {
    const loader = vi.fn(async (asset: SvgTemplateAssetIdentity) => asset.revision)
    const registry = new SvgTemplateAssetRegistry({ loader, maxSettled: 0 })
    const current = registry.acquire(identity('r2'), 2)
    await current.promise
    current.release()
    expect(registry.snapshot()).toMatchObject({ authorities: 0, authorityHistory: 1 })

    const stale = registry.acquire(identity('r1'), 1)
    await expect(stale.promise).rejects.toBeInstanceOf(StaleSvgTemplateAssetError)
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('rejects a different revision at the same remembered epoch', async () => {
    const loader = vi.fn(async (asset: SvgTemplateAssetIdentity) => asset.revision)
    const registry = new SvgTemplateAssetRegistry({ loader, maxSettled: 0, maxAuthorityHistory: 4 })
    const current = registry.acquire(identity('bound-revision'), 7)
    await current.promise
    current.release()

    const conflict = registry.acquire(identity('different-revision'), 7)
    await expect(conflict.promise).rejects.toBeInstanceOf(StaleSvgTemplateAssetError)
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('bounds inactive authority history under high-cardinality load', async () => {
    const registry = new SvgTemplateAssetRegistry({
      loader: async (asset) => asset.revision,
      maxSettled: 0,
      maxAuthorityHistory: 2,
    })
    for (let index = 0; index < 20; index += 1) {
      const handle = registry.acquire(identity(`r${index}`, `history-${index}.svg`), index)
      await handle.promise
      handle.release()
    }
    expect(registry.snapshot()).toMatchObject({ authorities: 0, authorityHistory: 2 })
  })

  it('never evicts an active authority while trimming inactive history', async () => {
    const activeLoad = deferred<string>()
    const loader = vi.fn((asset: SvgTemplateAssetIdentity, signal: AbortSignal) => {
      if (asset.source === 'active.svg') {
        signal.addEventListener('abort', () => activeLoad.reject(signal.reason), { once: true })
        return activeLoad.promise
      }
      return Promise.resolve(asset.revision)
    })
    const registry = new SvgTemplateAssetRegistry({ loader, maxSettled: 0, maxAuthorityHistory: 1 })
    const active = registry.acquire(identity('active-r5', 'active.svg'), 5)
    for (const source of ['inactive-a.svg', 'inactive-b.svg']) {
      const handle = registry.acquire(identity('r1', source), 1)
      await handle.promise
      handle.release()
    }
    expect(registry.snapshot()).toEqual({
      pending: 1, settled: 0, consumers: 1, authorities: 1, authorityHistory: 1,
    })
    const stale = registry.acquire(identity('active-r4', 'active.svg'), 4)
    expect(loader).toHaveBeenCalledTimes(3)
    await expect(stale.promise).rejects.toBeInstanceOf(StaleSvgTemplateAssetError)
    active.release()
    await expect(active.promise).rejects.toBeInstanceOf(ReleasedSvgTemplateAssetError)
  })

  it('keeps invalidation fail-closed while allowing an exact current reload', async () => {
    const loads: Array<ReturnType<typeof deferred<string>>> = []
    const loader = vi.fn(() => {
      const load = deferred<string>()
      loads.push(load)
      return load.promise
    })
    const registry = new SvgTemplateAssetRegistry({ loader, maxSettled: 0, maxAuthorityHistory: 4 })
    const invalidated = registry.acquire(identity('r5'), 5)
    registry.invalidate(identity('r5'))
    const reload = registry.acquire(identity('r5'), 5)
    loads[1].resolve('fresh')
    await expect(reload.promise).resolves.toMatchObject({ value: 'fresh', requestEpoch: 5 })
    loads[0].resolve('late')
    await expect(invalidated.promise).rejects.toBeInstanceOf(StaleSvgTemplateAssetError)
    invalidated.release()
    reload.release()

    const rollback = registry.acquire(identity('r4'), 4)
    await expect(rollback.promise).rejects.toBeInstanceOf(StaleSvgTemplateAssetError)
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('defines the bounded stale-detection horizon after LRU eviction', async () => {
    const loader = vi.fn(async (asset: SvgTemplateAssetIdentity) => asset.revision)
    const registry = new SvgTemplateAssetRegistry({ loader, maxSettled: 0, maxAuthorityHistory: 1 })
    for (const [source, revision, epoch] of [
      ['evicted.svg', 'r2', 2],
      ['retained.svg', 'r1', 1],
    ] as const) {
      const handle = registry.acquire(identity(revision, source), epoch)
      await handle.promise
      handle.release()
    }
    const ancientReuse = registry.acquire(identity('r1', 'evicted.svg'), 1)
    await expect(ancientReuse.promise).resolves.toMatchObject({ value: 'r1', requestEpoch: 1 })
    ancientReuse.release()
    expect(loader).toHaveBeenCalledTimes(3)
  })

  it('refreshes retained history recency when a stale request probes an authority', async () => {
    const loader = vi.fn(async (asset: SvgTemplateAssetIdentity) => asset.revision)
    const registry = new SvgTemplateAssetRegistry({ loader, maxSettled: 0, maxAuthorityHistory: 2 })
    for (const source of ['recent-a.svg', 'recent-b.svg']) {
      const handle = registry.acquire(identity('r2', source), 2)
      await handle.promise
      handle.release()
    }
    await expect(registry.acquire(identity('r1', 'recent-a.svg'), 1).promise)
      .rejects.toBeInstanceOf(StaleSvgTemplateAssetError)
    const third = registry.acquire(identity('r2', 'recent-c.svg'), 2)
    await third.promise
    third.release()

    await expect(registry.acquire(identity('r1', 'recent-a.svg'), 1).promise)
      .rejects.toBeInstanceOf(StaleSvgTemplateAssetError)
    const evicted = registry.acquire(identity('r1', 'recent-b.svg'), 1)
    await expect(evicted.promise).resolves.toMatchObject({ value: 'r1' })
    evicted.release()
    expect(loader).toHaveBeenCalledTimes(4)
  })

})
