export interface EntryContent {
  snl?: string
  markdown?: string
  latex?: string
  text?: string
  typst?: string
}

export interface EntryData {
  id: string
  kind: string
  title: string
  content: EntryContent
  contribution_info?: unknown
  pointer?: unknown
}

export interface EntryKind {
  id: string
  name: string
  coloring?: { stroke?: string; background?: string }
  numbering?: string
  style?: string
}

export interface EntrySummary {
  id: string
  title: string
  kind?: string
}

export interface EntryQueryArgs { entry_id: string; signal?: AbortSignal }
export interface EntryKindQueryArgs { kind_id: string; signal?: AbortSignal }

export interface EntryDataQueries {
  query_entry(args: EntryQueryArgs): Promise<EntryData | null>
  query_entry_kind(args: EntryKindQueryArgs): Promise<EntryKind | null>
}

export interface EntryDataDriverOptions {
  queries: EntryDataQueries
  cache_capacity?: number
}

type Cached = EntryData | EntryKind | null

/** Query-only Entry access. Storage, pointer resolution, and host transport stay in adapters. */
export class EntryDataDriver {
  private readonly queries: EntryDataQueries
  private readonly capacity: number
  private readonly cache = new Map<string, Cached>()
  private readonly inflight = new Map<string, Promise<Cached>>()
  private epoch = 0
  private readonly keyEpochs = new Map<string, number>()

  constructor(options: EntryDataDriverOptions) {
    this.queries = options.queries
    const capacity = options.cache_capacity ?? 256
    if (!Number.isInteger(capacity) || capacity < 0) throw new RangeError('cache_capacity must be a non-negative integer')
    this.capacity = capacity
  }

  query_entry(args: EntryQueryArgs): Promise<EntryData | null> {
    return this.query(`entry:${args.entry_id}`, args.signal, () => this.queries.query_entry(args)) as Promise<EntryData | null>
  }

  query_entry_kind(args: EntryKindQueryArgs): Promise<EntryKind | null> {
    return this.query(`kind:${args.kind_id}`, args.signal, () => this.queries.query_entry_kind(args)) as Promise<EntryKind | null>
  }

  clear_cache(id?: string): void {
    if (id === undefined) {
      this.cache.clear(); this.inflight.clear(); this.epoch += 1; this.keyEpochs.clear(); return
    }
    for (const key of [`entry:${id}`, `kind:${id}`]) {
      this.cache.delete(key); this.inflight.delete(key)
      this.keyEpochs.set(key, (this.keyEpochs.get(key) ?? 0) + 1)
    }
  }

  get cache_size(): number { return this.cache.size }

  private async query(key: string, signal: AbortSignal | undefined, backend: () => Promise<Cached>): Promise<Cached> {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    if (this.cache.has(key)) {
      const value = this.cache.get(key)!
      this.cache.delete(key); this.cache.set(key, value)
      return value
    }
    const shared = signal ? undefined : this.inflight.get(key)
    if (shared) return shared
    const epoch = this.epoch
    const keyEpoch = this.keyEpochs.get(key) ?? 0
    const promise = backend().then((value) => {
      if (this.inflight.get(key) === promise) this.inflight.delete(key)
      if (epoch === this.epoch && keyEpoch === (this.keyEpochs.get(key) ?? 0) && !signal?.aborted) {
        this.cache.set(key, value)
        while (this.cache.size > this.capacity) {
          const oldest = this.cache.keys().next().value
          if (oldest !== undefined) this.cache.delete(oldest)
        }
      }
      return value
    }, (error) => {
      if (this.inflight.get(key) === promise) this.inflight.delete(key)
      throw error
    })
    if (!signal) this.inflight.set(key, promise)
    return promise
  }
}
