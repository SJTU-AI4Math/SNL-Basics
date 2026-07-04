// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import { createMacroTemplateQueryFromDb } from './default-query'
import { createSnlSyntaxTreeNode } from '../snl-syntax-tree/types'
import type { SnlMacro, SnlMacroDb } from '../snl-macro/types'

function fracMacro(name: string, display?: 'inline' | 'block'): SnlMacro {
  return {
    name,
    description: '',
    source: { entries: [], urls: [] },
    dynamic_arity: false,
    styles: [
      {
        tag: 'default',
        mode: display === 'block' ? 'formula_display' : 'formula_inline',
        template: '\\frac{#0}{#1}',
      },
    ],
  }
}

const db: SnlMacroDb = {
  'block.frac': fracMacro('block.frac', 'block'),
  'inline.frac': fracMacro('inline.frac'),
}
const query = createMacroTemplateQueryFromDb(db)

function leaf(name: string) {
  return createSnlSyntaxTreeNode(name, { kind: 'fvar' })
}

afterEach(cleanup)

describe('macro.display → KaTeX displayMode', () => {
  it('display "block" root renders in block mode (.katex-display)', async () => {
    const tree = createSnlSyntaxTreeNode('block.frac', {
      children: [leaf('a'), leaf('b')],
    })
    const { container } = render(<SnlSyntaxTreeView tree={tree} query={query} macroDb={db} />)
    await waitFor(() => {
      expect(container.querySelector('.katex-display')).not.toBeNull()
    })
  })

  it('default (inline) root renders WITHOUT .katex-display', async () => {
    const tree = createSnlSyntaxTreeNode('inline.frac', {
      children: [leaf('a'), leaf('b')],
    })
    const { container } = render(<SnlSyntaxTreeView tree={tree} query={query} macroDb={db} />)
    await waitFor(() => {
      expect(container.querySelector('.katex')).not.toBeNull()
    })
    expect(container.querySelector('.katex-display')).toBeNull()
  })
})
