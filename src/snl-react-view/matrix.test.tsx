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

function fixedMathMacro(name: string, template: string, kind?: string): SnlMacro {
  return {
    name,
    description: '',
    source: { entries: [], urls: [] },
    dynamic_arity: false,
    kind,
    tags: [],
    styles: [{ style_name: 'default', mode: 'formula_inline', template, tags: [] }],
  }
}

// Cat 2026-07-14 §dynamic_arity-no-template: dynamic_arity macros use #*
// with separator for joining children.
const db: SnlMacroRecord = {
  pmatrix: mathMacro('pmatrix', { template: '\\begin{pmatrix}#*\\end{pmatrix}', separator: ' \\\\ ' }),
  'pmatrix.spaced': mathMacro('pmatrix.spaced', { template: '\\begin {pmatrix}#*\\end {pmatrix}', separator: ' \\\\ ' }),
  'pmatrix.commented': mathMacro('pmatrix.commented', { template: '\\begin % row\n{pmatrix}#*\\end % row\n{pmatrix}', separator: ' \\\\ ' }),
  'matrix.row': mathMacro('matrix.row', { separator: ' & ' }),
  'matrix.fixed-row': fixedMathMacro('matrix.fixed-row', '#0 & #1', 'partial'),
  'matrix.commented-row': fixedMathMacro(
    'matrix.commented-row',
    String.raw`% \begin{fake} & \\
#0 & #1`,
    'partial',
  ),
  'matrix.verb-row': fixedMathMacro('matrix.verb-row', String.raw`\verb|%| & #0`, 'partial'),
  'matrix.url-row': fixedMathMacro('matrix.url-row', String.raw`\url{https://x/%20} & #0`, 'partial'),
  'matrix.url-backslash-row': fixedMathMacro('matrix.url-backslash-row', String.raw`\url{\\%} & #0`, 'partial'),
  'matrix.href-backslash-row': fixedMathMacro('matrix.href-backslash-row', String.raw`\href{\\%}{link} & #0`, 'partial'),
}

function leaf(name: string): SnlSyntaxTree {
  return createSnlSyntaxTreeNode(name, { kind: 'fvar' })
}

function row(...cells: string[]): SnlSyntaxTree {
  return createSnlSyntaxTreeNode('matrix.row', { children: cells.map(leaf) })
}

afterEach(cleanup)

