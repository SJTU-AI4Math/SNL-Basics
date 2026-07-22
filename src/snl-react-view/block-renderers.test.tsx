// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import { createMacroTemplateQueryFromDb } from './default-query'
import { createSnlSyntaxTreeNode } from '../snl-syntax-tree/types'
import type { SnlMacro, SnlMacroDb } from '../snl-macro/types'
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'

function blockMacro(name: string, reactRendererKey: string): SnlMacro {
  return {
    name,
    description: 'Test fixture',
    source: { entries: [], urls: [] },
    dynamic_arity: true,
    styles: [{ tag: 'default', mode: 'block', template: '', react_renderer_key: reactRendererKey }],
  }
}

const db: SnlMacroDb = {
  'sample.list': blockMacro('sample.list', 'list'),
  'sample.enumerate': blockMacro('sample.enumerate', 'enumerate'),
  'sample.table': blockMacro('sample.table', 'table'),
  'sample.centered': blockMacro('sample.centered', 'centered'),
}
const query = createMacroTemplateQueryFromDb(db)

function leaf(name: string, kind = 'fvar'): SnlSyntaxTree {
  return createSnlSyntaxTreeNode(name, { kind })
}

function renderTree(tree: SnlSyntaxTree) {
  return render(<SnlSyntaxTreeView tree={tree} query={query} macroDb={db} />)
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
