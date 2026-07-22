// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import { createSnlSyntaxTreeNode } from '../snl-syntax-tree/types'
import type { SnlMacro, SnlMacroRecord } from '../snl-macro/types'
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'
import { testDriver } from '../snl-react-view/test-helpers'

function mathMacro(
  name: string,
  opts: { separator?: string; template?: string } = {},
): SnlMacro {
  return {
    name,
    description: '',
    source: { entries: [], urls: [] },
    dynamic_arity: true,
    tags: [],
    styles: [{ style_name: 'default', mode: 'formula_inline', template: opts.template ?? '#*', separator: opts.separator, tags: [] }],
  }
}

// Cat 2026-07-14 §dynamic_arity-no-template: dynamic_arity macros use #*
// with separator for joining children.
const db: SnlMacroRecord = {
  pmatrix: mathMacro('pmatrix', { template: '\\begin{pmatrix}#*\\end{pmatrix}', separator: ' \\\\ ' }),
  'matrix.row': mathMacro('matrix.row', { separator: ' & ' }),
}

function leaf(name: string): SnlSyntaxTree {
  return createSnlSyntaxTreeNode(name, { kind: 'fvar' })
}

function row(...cells: string[]): SnlSyntaxTree {
  return createSnlSyntaxTreeNode('matrix.row', { children: cells.map(leaf) })
}

afterEach(cleanup)

describe('variadic pmatrix / matrix.row', () => {
  it('renders pmatrix(matrix.row(a,b), matrix.row(c,d)) to a KaTeX matrix', async () => {
    const tree = createSnlSyntaxTreeNode('pmatrix', {
      children: [row('a', 'b'), row('c', 'd')],
    })
    const { container } = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} />)
    await waitFor(() => {
      // Math root → KaTeX innerHTML. \begin{pmatrix}…\end{pmatrix} renders as .mtable.
      expect(container.querySelector('.mtable')).not.toBeNull()
    })
  })

  it('joins row cells with & and rows with \\\\ via #*', async () => {
    const tree = createSnlSyntaxTreeNode('pmatrix', {
      children: [row('a', 'b'), row('c', 'd')],
    })
    let latex = ''
    render(
      <SnlSyntaxTreeView
        tree={tree} macro_data_driver={testDriver(db)}
        onResolved={(l) => {
          latex = l
        }}
      />,
    )
    await waitFor(() => {
      expect(latex).toContain('\\begin{pmatrix}')
      expect(latex).toContain('\\end{pmatrix}')
    })
    // a & b for the first row, rows separated by \\
    expect(latex).toMatch(/a[\s\S]*&[\s\S]*b[\s\S]*\\\\[\s\S]*c[\s\S]*&[\s\S]*d/)
  })
})
