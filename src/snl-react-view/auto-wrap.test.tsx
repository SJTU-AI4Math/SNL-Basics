// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import { parseSnlSyntaxTree } from '../snl-syntax-tree/parser'
import type { SnlMacroRecord } from '../snl-macro/types'
import { testDriver } from '../snl-react-view/test-helpers'

const db: SnlMacroRecord = {}

afterEach(cleanup)

describe('auto-wrap \\htmlData', () => {
  it('wraps every rendered node in data-name/data-kind (Add.add)', async () => {
    const tree = parseSnlSyntaxTree('Add.add(a,b)')
    const { container } = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} />)

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

  it('emits binder metadata from explicit @ syntax without domain-name special cases', async () => {
    const tree = parseSnlSyntaxTree('quantifier(@x,x)')
    const { container } = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} />)

    await waitFor(() => expect(container.querySelector('[data-kind="binder"]')).not.toBeNull())
    const binder = container.querySelector<HTMLElement>('[data-kind="binder"]')
    const bvar = container.querySelector<HTMLElement>('[data-kind="bvar"]')
    expect(binder?.dataset.treePath).toBe('0')
    expect(bvar?.dataset.sourcePath).toBe('0')
    expect(binder?.dataset.bindref).toBeUndefined()
    expect(bvar?.dataset.bindref).toBeUndefined()
  })
})