describe('variadic pmatrix / matrix.row', () => {
  it('does not split alignment separators inside environments with TeX whitespace', async () => {
    const tree = createSnlSyntaxTreeNode('pmatrix.spaced', {
      children: [row('a', 'b')],
    })
    const view = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} />)

    await waitFor(() => expect(view.container.querySelector('.mtable')).not.toBeNull())
    expect(view.container.querySelector('.katex-error')).toBeNull()
    expect(view.container.querySelector('[data-name="matrix.row"][data-tree-path="0"]')).not.toBeNull()
  })

  it('does not split alignment separators inside environments with TeX comments', async () => {
    const tree = createSnlSyntaxTreeNode('pmatrix.commented', {
      children: [row('a', 'b')],
    })
    const view = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} />)

    await waitFor(() => expect(view.container.querySelector('.mtable')).not.toBeNull())
    expect(view.container.querySelector('.katex-error')).toBeNull()
  })

  it('keeps a fixed-arity partial alignment node KaTeX-valid without losing metadata', async () => {
    const fixedRow = createSnlSyntaxTreeNode('matrix.fixed-row', {
      children: [leaf('a'), leaf('b')],
    })
    const tree = createSnlSyntaxTreeNode('pmatrix', { children: [fixedRow] })
    const view = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} />)

    await waitFor(() => expect(view.container.querySelector('.mtable')).not.toBeNull())
    expect(view.container.querySelector('.katex-error')).toBeNull()
    expect(view.container.querySelectorAll(
      '[data-name="matrix.fixed-row"][data-kind="partial"][data-tree-path="0"]',
    )).toHaveLength(2)
    expect(view.container.querySelector('[data-name="a"][data-tree-path="0.0"]')).not.toBeNull()
    expect(view.container.querySelector('[data-name="b"][data-tree-path="0.1"]')).not.toBeNull()
  })

  it('ignores fake environments and separators inside ordinary TeX comments', async () => {
    const commentedRow = createSnlSyntaxTreeNode('matrix.commented-row', {
      children: [leaf('a'), leaf('b')],
    })
    const tree = createSnlSyntaxTreeNode('pmatrix', { children: [commentedRow] })
    const view = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} />)

    await waitFor(() => expect(view.container.querySelector('.mtable')).not.toBeNull())
    expect(view.container.querySelector('.katex-error')).toBeNull()
    expect(view.container.querySelectorAll(
      '[data-name="matrix.commented-row"][data-tree-path="0"]',
    )).toHaveLength(2)
  })

  it.each([
    ['matrix.verb-row', 'verb'],
    ['matrix.url-row', 'url'],
  ])('keeps percent literal inside KaTeX %s constructs', async (macroName) => {
    const specialRow = createSnlSyntaxTreeNode(macroName, { children: [leaf('a')] })
    const tree = createSnlSyntaxTreeNode('pmatrix', { children: [specialRow] })
    const view = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} />)

    await waitFor(() => expect(view.container.querySelector('.mtable')).not.toBeNull())
    expect(view.container.querySelector('.katex-error')).toBeNull()
    expect(view.container.querySelectorAll(
      `[data-name="${macroName}"][data-tree-path="0"]`,
    )).toHaveLength(2)
  })

  it.each([
    ['matrix.url-backslash-row', '\\%'],
    ['matrix.href-backslash-row', '\\%'],
  ])('preserves exact href bytes for %s', async (macroName, expectedHref) => {
    const specialRow = createSnlSyntaxTreeNode(macroName, { children: [leaf('a')] })
    const tree = createSnlSyntaxTreeNode('pmatrix', { children: [specialRow] })
    const view = render(
      <SnlSyntaxTreeView
        tree={tree}
        macro_data_driver={testDriver(db)}
        katexOptions={{ trust: true }}
      />,
    )

    const link = await waitFor(() => {
      const found = view.container.querySelector<HTMLAnchorElement>('a[href]')
      expect(found).not.toBeNull()
      return found!
    })
    expect(view.container.querySelector('.katex-error')).toBeNull()
    expect(link.getAttribute('href')).toBe(expectedHref)
    expect(view.container.querySelectorAll(
      `[data-name="${macroName}"][data-tree-path="0"]`,
    ).length).toBeGreaterThan(0)
  })

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

  it('preserves root and alignment-node metadata with fallback kinds', async () => {
    const tree = createSnlSyntaxTreeNode('pmatrix', {
      children: [row('a', 'b'), row('c', 'd')],
    })
    const view = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} />)
    await waitFor(() => expect(view.container.querySelector('.mtable')).not.toBeNull())
    expect(view.container.querySelector('[data-name="pmatrix"][data-kind="partial"][data-tree-path=""]')).not.toBeNull()
    expect(view.container.querySelector('[data-name="matrix.row"][data-kind="fvar"][data-tree-path="0"]')).not.toBeNull()

    const explicit = createSnlSyntaxTreeNode('pmatrix', {
      kind: 'const',
      children: [row('a', 'b')],
    })
    view.rerender(<SnlSyntaxTreeView tree={explicit} macro_data_driver={testDriver(db)} />)
    await waitFor(() => expect(view.container.querySelector('[data-name="pmatrix"][data-kind="const"]')).not.toBeNull())
  })

  it('keeps nested alignment nodes KaTeX-valid and preserves both identities', async () => {
    const nestedRow = createSnlSyntaxTreeNode('matrix.row', {
      children: [row('a', 'b'), leaf('c')],
    })
    const tree = createSnlSyntaxTreeNode('pmatrix', { children: [nestedRow] })
    const view = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} />)
    await waitFor(() => expect(view.container.querySelector('.mtable')).not.toBeNull())
    expect(view.container.querySelector('[data-name="matrix.row"][data-tree-path="0"]')).not.toBeNull()
    expect(view.container.querySelector('[data-name="matrix.row"][data-tree-path="0.0"]')).not.toBeNull()
    expect(view.container.querySelector('.katex-error')).toBeNull()
  })

  it('preserves metadata for zero- and one-child alignment nodes', async () => {
    const empty = createSnlSyntaxTreeNode('pmatrix', {
      children: [createSnlSyntaxTreeNode('matrix.row')],
    })
    const view = render(<SnlSyntaxTreeView tree={empty} macro_data_driver={testDriver(db)} />)
    await waitFor(() => expect(view.container.querySelector('[data-name="matrix.row"][data-tree-path="0"]')).not.toBeNull())

    const singleton = createSnlSyntaxTreeNode('pmatrix', {
      children: [createSnlSyntaxTreeNode('matrix.row', { children: [leaf('a')] })],
    })
    view.rerender(<SnlSyntaxTreeView tree={singleton} macro_data_driver={testDriver(db)} />)
    await waitFor(() => expect(view.container.querySelector('[data-name="matrix.row"][data-tree-path="0"]')).not.toBeNull())
  })
})
