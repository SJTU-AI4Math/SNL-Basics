// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import { createSnlSyntaxTreeNode } from '../snl-syntax-tree/types'
import type { SnlMacro, SnlMacroRecord } from '../snl-macro/types'
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'
import { testDriver } from '../snl-react-view/test-helpers'
import { MacroDataDriver } from '../snl-macro/macro-data-driver'

function blockMacro(
  name: string,
  reactRendererKey: string,
  templateExtensions: Record<string, unknown> = {},
): SnlMacro {
  return {
    name,
    description: 'Test fixture',
    source: { entries: [], urls: [] },
    dynamic_arity: true,
    tags: [],
    styles: [{ style_name: 'default', template: {
      mode: 'block', body: '#*', block_template_name: reactRendererKey,
      ...templateExtensions,
    }, tags: [] }],
  }
}

const db: SnlMacroRecord = {
  'sample.list': blockMacro('sample.list', 'list'),
  'sample.enumerate': blockMacro('sample.enumerate', 'enumerate'),
  'sample.table': blockMacro('sample.table', 'table'),
  'sample.table.cells': blockMacro('sample.table.cells', 'table', {
    table: { composition: 'cells' },
  }),
  'sample.table.theme': blockMacro('sample.table.theme', 'table', {
    table: {
      composition: 'rows',
      css: {
        light: { color: '#112233', background: '#f1f2f3', border: '#a1a2a3' },
        dark: { color: '#ddeeff', background: '#101820', border: '#778899' },
      },
    },
  }),
  'sample.centered': blockMacro('sample.centered', 'centered'),
}

function leaf(name: string, kind = 'fvar'): SnlSyntaxTree {
  return createSnlSyntaxTreeNode(name, { kind })
}

function renderTree(tree: SnlSyntaxTree, driver = testDriver(db)) {
  return render(<SnlSyntaxTreeView tree={tree} macro_data_driver={driver} />)
}

afterEach(cleanup)

describe('block renderers via SnlSyntaxTreeView', () => {
  it('list renderer produces a <ul> with one <li> per child', async () => {
    const tree = createSnlSyntaxTreeNode('sample.list', {
      children: [leaf('a'), leaf('b'), leaf('c')],
    })
    const { container } = renderTree(tree)
    await waitFor(() => {
      const ul = container.querySelector('ul.snl-block-list')
      expect(ul).not.toBeNull()
      expect(ul!.querySelectorAll('li')).toHaveLength(3)
    })
  })

  it('table renderer renders a <thead> for a table-header row and <tbody> body rows', async () => {
    const header = createSnlSyntaxTreeNode('sample.header', {
      kind: 'table-header',
      children: [leaf('h1'), leaf('h2')],
    })
    const row = createSnlSyntaxTreeNode('sample.row', {
      children: [leaf('c1'), leaf('c2')],
    })
    const tree = createSnlSyntaxTreeNode('sample.table', { children: [header, row] })
    const { container } = renderTree(tree)
    await waitFor(() => {
      const table = container.querySelector('table.snl-block-table')
      expect(table).not.toBeNull()
      expect(table!.querySelectorAll('thead th')).toHaveLength(2)
      expect(table!.querySelectorAll('tbody td')).toHaveLength(2)
    })
  })

  it('table renderer can compose one row directly from block children', async () => {
    const tree = createSnlSyntaxTreeNode('sample.table.cells', {
      children: [leaf('c1'), leaf('c2'), leaf('c3')],
    })
    const { container } = renderTree(tree)
    await waitFor(() => {
      const table = container.querySelector<HTMLTableElement>('table.snl-block-table')
      expect(table).not.toBeNull()
      expect(table!.dataset.snlTableComposition).toBe('cells')
      expect(table!.querySelectorAll('tbody tr')).toHaveLength(1)
      expect(table!.querySelectorAll('tbody td')).toHaveLength(3)
    })
  })

  it('table renderer selects light and dark CSS colors from the live render context', async () => {
    let colorScheme: 'light' | 'dark' = 'light'
    const driver = new MacroDataDriver({
      context_reader: () => ({ color_scheme: colorScheme }),
      queries: { async query_macro({ macro_name }) { return db[macro_name] ?? null } },
    })
    const tree = createSnlSyntaxTreeNode('sample.table.theme', {
      children: [createSnlSyntaxTreeNode('sample.row', { children: [leaf('c1')] })],
    })
    const view = renderTree(tree, driver)
    let table: HTMLTableElement | null = null
    await waitFor(() => {
      table = view.container.querySelector<HTMLTableElement>('table.snl-block-table')
      expect(table).not.toBeNull()
    })
    expect(table!.style.color).toBe('rgb(17, 34, 51)')
    expect(table!.style.background).toBe('rgb(241, 242, 243)')
    expect(table!.style.getPropertyValue('--snl-table-border-color')).toBe('#a1a2a3')

    colorScheme = 'dark'
    view.rerender(<SnlSyntaxTreeView tree={tree} macro_data_driver={driver} />)
    expect(table!.style.color).toBe('rgb(221, 238, 255)')
    expect(table!.style.background).toBe('rgb(16, 24, 32)')
    expect(table!.style.getPropertyValue('--snl-table-border-color')).toBe('#778899')
  })

  it('centered renderer wraps children in a centered block div', async () => {
    const tree = createSnlSyntaxTreeNode('sample.centered', {
      children: [leaf('x'), leaf('y')],
    })
    const { container } = renderTree(tree)
    await waitFor(() => {
      const div = container.querySelector('div.snl-block-centered')
      expect(div).not.toBeNull()
    })
  })

  it('enumerate renderer produces an <ol> with one <li> per child', async () => {
    const tree = createSnlSyntaxTreeNode('sample.enumerate', {
      children: [leaf('a'), leaf('b'), leaf('c')],
    })
    const { container } = renderTree(tree)
    await waitFor(() => {
      const ol = container.querySelector('ol.snl-block-enumerate')
      expect(ol).not.toBeNull()
      expect(ol!.querySelectorAll('li')).toHaveLength(3)
    })
  })

  it('enumerate renderer honours mdata.start and mdata.listStyle', async () => {
    const tree = createSnlSyntaxTreeNode('sample.enumerate', {
      mdata: { start: 3, listStyle: 'lower-alpha' },
      children: [leaf('a'), leaf('b')],
    })
    const { container } = renderTree(tree)
    await waitFor(() => {
      const ol = container.querySelector<HTMLOListElement>('ol.snl-block-enumerate')
      expect(ol).not.toBeNull()
      // React translates the `start` prop to the DOM attribute.
      expect(ol!.getAttribute('start')).toBe('3')
      expect(ol!.style.listStyleType).toBe('lower-alpha')
    })
  })
})
