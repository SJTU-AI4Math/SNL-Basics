export interface SvgTemplateAssetIdentity {
  readonly source: string
  readonly baseIdentity: string
  readonly revision: string
}

export interface SvgTemplateAssetResult {
  identity: SvgTemplateAssetIdentity
  requestEpoch: number
  value: string
}

export type SvgTemplateAssetLoader = (
  identity: SvgTemplateAssetIdentity,
  signal: AbortSignal,
) => Promise<string>

export interface SvgTemplateAssetRegistryOptions {
  loader: SvgTemplateAssetLoader
  maxSettled: number
  maxAuthorityHistory?: number
}

export interface SvgTemplateAssetHandle {
  promise: Promise<SvgTemplateAssetResult>
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

interface PendingEntry {
  controller: AbortController
  consumers: number
  promise: Promise<string>
  authority: string
  authorityState: AuthorityState
  generation: number
}

interface SettledEntry {
  value: string
  authority: string
  authorityState: AuthorityState
  generation: number
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

function snapshotIdentity(identity: SvgTemplateAssetIdentity): SvgTemplateAssetIdentity {
  const source = identity.source
  const baseIdentity = identity.baseIdentity
  const revision = identity.revision
  if (
    typeof source !== 'string' || !source
    || typeof baseIdentity !== 'string' || !baseIdentity
    || typeof revision !== 'string' || !revision
  ) {
    throw new Error('SVG template asset identity requires non-empty string source, baseIdentity, and revision')
  }
  return Object.freeze({ source, baseIdentity, revision })
}

function assertRequestEpoch(requestEpoch: number): void {
  if (!Number.isSafeInteger(requestEpoch) || requestEpoch < 0) {
    throw new Error('SVG template asset request epoch must be a non-negative safe integer')
  }
}

function assertSvgSourceString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('SVG template asset loader must resolve to a raw source string')
  }
  return value
}

/**
 * Caches immutable raw SVG source strings only. Parse and sanitize a fresh DOM
 * per consumer after retrieval; mutable parsed DOM must never enter this cache.
 */
export class SvgTemplateAssetRegistry {
  private readonly loader: SvgTemplateAssetLoader
  private readonly maxSettled: number
  private readonly maxAuthorityHistory: number
  private readonly pending = new Map<string, PendingEntry>()
  private readonly settled = new Map<string, SettledEntry>()
  private readonly authorities = new Map<string, AuthorityState>()
  private readonly authorityHistory = new Map<string, AuthorityHistoryEntry>()
  private nextGeneration = 0

