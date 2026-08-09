import {
  is_i18n,
  read_localized,
  type LanguageEnvironment,
  type Localized,
  type ReaderM,
  type ReaderRuntime,
} from '../runtime'
import { DEFAULT_CONTEXT_READER, type ContextReader, type RenderContext } from '../runtime/render-context'
import type { CompatibleKindColoring } from '../snl-react-view/kind-palette'

export interface EntryContent {
  snl?: string
  markdown?: Localized<string, string>
  latex?: Localized<string, string>
  text?: Localized<string, string>
  typst?: Localized<string, string>
}

export interface ResolvedEntryContent {
  snl?: string
  markdown?: string
  latex?: string
  text?: string
  typst?: string
}

/** Resolve every non-SNL channel from consumer-owned language preferences. */
export function read_entry_content(
  content: EntryContent,
): ReaderM<LanguageEnvironment<string>, ResolvedEntryContent> {
  return (environment) => {
    const resolved: ResolvedEntryContent = {}
    if (content.snl !== undefined) resolved.snl = content.snl
    if (content.markdown !== undefined) {
      resolved.markdown = read_localized(content.markdown)(environment)
    }
    if (content.latex !== undefined) {
      resolved.latex = read_localized(content.latex)(environment)
    }
    if (content.text !== undefined) {
      resolved.text = read_localized(content.text)(environment)
    }
    if (content.typst !== undefined) {
      resolved.typst = read_localized(content.typst)(environment)
    }
    return resolved
  }
}

/** Execute Entry-content localization at a renderer boundary. */
export function resolve_entry_content(
  content: EntryContent,
  reader_runtime?: ReaderRuntime<LanguageEnvironment<string>>,
): ResolvedEntryContent {
  const localized = [content.markdown, content.latex, content.text, content.typst]
    .some((value) => value !== undefined && is_i18n(value))
  if (localized && !reader_runtime) {
    throw new Error('localized Entry content requires reader_runtime')
  }
  if (reader_runtime) return reader_runtime.run_reader(read_entry_content(content))
  return read_entry_content(content)({ language: '' })
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
  coloring?: CompatibleKindColoring
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
  context_reader?: ContextReader
}

type Cached = EntryData | EntryKind | null

/** Query-only Entry access. Storage, pointer resolution, and host transport stay in adapters. */
export class EntryDataDriver {
  private readonly queries: EntryDataQueries
  private readonly capacity: number
  private readonly context_reader: ContextReader
  private readonly cache = new Map<string, Cached>()
  private readonly inflight = new Map<string, Promise<Cached>>()
  private epoch = 0
  private readonly keyEpochs = new Map<string, number>()

  constructor(options: EntryDataDriverOptions) {
    this.queries = options.queries
    this.context_reader = options.context_reader ?? DEFAULT_CONTEXT_READER
    const capacity = options.cache_capacity ?? 256
    if (!Number.isInteger(capacity) || capacity < 0) throw new RangeError('cache_capacity must be a non-negative integer')
    this.capacity = capacity
  }

  read_context(): RenderContext {
    return this.context_reader()
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
