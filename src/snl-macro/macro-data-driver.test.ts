import { describe, expect, it, vi } from 'vitest'
import { MacroDataDriver } from './macro-data-driver'
import type { MacroDataQueries } from './macro-data-driver'
import type { SnlMacro } from './types'

function makeMacro(name: string): SnlMacro {
  return {
    name,
    description: '',
    source: { entries: [], urls: [] },
    dynamic_arity: false,
    tags: [],
    styles: [{ style_name: 'default',  template: { mode: 'formula_inline', body: '#0' }, tags: [] }],
  }
}

describe('MacroDataDriver', () => {
  it('reads the live color scheme from the constructor context reader', () => {
    let color_scheme: 'light' | 'dark' = 'light'
    const driver = new MacroDataDriver({
      queries: { query_macro: async () => null },
      context_reader: () => ({ color_scheme }),
    })
    expect(driver.read_context()).toEqual({ color_scheme: 'light' })
    color_scheme = 'dark'
    expect(driver.read_context()).toEqual({ color_scheme: 'dark' })
  })

  describe('cache hit/miss', () => {
    it('caches a successful query (hit)', async () => {
      const querySpy = vi.fn(async ({ macro_name }: { macro_name: string }) => makeMacro(macro_name))
      const driver = new MacroDataDriver({ queries: { query_macro: querySpy } })

      const r1 = await driver.query_macro({ macro_name: 'Add' })
      const r2 = await driver.query_macro({ macro_name: 'Add' })
      expect(r1).toEqual(r2)
      expect(querySpy).toHaveBeenCalledTimes(1)
    })

    it('caches a miss (null)', async () => {
      const querySpy = vi.fn(async () => null)
      const driver = new MacroDataDriver({ queries: { query_macro: querySpy } })

      const r1 = await driver.query_macro({ macro_name: 'Unknown' })
      const r2 = await driver.query_macro({ macro_name: 'Unknown' })
      expect(r1).toBeNull()
      expect(r2).toBeNull()
      expect(querySpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('in-flight dedup', () => {
    it('concurrent queries for same name share one backend call', async () => {
      let resolveQuery: ((v: SnlMacro | null) => void) | null = null
      const querySpy = vi.fn(() => new Promise<SnlMacro | null>((r) => { resolveQuery = r }))
      const driver = new MacroDataDriver({ queries: { query_macro: querySpy } })

      const p1 = driver.query_macro({ macro_name: 'Shared' })
      const p2 = driver.query_macro({ macro_name: 'Shared' })
      expect(querySpy).toHaveBeenCalledTimes(1)

      resolveQuery!(makeMacro('Shared'))
      const [r1, r2] = await Promise.all([p1, p2])
      expect(r1).toEqual(r2)
      expect(r1!.name).toBe('Shared')
    })

    it('separate names are not deduped', async () => {
      const querySpy = vi.fn(async ({ macro_name }: { macro_name: string }) => makeMacro(macro_name))
      const driver = new MacroDataDriver({ queries: { query_macro: querySpy } })

      await Promise.all([driver.query_macro({ macro_name: 'A' }), driver.query_macro({ macro_name: 'B' })])
      expect(querySpy).toHaveBeenCalledTimes(2)
    })

    it('does not deduplicate caller-signalled requests', async () => {
      const querySpy = vi.fn(async ({ macro_name }: { macro_name: string }) => makeMacro(macro_name))
      const driver = new MacroDataDriver({ queries: { query_macro: querySpy } })
      const first = new AbortController()
      const second = new AbortController()
      await Promise.all([
        driver.query_macro({ macro_name: 'A', signal: first.signal }),
        driver.query_macro({ macro_name: 'A', signal: second.signal }),
      ])
      expect(querySpy).toHaveBeenCalledTimes(2)
    })
  })

  describe('error propagation', () => {
    it('propagates errors to caller', async () => {
      const driver = new MacroDataDriver({
        queries: { query_macro: async () => { throw new Error('network fail') } },
      })
      await expect(driver.query_macro({ macro_name: 'Bad' })).rejects.toThrow('network fail')
    })

    it('does not cache failed queries', async () => {
      let callCount = 0
      const queries: MacroDataQueries = {
        async query_macro({ macro_name }) {
          callCount++
          if (callCount === 1) throw new Error('transient')
          return makeMacro(macro_name)
        },
      }
      const driver = new MacroDataDriver({ queries })

      await expect(driver.query_macro({ macro_name: 'Retry' })).rejects.toThrow('transient')
      const result = await driver.query_macro({ macro_name: 'Retry' })
      expect(result!.name).toBe('Retry')
      expect(callCount).toBe(2)
    })
  })

  describe('bounded eviction', () => {
    it('rejects invalid cache capacities', () => {
      const queries = { query_macro: async () => null }
      expect(() => new MacroDataDriver({ queries, cache_capacity: -1 })).toThrow(RangeError)
      expect(() => new MacroDataDriver({ queries, cache_capacity: 1.5 })).toThrow(RangeError)
    })

    it('capacity zero performs no persistent caching', async () => {
      const querySpy = vi.fn(async ({ macro_name }: { macro_name: string }) => makeMacro(macro_name))
      const driver = new MacroDataDriver({ queries: { query_macro: querySpy }, cache_capacity: 0 })
      await driver.query_macro({ macro_name: 'A' })
      await driver.query_macro({ macro_name: 'A' })
      expect(driver.cache_size).toBe(0)
      expect(querySpy).toHaveBeenCalledTimes(2)
    })

    it('evicts oldest entries when capacity exceeded', async () => {
      const querySpy = vi.fn(async ({ macro_name }: { macro_name: string }) => makeMacro(macro_name))
      const driver = new MacroDataDriver({ queries: { query_macro: querySpy }, cache_capacity: 3 })

      await driver.query_macro({ macro_name: 'A' })
      await driver.query_macro({ macro_name: 'B' })
      await driver.query_macro({ macro_name: 'C' })
      expect(driver.cache_size).toBe(3)

      await driver.query_macro({ macro_name: 'D' }) // should evict A
      expect(driver.cache_size).toBe(3)

      // A should be re-queried from backend
      querySpy.mockClear()
      await driver.query_macro({ macro_name: 'A' })
      expect(querySpy).toHaveBeenCalledWith(expect.objectContaining({ macro_name: 'A' }))
    })

    it('LRU touch prevents eviction of recently accessed', async () => {
      const querySpy = vi.fn(async ({ macro_name }: { macro_name: string }) => makeMacro(macro_name))
      const driver = new MacroDataDriver({ queries: { query_macro: querySpy }, cache_capacity: 3 })

      await driver.query_macro({ macro_name: 'A' })
      await driver.query_macro({ macro_name: 'B' })
      await driver.query_macro({ macro_name: 'C' })

      // Touch A (moves to end of LRU)
      await driver.query_macro({ macro_name: 'A' })
      // Add D → should evict B (oldest untouched)
      await driver.query_macro({ macro_name: 'D' })

      querySpy.mockClear()
      await driver.query_macro({ macro_name: 'A' }) // should be cached
      expect(querySpy).not.toHaveBeenCalled()
      await driver.query_macro({ macro_name: 'B' }) // should need re-query
      expect(querySpy).toHaveBeenCalledWith(expect.objectContaining({ macro_name: 'B' }))
    })
  })

  describe('clear_cache', () => {
    it('clear_cache() clears all', async () => {
      const querySpy = vi.fn(async ({ macro_name }: { macro_name: string }) => makeMacro(macro_name))
      const driver = new MacroDataDriver({ queries: { query_macro: querySpy } })

      await driver.query_macro({ macro_name: 'A' })
      await driver.query_macro({ macro_name: 'B' })
      driver.clear_cache()
      expect(driver.cache_size).toBe(0)

      querySpy.mockClear()
      await driver.query_macro({ macro_name: 'A' })
      expect(querySpy).toHaveBeenCalledTimes(1)
    })

    it('clear_cache(name) clears only that entry', async () => {
      const querySpy = vi.fn(async ({ macro_name }: { macro_name: string }) => makeMacro(macro_name))
      const driver = new MacroDataDriver({ queries: { query_macro: querySpy } })

      await driver.query_macro({ macro_name: 'A' })
      await driver.query_macro({ macro_name: 'B' })
      driver.clear_cache('A')
      expect(driver.cache_size).toBe(1)

      querySpy.mockClear()
      await driver.query_macro({ macro_name: 'A' })
      expect(querySpy).toHaveBeenCalledTimes(1)
      await driver.query_macro({ macro_name: 'B' })
      expect(querySpy).toHaveBeenCalledTimes(1) // B still cached
    })

    it('does not let a cleared in-flight request repopulate the cache', async () => {
      let resolveQuery: ((value: SnlMacro | null) => void) | undefined
      const querySpy = vi.fn(() => new Promise<SnlMacro | null>((resolve) => { resolveQuery = resolve }))
      const driver = new MacroDataDriver({ queries: { query_macro: querySpy } })

      const stale = driver.query_macro({ macro_name: 'A' })
      driver.clear_cache('A')
      resolveQuery!(makeMacro('A'))
      await stale
      expect(driver.cache_size).toBe(0)
    })
  })
})
