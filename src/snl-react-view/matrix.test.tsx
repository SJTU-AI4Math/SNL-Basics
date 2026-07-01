// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import { createMacroTemplateQueryFromDb } from './default-query'
import { createSnlSyntaxTreeNode } from '../snl-syntax-tree/types'
import mainDbJson from '../../public/snl-macro-db.json'
import type { SnlMacroDb } from '../snl-macro/types'
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'

const db = mainDbJson as unknown as SnlMacroDb
const query = createMacroTemplateQueryFromDb(db)

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
    const { container } = render(
      <SnlSyntaxTreeView
        tree={tree}
        query={query}
        templateDb={db}
        katexOptions={{ trust: true }}
      />,
    )
    await waitFor(() => {
      // Math root → KaTeX innerHTML. \begin{pmatrix}…\end{pmatrix} renders as .mtable.
      expect(container.querySelector('.mtable')).not.toBeNull()
    })
    // constantSubtree htmlData wrapper is present (hover target for the matrix).
    expect(container.querySelector('[data-kind="constantSubtree"]')).not.toBeNull()
  })

  it('joins row cells with & and rows with \\\\ via @CHILDREN@', async () => {
    const tree = createSnlSyntaxTreeNode('pmatrix', {
      children: [row('a', 'b'), row('c', 'd')],
    })
    let latex = ''
    render(
      <SnlSyntaxTreeView
        tree={tree}
        query={query}
        templateDb={db}
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
