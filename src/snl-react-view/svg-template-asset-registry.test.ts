import { describe, expect, it, vi } from 'vitest'
import {
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
    expect(registry.snapshot()).toEqual({ pending: 0, settled: 0, consumers: 0 })
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
    expect(registry.snapshot()).toEqual({ pending: 0, settled: 0, consumers: 0 })
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
