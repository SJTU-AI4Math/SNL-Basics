export interface SvgTemplateAssetIdentity {
  source: string
  baseIdentity: string
  revision: string
}

export interface SvgTemplateAssetResult<T> {
  identity: SvgTemplateAssetIdentity
  requestEpoch: number
  value: T
}

export type SvgTemplateAssetLoader<T> = (
  identity: SvgTemplateAssetIdentity,
  signal: AbortSignal,
) => Promise<T>

export interface SvgTemplateAssetRegistryOptions<T> {
  loader: SvgTemplateAssetLoader<T>
  maxSettled: number
}

export interface SvgTemplateAssetHandle<T> {
  promise: Promise<SvgTemplateAssetResult<T>>
  release(): void
}

interface PendingEntry<T> {
  controller: AbortController
  consumers: number
  promise: Promise<T>
}

interface SettledEntry<T> {
  value: T
}

export class StaleSvgTemplateAssetError extends Error {
  constructor() {
    super('SVG template asset result is stale for the current identity or request epoch')
    this.name = 'StaleSvgTemplateAssetError'
  }
}

function identityKey(identity: SvgTemplateAssetIdentity): string {
  return JSON.stringify([identity.baseIdentity, identity.source, identity.revision])
}

function authorityKey(identity: SvgTemplateAssetIdentity): string {
  return JSON.stringify([identity.baseIdentity, identity.source])
}

function assertIdentity(identity: SvgTemplateAssetIdentity, requestEpoch: number): void {
  if (!identity.source || !identity.baseIdentity || !identity.revision) {
    throw new Error('SVG template asset identity requires source, baseIdentity, and revision')
  }
  if (!Number.isSafeInteger(requestEpoch) || requestEpoch < 0) {
    throw new Error('SVG template asset request epoch must be a non-negative safe integer')
  }
}

export class SvgTemplateAssetRegistry<T = string> {
  private readonly loader: SvgTemplateAssetLoader<T>
  private readonly maxSettled: number
  private readonly pending = new Map<string, PendingEntry<T>>()
  private readonly settled = new Map<string, SettledEntry<T>>()
  private readonly latest = new Map<string, { requestEpoch: number; identityKey: string }>()

  constructor(options: SvgTemplateAssetRegistryOptions<T>) {
    if (!Number.isSafeInteger(options.maxSettled) || options.maxSettled < 0) {
      throw new Error('SVG template asset settled cache bound must be a non-negative safe integer')
    }
    this.loader = options.loader
    this.maxSettled = options.maxSettled
  }

  acquire(identity: SvgTemplateAssetIdentity, requestEpoch: number): SvgTemplateAssetHandle<T> {
    assertIdentity(identity, requestEpoch)
    const key = identityKey(identity)
    const authority = authorityKey(identity)
    const previous = this.latest.get(authority)
    if (previous && requestEpoch < previous.requestEpoch) {
      return { promise: Promise.reject(new StaleSvgTemplateAssetError()), release() {} }
    }
    if (!previous || requestEpoch > previous.requestEpoch || previous.identityKey !== key) {
      this.latest.set(authority, { requestEpoch, identityKey: key })
    }

    const cached = this.settled.get(key)
    if (cached) {
      this.settled.delete(key)
      this.settled.set(key, cached)
      return {
        promise: this.resultFor(identity, requestEpoch, Promise.resolve(cached.value)),
        release() {},
      }
    }

    let entry = this.pending.get(key)
    if (!entry) {
      const controller = new AbortController()
      let loaderPromise: Promise<T>
      try {
        loaderPromise = Promise.resolve(this.loader({ ...identity }, controller.signal))
      } catch (error) {
        loaderPromise = Promise.reject(error)
      }
      entry = {
        controller,
        consumers: 0,
        promise: loaderPromise,
      }
      this.pending.set(key, entry)
      const ownedEntry = entry
      entry.promise.then((value) => {
        if (this.pending.get(key) !== ownedEntry) return
        this.pending.delete(key)
        if (ownedEntry.consumers > 0 && !ownedEntry.controller.signal.aborted && this.maxSettled > 0) {
          this.settled.set(key, { value })
          this.trimSettled()
        }
      }, () => {
        if (this.pending.get(key) === ownedEntry) this.pending.delete(key)
      })
    }
    entry.consumers += 1
    let released = false
    const ownedEntry = entry
    return {
      promise: this.resultFor(identity, requestEpoch, entry.promise),
      release: () => {
        if (released) return
        released = true
        ownedEntry.consumers -= 1
        if (ownedEntry.consumers === 0 && this.pending.get(key) === ownedEntry) {
          this.pending.delete(key)
          ownedEntry.controller.abort(new DOMException('Last SVG template asset consumer detached', 'AbortError'))
        }
      },
    }
  }

  invalidate(identity: SvgTemplateAssetIdentity): void {
    const key = identityKey(identity)
    this.settled.delete(key)
    const entry = this.pending.get(key)
    if (entry) {
      this.pending.delete(key)
      entry.controller.abort(new DOMException('SVG template asset invalidated', 'AbortError'))
    }
    const authority = authorityKey(identity)
    if (this.latest.get(authority)?.identityKey === key) this.latest.delete(authority)
  }

  snapshot(): { pending: number; settled: number; consumers: number } {
    let consumers = 0
    for (const entry of this.pending.values()) consumers += entry.consumers
    return { pending: this.pending.size, settled: this.settled.size, consumers }
  }

  private async resultFor(
    identity: SvgTemplateAssetIdentity,
    requestEpoch: number,
    promise: Promise<T>,
  ): Promise<SvgTemplateAssetResult<T>> {
    const value = await promise
    const latest = this.latest.get(authorityKey(identity))
    if (!latest || latest.requestEpoch !== requestEpoch || latest.identityKey !== identityKey(identity)) {
      throw new StaleSvgTemplateAssetError()
    }
    return { identity: { ...identity }, requestEpoch, value }
  }

  private trimSettled(): void {
    while (this.settled.size > this.maxSettled) {
      const oldest = this.settled.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.settled.delete(oldest)
    }
  }
}
