import { describe, expect, it, vi } from 'vitest'
import { parseSnlSyntaxTree } from '../snl-react-view/parse'
import { EntryDataDriver } from './entry-data-driver'
import { extractExportedBinders, resolveEntryContextSources } from './context-source'

describe('query-driven Entry context source lookup', () => {
  it('exports binder overrides and temporary payload names, never coordinates', () => {
    expect(extractExportedBinders('root(@x@alias,@$y$)')).toEqual(new Set(['alias', 'y']))
  })

  it('queries referenced entries and upgrades matching source-bound variables', async () => {
    const tree = parseSnlSyntaxTree('x@ctx')
    const driver = new EntryDataDriver({ queries: {
      query_entry: async ({ entry_id }) => entry_id === 'ctx' ? { id: 'ctx', kind: 'context', title: 'Ctx', content: { snl: '@x' } } : null,
      query_entry_kind: async () => null,
    } })
    await resolveEntryContextSources(tree, driver)
    expect(tree.kind).toBe('bvar')
    expect(tree.source).toEqual({ type: 'entry', entry_id: 'ctx' })
  })

  it('marks dangling and non-declaring references without storage assumptions', async () => {
    const dangling = parseSnlSyntaxTree('x@missing')
    const noDecl = parseSnlSyntaxTree('x@ctx')
    const driver = new EntryDataDriver({ queries: {
      query_entry: async ({ entry_id }) => entry_id === 'ctx' ? { id: 'ctx', kind: 'context', title: 'Ctx', content: { snl: '@y' } } : null,
      query_entry_kind: async () => null,
    } })
    await resolveEntryContextSources(dangling, driver)
    await resolveEntryContextSources(noDecl, driver)
    expect(dangling.mdata).toMatchObject({ srcStatus: 'dangling' })
    expect(noDecl.mdata).toMatchObject({ srcStatus: 'srcResolvedNoDecl' })
  })

  it('deduplicates source queries and forwards cancellation', async () => {
    const tree = parseSnlSyntaxTree('pair(x@ctx,y@ctx)')
    const controller = new AbortController()
    const query_entry = vi.fn(async ({ signal }: { signal?: AbortSignal }) => {
      expect(signal).toBe(controller.signal)
      return { id: 'ctx', kind: 'context', title: 'Ctx', content: { snl: 'pair(@x,@y)' } }
    })
    const driver = new EntryDataDriver({ queries: { query_entry, query_entry_kind: async () => null } })
    await resolveEntryContextSources(tree, driver, controller.signal)
    expect(query_entry).toHaveBeenCalledTimes(1)
    expect(tree.children.map((child) => child.kind)).toEqual(['bvar', 'bvar'])
  })
})
