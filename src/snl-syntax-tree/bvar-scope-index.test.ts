// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { buildBvarScopeIndex } from './bvar-scope-index'

describe('buildBvarScopeIndex', () => {
  it('retains the outer containing scope when a nested root shares its bindRef', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <span data-scope="binder" data-bindref="b1">
        <span data-scope="binder" data-bindref="b1">
          <span data-kind="binder" data-bindref="b1">g</span>
          <span data-kind="bvar" data-bindref="b1">g</span>
        </span>
        <span data-kind="bvar" data-bindref="b1">g</span>
      </span>`

    const index = buildBvarScopeIndex(container)
    const entry = index.get('b1')
    expect(entry).toBeDefined()
    expect(entry?.scopeRoot).toBe(container.firstElementChild)
    expect(entry?.binders).toHaveLength(1)
    expect(entry?.bvars).toHaveLength(2)
  })

  it('selects minimal roots for nested distinct refs and a sibling scope', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <span id="outer" data-scope="binder" data-bindref="b1">
        <span data-kind="binder" data-bindref="b1">x</span>
        <span id="inner" data-scope="binder" data-bindref="b2">
          <span data-kind="binder" data-bindref="b2">y</span>
          <span data-kind="bvar" data-bindref="b2">y</span>
        </span>
        <span data-kind="bvar" data-bindref="b1">x</span>
      </span>
      <span id="sibling" data-scope="binder" data-bindref="b3">
        <span data-kind="binder" data-bindref="b3">z</span>
        <span data-kind="bvar" data-bindref="b3">z</span>
      </span>`

    const index = buildBvarScopeIndex(container)
    expect(index.get('b1')?.scopeRoot.id).toBe('outer')
    expect(index.get('b2')?.scopeRoot.id).toBe('inner')
    expect(index.get('b3')?.scopeRoot.id).toBe('sibling')
  })
})
