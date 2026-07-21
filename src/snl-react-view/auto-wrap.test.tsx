// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import { createMacroTemplateQueryFromDb } from './default-query'
import { parseSnlSyntaxTree } from '../snl-syntax-tree/parser'
import mainDbJson from '../../public/snl-macro-db.json'
import type { SnlMacroDb } from '../snl-macro/types'

const db = mainDbJson as unknown as SnlMacroDb
const query = createMacroTemplateQueryFromDb(db)

afterEach(cleanup)

describe('auto-wrap \\htmlData', () => {
  it('wraps every rendered node in data-name/data-kind (Add.add)', async () => {
    const tree = parseSnlSyntaxTree('Add.add(a,b)')
    const { container } = render(<SnlSyntaxTreeView tree={tree} query={query} macroDb={db} />)

    await waitFor(() => {
      expect(container.querySelector('[data-name="Add.add"]')).not.toBeNull()
    })

    const html = container.querySelector('.katex-html')!.innerHTML
    // No placeholder / metadata leaks in the rendered DOM.
    expect(html).not.toContain('@NAME@')
    expect(html).not.toContain('@CHILD')
    expect(html).not.toContain('#0')
    expect(html).not.toContain('#1')
    // Leaf operands are auto-wrapped too.
    expect(container.querySelector('[data-name="a"]')).not.toBeNull()
    expect(container.querySelector('[data-name="b"]')).not.toBeNull()
  })

  it('emits data-scope="binder" + bindRef for a quantifier (bvar-scope highlighting)', async () => {
    const tree = parseSnlSyntaxTree('Type.forall(x,x)')
    const { container } = render(<SnlSyntaxTreeView tree={tree} query={query} macroDb={db} />)

    await waitFor(() => {
      expect(container.querySelector('[data-scope="binder"]')).not.toBeNull()
    })
    const scope = container.querySelector<HTMLElement>('[data-scope="binder"]')!
    expect(scope.dataset.bindref ?? scope.getAttribute('data-bindRef')).toBeTruthy()
    // A bound-variable occurrence carrying the same bindRef exists inside scope.
    expect(scope.querySelector('[data-kind="bvar"]')).not.toBeNull()
  })
})
