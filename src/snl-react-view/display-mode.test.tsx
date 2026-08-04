// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import { createSnlSyntaxTreeNode } from '../snl-syntax-tree/types'
import type { SnlMacro, SnlMacroRecord } from '../snl-macro/types'
import { testDriver } from '../snl-react-view/test-helpers'

function fracMacro(name: string, display?: 'inline' | 'block'): SnlMacro {
  return {
    name,
    description: '',
    source: { entries: [], urls: [] },
    dynamic_arity: false,
    tags: [],
    default_style: { en: 'default' },
    styles: [
      {
        style_name: 'default',
        mode: display === 'block' ? 'formula_display' : 'formula_inline',
        template: '\\frac{#0}{#1}',
        tags: [],
      },
    ],
  }
}

const db: SnlMacroRecord = {
  'block.frac': fracMacro('block.frac', 'block'),
  'inline.frac': fracMacro('inline.frac'),
}

function leaf(name: string) {
  return createSnlSyntaxTreeNode(name, { kind: 'fvar' })
}

afterEach(cleanup)

describe('macro.display → KaTeX displayMode', () => {
  it('display "block" root renders in block mode (.katex-display)', async () => {
    const tree = createSnlSyntaxTreeNode('block.frac', {
      children: [leaf('a'), leaf('b')],
    })
    const { container } = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} />)
    await waitFor(() => {
      expect(container.querySelector('.katex-display')).not.toBeNull()
    })
  })

  it('default (inline) root renders WITHOUT .katex-display', async () => {
    const tree = createSnlSyntaxTreeNode('inline.frac', {
      children: [leaf('a'), leaf('b')],
    })
    const { container } = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} />)
    await waitFor(() => {
      expect(container.querySelector('.katex')).not.toBeNull()
    })
    expect(container.querySelector('.katex-display')).toBeNull()
  })
})