  constructor(options: SvgTemplateAssetRegistryOptions) {
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

  acquire(identity: SvgTemplateAssetIdentity, requestEpoch: number): SvgTemplateAssetHandle {
    const identitySnapshot = snapshotIdentity(identity)
    assertRequestEpoch(requestEpoch)
    const key = identityKey(identitySnapshot)
    const authority = authorityKey(identitySnapshot)
    let state = this.authorities.get(authority)
    let holdsAuthority = false
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
      const previousState = state
      previousState.generation = this.newGeneration()
      state = {
        requestEpoch,
        identityKey: key,
        generation: this.newGeneration(),
        references: 0,
      }
      this.authorities.set(authority, state)
      this.retainAuthority(state)
      holdsAuthority = true
      const acquisitionGeneration = state.generation
      this.discardAuthorityEntries(authority, previousState)
      if (this.authorities.get(authority) !== state || state.generation !== acquisitionGeneration) {
        this.releaseAuthority(authority, state)
        holdsAuthority = false
        return { promise: Promise.reject(new StaleSvgTemplateAssetError()), release() {} }
      }
    }
    if (!holdsAuthority) {
      this.retainAuthority(state)
      holdsAuthority = true
    }
    const handleGeneration = state.generation

    try {
      let cached = this.settled.get(key)
      if (cached && !this.entryOwnsAuthority(cached, authority, state, handleGeneration)) {
        if (this.settled.get(key) === cached) {
          this.settled.delete(key)
          this.releaseAuthority(cached.authority, cached.authorityState)
        }
        cached = undefined
        if (!this.isCurrentAuthority(authority, state, handleGeneration)) {
          return { promise: Promise.reject(new StaleSvgTemplateAssetError()), release() {} }
        }
      }
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
      while (entry && !this.entryOwnsAuthority(entry, authority, state, handleGeneration)) {
        this.discardPending(
          key,
          entry,
          new DOMException('Detached SVG template asset work cannot be reused', 'AbortError'),
        )
        if (!this.isCurrentAuthority(authority, state, handleGeneration)) {
          return { promise: Promise.reject(new StaleSvgTemplateAssetError()), release() {} }
        }
        entry = this.pending.get(key)
      }
      if (!entry) {
        const controller = new AbortController()
        let resolveLoader!: (value: string | PromiseLike<string>) => void
        let rejectLoader!: (reason?: unknown) => void
        const loaderPromise = new Promise<string>((resolve, reject) => {
          resolveLoader = resolve
          rejectLoader = reject
        })
        entry = {
          controller,
          consumers: 1,
          promise: loaderPromise,
          authority,
          authorityState: state,
          generation: handleGeneration,
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
              generation: ownedEntry.generation,
            })
            this.trimSettled()
          } else {
            this.releaseAuthority(ownedEntry.authority, ownedEntry.authorityState)
          }
        }, () => {
          this.discardPending(key, ownedEntry)
        })
        try {
          Promise.resolve(this.loader({ ...identitySnapshot }, controller.signal))
            .then(assertSvgSourceString)
            .then(resolveLoader, rejectLoader)
        } catch (error) {
          rejectLoader(error)
        }
        if (!this.isCurrentAuthority(authority, state, handleGeneration)) {
          ownedEntry.consumers -= 1
          if (ownedEntry.consumers === 0) {
            this.discardPending(
              key,
              ownedEntry,
              new DOMException('SVG template asset authority changed during loader invocation', 'AbortError'),
            )
          }
          return { promise: Promise.reject(new StaleSvgTemplateAssetError()), release() {} }
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
    } finally {
      if (holdsAuthority) this.releaseAuthority(authority, state)
    }
  }

  invalidate(identity: SvgTemplateAssetIdentity): void {
    const identitySnapshot = snapshotIdentity(identity)
    const key = identityKey(identitySnapshot)
    const authority = authorityKey(identitySnapshot)
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
    promise: Promise<string>,
    onRelease: () => void,
  ): SvgTemplateAssetHandle {
    let released = false
    this.retainAuthority(state)
    const result = promise.then((value): SvgTemplateAssetResult => {
      if (released) throw new ReleasedSvgTemplateAssetError()
      if (this.authorities.get(authority) !== state || state.generation !== generation) {
        throw new StaleSvgTemplateAssetError()
      }
      return { identity, requestEpoch, value }
    }, (error: unknown) => {
      if (released) throw new ReleasedSvgTemplateAssetError()
      if (this.authorities.get(authority) !== state || state.generation !== generation) {
        throw new StaleSvgTemplateAssetError()
      }
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

  private isCurrentAuthority(
    authority: string,
    state: AuthorityState,
    generation: number,
  ): boolean {
    return this.authorities.get(authority) === state && state.generation === generation
  }

  private entryOwnsAuthority(
    entry: PendingEntry | SettledEntry,
    authority: string,
    state: AuthorityState,
    generation: number,
  ): boolean {
    return entry.authority === authority
      && entry.authorityState === state
      && entry.generation === generation
  }

  private takePending(key: string, entry: PendingEntry): boolean {
    if (this.pending.get(key) !== entry) return false
    this.pending.delete(key)
    return true
  }

  private discardPending(key: string, entry: PendingEntry, abortReason?: DOMException): boolean {
    if (!this.takePending(key, entry)) return false
    this.releaseAuthority(entry.authority, entry.authorityState)
    if (abortReason && !entry.controller.signal.aborted) entry.controller.abort(abortReason)
    return true
  }

  private discardAuthorityEntries(authority: string, state: AuthorityState): void {
    const abortReason = new DOMException('SVG template asset request epoch advanced', 'AbortError')
    for (const [key, entry] of Array.from(this.pending.entries())) {
      if (entry.authority === authority && entry.authorityState === state) {
        this.discardPending(key, entry, abortReason)
      }
    }
    for (const [key, entry] of Array.from(this.settled.entries())) {
      if (entry.authority === authority && entry.authorityState === state) {
        this.settled.delete(key)
        this.releaseAuthority(entry.authority, entry.authorityState)
      }
    }
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
