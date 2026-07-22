// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import { parseSnlSyntaxTree } from '../snl-syntax-tree/parser'
import mainDbJson from '../../public/snl-macro-db.json'
import type { SnlMacroRecord } from '../snl-macro/types'
import { testDriver } from '../snl-react-view/test-helpers'

const db = mainDbJson as unknown as SnlMacroRecord

afterEach(cleanup)

describe('style dispatch via [style] bracket', () => {
  it('uses the first style (infix → \\rightarrow) when no bracket is given', async () => {
    const tree = parseSnlSyntaxTree('FOL.implies(a,b)')
    let latex = ''
    render(
      <SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} onResolved={(l) => (latex = l)} />,
    )
    await waitFor(() => expect(latex).toContain('\\rightarrow'))
    expect(latex).not.toContain('\\Rightarrow')
  })

  it('honors an explicit [double] style (⇒) and emits data-style', async () => {
    const tree = parseSnlSyntaxTree('FOL.implies[double](a,b)')
    expect(tree.style_name).toBe('double')
    let latex = ''
    const { container } = render(
      <SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} onResolved={(l) => (latex = l)} />,
    )
    await waitFor(() => expect(latex).toContain('\\Rightarrow'))
    expect(latex).not.toContain('\\rightarrow')
    await waitFor(() => {
      expect(container.querySelector('[data-style="double"]')).not.toBeNull()
    })
  })


  it('throws (render error) for an unknown style tag', async () => {
    const tree = parseSnlSyntaxTree('FOL.implies[nope](a,b)')
    const { container } = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} />)
    await waitFor(() => {
      expect(container.querySelector('.katex-error')).not.toBeNull()
    })
    expect(container.querySelector('.katex-error')?.textContent).toContain('unknown style')
  })
})
