import { describe, expect, it, vi } from 'vitest'
import { EntryDataDriver, type EntryData } from './entry-data-driver'

const entry = (id: string): EntryData => ({ id, kind: 'definition', title: id, content: {} })

describe('EntryDataDriver', () => {
  it('deduplicates unsignalled requests and caches hits and misses', async () => {
    const query_entry = vi.fn(async ({ entry_id }: { entry_id: string }) => entry_id === 'x' ? entry('x') : null)
    const driver = new EntryDataDriver({ queries: { query_entry, query_entry_kind: async () => null } })
    expect(await Promise.all([driver.query_entry({ entry_id: 'x' }), driver.query_entry({ entry_id: 'x' })])).toEqual([entry('x'), entry('x')])
    await driver.query_entry({ entry_id: 'missing' })
    await driver.query_entry({ entry_id: 'missing' })
    expect(query_entry).toHaveBeenCalledTimes(2)
  })

  it('validates capacity and supports a zero-capacity cache', async () => {
    expect(() => new EntryDataDriver({ queries: { query_entry: async () => null, query_entry_kind: async () => null }, cache_capacity: -1 })).toThrow(RangeError)
    const query_entry = vi.fn(async () => entry('x'))
    const driver = new EntryDataDriver({ queries: { query_entry, query_entry_kind: async () => null }, cache_capacity: 0 })
    await driver.query_entry({ entry_id: 'x' }); await driver.query_entry({ entry_id: 'x' })
    expect(query_entry).toHaveBeenCalledTimes(2)
    expect(driver.cache_size).toBe(0)
  })

  it('does not couple caller-owned abort signals', async () => {
    const signals: (AbortSignal | undefined)[] = []
    const query_entry = vi.fn(({ signal }: { signal?: AbortSignal }) => { signals.push(signal); return new Promise<EntryData | null>(() => {}) })
    const driver = new EntryDataDriver({ queries: { query_entry, query_entry_kind: async () => null } })
    const a = new AbortController(); const b = new AbortController()
    void driver.query_entry({ entry_id: 'x', signal: a.signal }); void driver.query_entry({ entry_id: 'x', signal: b.signal })
    expect(query_entry).toHaveBeenCalledTimes(2)
    a.abort()
    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)
  })

  it('clear_cache prevents stale in-flight completion from repopulating cache', async () => {
    let resolve!: (value: EntryData | null) => void
    const query_entry = vi.fn(() => new Promise<EntryData | null>((r) => { resolve = r }))
    const driver = new EntryDataDriver({ queries: { query_entry, query_entry_kind: async () => null } })
    const pending = driver.query_entry({ entry_id: 'x' })
    driver.clear_cache('x')
    resolve(entry('old')); await pending
    expect(driver.cache_size).toBe(0)
  })

  it('uses one bounded LRU across entries and kinds', async () => {
    const query_entry = vi.fn(async ({ entry_id }: { entry_id: string }) => entry(entry_id))
    const query_entry_kind = vi.fn(async (args: { kind_id: string }) => ({ id: args.kind_id, name: args.kind_id }))
    const driver = new EntryDataDriver({ queries: { query_entry, query_entry_kind }, cache_capacity: 2 })
    await driver.query_entry({ entry_id: 'a' })
    await driver.query_entry_kind({ kind_id: 'k' })
    await driver.query_entry({ entry_id: 'a' })
    await driver.query_entry({ entry_id: 'b' })
    await driver.query_entry_kind({ kind_id: 'k' })
    expect(query_entry).toHaveBeenCalledTimes(2)
    expect(query_entry_kind).toHaveBeenCalledTimes(2)
  })

  it('protects whole-cache clear races and allows a fresh request immediately', async () => {
    const resolvers: Array<(value: EntryData | null) => void> = []
    const query_entry = vi.fn(() => new Promise<EntryData | null>((resolve) => resolvers.push(resolve)))
    const driver = new EntryDataDriver({ queries: { query_entry, query_entry_kind: async () => null } })
    const stale = driver.query_entry({ entry_id: 'x' })
    driver.clear_cache()
    const fresh = driver.query_entry({ entry_id: 'x' })
    expect(query_entry).toHaveBeenCalledTimes(2)
    resolvers[0](entry('old')); await stale
    resolvers[1](entry('new')); await fresh
    expect((await driver.query_entry({ entry_id: 'x' }))?.title).toBe('new')
    expect(query_entry).toHaveBeenCalledTimes(2)
  })

  it('queries kinds and propagates backend errors', async () => {
    const driver = new EntryDataDriver({ queries: {
      query_entry: async () => { throw new Error('offline') },
      query_entry_kind: async ({ kind_id }) => ({ id: kind_id, name: 'Definition', coloring: { stroke: '#123', background: 'transparent' } }),
    } })
    await expect(driver.query_entry({ entry_id: 'x' })).rejects.toThrow('offline')
    expect((await driver.query_entry_kind({ kind_id: 'definition' }))?.name).toBe('Definition')
  })
})
