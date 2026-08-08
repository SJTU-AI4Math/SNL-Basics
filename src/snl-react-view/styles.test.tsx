// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import { parseSnlSyntaxTree } from '../snl-syntax-tree/parser'
import type { SnlMacroRecord } from '../snl-macro/types'
import { testDriver } from '../snl-react-view/test-helpers'

const db: SnlMacroRecord = {
  implies: {
    name: 'implies', description: '', source: { entries: [], urls: [] },
    dynamic_arity: false, tags: [],
    styles: [
      { style_name: 'infix', mode: 'formula_inline', template: '#0 \\rightarrow #1', tags: [] },
      { style_name: 'double', mode: 'formula_inline', template: '#0 \\Rightarrow #1', tags: [] },
    ],
  },
}

afterEach(cleanup)

describe('style dispatch via [style] bracket', () => {
  it('uses the language/default style when no bracket is given', async () => {
    const tree = parseSnlSyntaxTree('implies(a,b)')
    let latex = ''
    render(<SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} onResolved={(l) => (latex = l)} />)
    await waitFor(() => expect(latex).toContain('\\rightarrow'))
    expect(latex).not.toContain('\\Rightarrow')
  })

  it('honors an explicit [double] style and emits data-style', async () => {
    const tree = parseSnlSyntaxTree('implies[double](a,b)')
    let latex = ''
    const { container } = render(
      <SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} onResolved={(l) => (latex = l)} />,
    )
    await waitFor(() => expect(latex).toContain('\\Rightarrow'))
    await waitFor(() => expect(container.querySelector('[data-style="double"]')).not.toBeNull())
  })

  it('throws a render error for an unknown style tag', async () => {
    const tree = parseSnlSyntaxTree('implies[nope](a,b)')
    const { container } = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} />)
    await waitFor(() => expect(container.querySelector('.katex-error')).not.toBeNull())
    expect(container.querySelector('.katex-error')?.textContent).toContain('unknown style')
  })
})
