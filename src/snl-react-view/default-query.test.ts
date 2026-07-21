import { describe, expect, it, vi } from 'vitest'
import { createProjectMacroTemplateQuery } from './default-query'

describe('project macro query', () => {
  it('uses injected db without fetch', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const query = createProjectMacroTemplateQuery({
      X: { name: 'X', description: '', source: { entries: [], urls: [] }, dynamic_arity: false, styles: [{ tag: 'default', mode: 'formula_inline', template: 'X' }] },
    })
    await expect(query({ name: 'X', node: { name: 'X', kind: 'const', mdata: null, children: [] } })).resolves.toBe('X')
    expect(fetch).not.toHaveBeenCalled()
    fetch.mockRestore()
  })
})
