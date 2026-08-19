export interface SvgTemplateAssetIdentity {
  readonly source: string
  readonly baseIdentity: string
  readonly revision: string
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
  maxAuthorityHistory?: number
}

export interface SvgTemplateAssetHandle<T> {
  promise: Promise<SvgTemplateAssetResult<T>>
  release(): void
}

interface AuthorityState {
  requestEpoch: number
  identityKey: string
  generation: number
  references: number
}

interface AuthorityHistoryEntry {
  requestEpoch: number
  identityKey: string
}

interface PendingEntry<T> {
  controller: AbortController
  consumers: number
  promise: Promise<T>
  authority: string
  authorityState: AuthorityState
}

interface SettledEntry<T> {
  value: T
  authority: string
  authorityState: AuthorityState
}

export class StaleSvgTemplateAssetError extends Error {
  constructor() {
    super('SVG template asset result is stale for the current identity or request epoch')
    this.name = 'StaleSvgTemplateAssetError'
  }
}

export class ReleasedSvgTemplateAssetError extends StaleSvgTemplateAssetError {
  constructor() {
    super()
    this.message = 'SVG template asset handle was released before its result settled'
    this.name = 'ReleasedSvgTemplateAssetError'
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
  private readonly maxAuthorityHistory: number
  private readonly pending = new Map<string, PendingEntry<T>>()
  private readonly settled = new Map<string, SettledEntry<T>>()
  private readonly authorities = new Map<string, AuthorityState>()
  private readonly authorityHistory = new Map<string, AuthorityHistoryEntry>()
  private nextGeneration = 0

  constructor(options: SvgTemplateAssetRegistryOptions<T>) {
    if (!Number.isSafeInteger(options.maxSettled) || options.maxSettled < 0) {
      throw new Error('SVG template asset settled cache bound must be a non-negative safe integer')
    }
    const maxAuthorityHistory = options.maxAuthorityHistory ?? Math.max(32, options.maxSettled * 2)
    if (!Number.isSafeInteger(maxAuthorityHistory) || maxAuthorityHistory < 0) {
      throw new Error('SVG template asset authority history bound must be a non-negative safe integer')
    }
    this.loader = options.loader
    this.maxSettled = options.maxSettled
    this.maxAuthorityHistory = maxAuthorityHistory
  }

  acquire(identity: SvgTemplateAssetIdentity, requestEpoch: number): SvgTemplateAssetHandle<T> {
    const identitySnapshot: SvgTemplateAssetIdentity = { ...identity }
    assertIdentity(identitySnapshot, requestEpoch)
    const key = identityKey(identitySnapshot)
    const authority = authorityKey(identitySnapshot)
    let state = this.authorities.get(authority)
    const remembered = state ? undefined : this.authorityHistory.get(authority)
    if (remembered) {
      this.authorityHistory.delete(authority)
      this.authorityHistory.set(authority, remembered)
    }
    const currentEpoch = state?.requestEpoch ?? remembered?.requestEpoch
    const currentIdentityKey = state?.identityKey ?? remembered?.identityKey
    if (currentEpoch !== undefined && (
      requestEpoch < currentEpoch
      || (requestEpoch === currentEpoch && key !== currentIdentityKey)
    )) {
      return { promise: Promise.reject(new StaleSvgTemplateAssetError()), release() {} }
    }
    if (!state) {
      this.authorityHistory.delete(authority)
      state = {
        requestEpoch,
        identityKey: key,
        generation: this.newGeneration(),
        references: 0,
      }
      this.authorities.set(authority, state)
    } else if (requestEpoch > state.requestEpoch) {
      state.requestEpoch = requestEpoch
      state.identityKey = key
      state.generation = this.newGeneration()
    }
    const handleGeneration = state.generation

    const cached = this.settled.get(key)
    if (cached) {
      this.settled.delete(key)
      this.settled.set(key, cached)
      return this.createHandle(
        identitySnapshot,
        requestEpoch,
        authority,
        state,
        handleGeneration,
        Promise.resolve(cached.value),
        () => {},
      )
    }

    let entry = this.pending.get(key)
    if (!entry) {
      const controller = new AbortController()
      let resolveLoader!: (value: T | PromiseLike<T>) => void
      let rejectLoader!: (reason?: unknown) => void
      const loaderPromise = new Promise<T>((resolve, reject) => {
        resolveLoader = resolve
        rejectLoader = reject
      })
      entry = {
        controller,
        consumers: 1,
        promise: loaderPromise,
        authority,
        authorityState: state,
      }
      this.retainAuthority(state)
      this.pending.set(key, entry)
      const ownedEntry = entry
      entry.promise.then((value) => {
        if (!this.takePending(key, ownedEntry)) return
        if (ownedEntry.consumers > 0 && !ownedEntry.controller.signal.aborted && this.maxSettled > 0) {
          this.settled.set(key, {
            value,
            authority: ownedEntry.authority,
            authorityState: ownedEntry.authorityState,
          })
          this.trimSettled()
        } else {
          this.releaseAuthority(ownedEntry.authority, ownedEntry.authorityState)
        }
      }, () => {
        this.discardPending(key, ownedEntry)
      })
      try {
        Promise.resolve(this.loader(identitySnapshot, controller.signal)).then(resolveLoader, rejectLoader)
      } catch (error) {
        rejectLoader(error)
      }
    } else {
      entry.consumers += 1
    }
    const ownedEntry = entry
    return this.createHandle(
      identitySnapshot,
      requestEpoch,
      authority,
      state,
      handleGeneration,
      entry.promise,
      () => {
        ownedEntry.consumers -= 1
        if (ownedEntry.consumers === 0) {
          this.discardPending(
            key,
            ownedEntry,
            new DOMException('Last SVG template asset consumer detached', 'AbortError'),
          )
        }
      },
    )
  }

  invalidate(identity: SvgTemplateAssetIdentity): void {
    const key = identityKey(identity)
    const authority = authorityKey(identity)
    const state = this.authorities.get(authority)
    if (state?.identityKey === key) state.generation = this.newGeneration()

    const cached = this.settled.get(key)
    if (cached) {
      this.settled.delete(key)
      this.releaseAuthority(cached.authority, cached.authorityState)
    }
    const entry = this.pending.get(key)
    if (entry) {
      this.discardPending(key, entry, new DOMException('SVG template asset invalidated', 'AbortError'))
    }
  }

  snapshot(): { pending: number; settled: number; consumers: number; authorities: number; authorityHistory: number } {
    let consumers = 0
    for (const entry of this.pending.values()) consumers += entry.consumers
    return {
      pending: this.pending.size,
      settled: this.settled.size,
      consumers,
      authorities: this.authorities.size,
      authorityHistory: this.authorityHistory.size,
    }
  }

  private createHandle(
    identity: SvgTemplateAssetIdentity,
    requestEpoch: number,
    authority: string,
    state: AuthorityState,
    generation: number,
    promise: Promise<T>,
    onRelease: () => void,
  ): SvgTemplateAssetHandle<T> {
    let released = false
    this.retainAuthority(state)
    const result = promise.then((value): SvgTemplateAssetResult<T> => {
      if (released) throw new ReleasedSvgTemplateAssetError()
      if (this.authorities.get(authority) !== state || state.generation !== generation) {
        throw new StaleSvgTemplateAssetError()
      }
      return { identity: { ...identity }, requestEpoch, value }
    }, (error: unknown) => {
      if (released) throw new ReleasedSvgTemplateAssetError()
      throw error
    })
    return {
      promise: result,
      release: () => {
        if (released) return
        released = true
        onRelease()
        this.releaseAuthority(authority, state)
      },
    }
  }

  private takePending(key: string, entry: PendingEntry<T>): boolean {
    if (this.pending.get(key) !== entry) return false
    this.pending.delete(key)
    return true
  }

  private discardPending(key: string, entry: PendingEntry<T>, abortReason?: DOMException): boolean {
    if (!this.takePending(key, entry)) return false
    this.releaseAuthority(entry.authority, entry.authorityState)
    if (abortReason && !entry.controller.signal.aborted) entry.controller.abort(abortReason)
    return true
  }

  private newGeneration(): number {
    this.nextGeneration += 1
    return this.nextGeneration
  }

  private retainAuthority(state: AuthorityState): void {
    state.references += 1
  }

  private releaseAuthority(authority: string, state: AuthorityState): void {
    state.references -= 1
    if (state.references === 0 && this.authorities.get(authority) === state) {
      this.authorities.delete(authority)
      this.rememberAuthority(authority, state)
    }
  }

  private rememberAuthority(authority: string, state: AuthorityState): void {
    if (this.maxAuthorityHistory === 0) return
    this.authorityHistory.delete(authority)
    this.authorityHistory.set(authority, {
      requestEpoch: state.requestEpoch,
      identityKey: state.identityKey,
    })
    while (this.authorityHistory.size > this.maxAuthorityHistory) {
      const oldest = this.authorityHistory.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.authorityHistory.delete(oldest)
    }
  }

  private trimSettled(): void {
    while (this.settled.size > this.maxSettled) {
      const oldest = this.settled.keys().next().value as string | undefined
      if (oldest === undefined) break
      const entry = this.settled.get(oldest)
      this.settled.delete(oldest)
      if (entry) this.releaseAuthority(entry.authority, entry.authorityState)
    }
  }
}
