/**
 * MacroDataDriver — query-only single-backend macro data source.
 *
 * Design invariants:
 *  - Every lookup goes through the driver's bounded cache or injected queries.
 *  - Bounded per-name hit+miss LRU cache with configurable capacity.
 *  - In-flight request deduplication — concurrent queries for the same name
 *    share a single Promise.
 *  - Errors propagate to callers (no silent swallowing).
 *  - Pure renderers and the View use this as their sole data source.
 */

import type { SnlMacro } from './types'
import { DEFAULT_CONTEXT_READER, type ContextReader, type RenderContext } from '../runtime/render-context'

// ─── Public types ────────────────────────────────────────────────────────────

/** Arguments for a macro query. */
export interface MacroQueryArgs {
  /** The macro name to look up. */
  macro_name: string
  /** Optional AbortSignal for cancellation. */
  signal?: AbortSignal
}

/**
 * The injected queries backend. Consumers implement this to plug in their
 * data source (JSON file, HTTP endpoint, in-memory record, etc.)
 */
export interface MacroDataQueries {
  /** Fetch a single macro by name. Returns null if not found. */
  query_macro(args: MacroQueryArgs): Promise<SnlMacro | null>
}

/** Options for creating a MacroDataDriver. */
export interface MacroDataDriverOptions {
  /** The queries backend to delegate to. */
  queries: MacroDataQueries
  /** Maximum number of entries (hit + miss) to cache. Default: 256. */
  cache_capacity?: number
  context_reader?: ContextReader
}


/**
 * MacroDataDriver — query-only macro data access with bounded cache.
 *
 * Usage:
 * ```ts
 * const driver = new MacroDataDriver({
 *   queries: { query_macro: async ({macro_name}) => myDb[macro_name] ?? null }
 * })
 * const macro = await driver.query_macro({ macro_name: 'FOL.implies' })
 * ```
 */
export class MacroDataDriver {
  private readonly queries: MacroDataQueries
  private readonly cache_capacity: number
  private readonly context_reader: ContextReader

  // LRU cache: Map preserves insertion order. Stores both hits (SnlMacro) and
  // misses (null) so we don't re-query unknown names.
  private readonly cache = new Map<string, SnlMacro | null>()
  // In-flight dedup: concurrent queries for same name share one Promise.
  private readonly inflight = new Map<string, Promise<SnlMacro | null>>()
  private cache_epoch = 0
  private readonly name_epochs = new Map<string, number>()

  constructor(options: MacroDataDriverOptions) {
    this.queries = options.queries
    this.context_reader = options.context_reader ?? DEFAULT_CONTEXT_READER
    const capacity = options.cache_capacity ?? 256
    if (!Number.isInteger(capacity) || capacity < 0) {
      throw new RangeError('cache_capacity must be a non-negative integer')
    }
    this.cache_capacity = capacity
  }

  read_context(): RenderContext {
    return this.context_reader()
  }

  /**
   * Query a single macro by name. Returns null if not found.
   * Uses bounded LRU cache and in-flight dedup.
   */
  async query_macro(args: MacroQueryArgs): Promise<SnlMacro | null> {
    const { macro_name, signal } = args
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    // Check cache (hit or miss)
    if (this.cache.has(macro_name)) {
      const cached = this.cache.get(macro_name)!
      // LRU touch: move to end
      this.cache.delete(macro_name)
      this.cache.set(macro_name, cached)
      return cached
    }

    // Check in-flight dedup
    // A caller-owned signal cannot safely share another caller's request:
    // aborting either subscriber would otherwise affect the other. Deduplicate
    // only unsignalled requests; signalled calls remain independently cancellable.
    const existing = signal ? undefined : this.inflight.get(macro_name)
    if (existing) return existing

    // Launch query
    const cacheEpoch = this.cache_epoch
    const nameEpoch = this.name_epochs.get(macro_name) ?? 0
    const promise = this.queries.query_macro({ macro_name, signal }).then(
      (result) => {
        if (this.inflight.get(macro_name) === promise) this.inflight.delete(macro_name)
        if (
          cacheEpoch === this.cache_epoch &&
          nameEpoch === (this.name_epochs.get(macro_name) ?? 0) &&
          !signal?.aborted
        ) {
          this.cache.set(macro_name, result)
          this.evict()
        }
        return result
      },
      (err) => {
        if (this.inflight.get(macro_name) === promise) this.inflight.delete(macro_name)
        throw err
      },
    )
    if (!signal) this.inflight.set(macro_name, promise)
    return promise
  }


  /**
   * Clear the cache. If `name` is provided, only that entry is cleared.
   * Otherwise clears the entire cache.
   */
  clear_cache(name?: string): void {
    if (name !== undefined) {
      this.cache.delete(name)
      this.inflight.delete(name)
      this.name_epochs.set(name, (this.name_epochs.get(name) ?? 0) + 1)
    } else {
      this.cache.clear()
      this.inflight.clear()
      this.cache_epoch += 1
      this.name_epochs.clear()
    }
  }

  /** Current cache size (for diagnostics). */
  get cache_size(): number {
    return this.cache.size
  }

  private evict(): void {
    while (this.cache.size > this.cache_capacity) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
  }
}
