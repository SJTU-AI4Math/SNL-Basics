// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import type { SnlMacro, SnlMacroRecord } from '../snl-macro/types'
import { createSnlSyntaxTreeNode } from '../snl-syntax-tree/types'
import { testDriver } from './test-helpers'

const macro = (
  name: string,
  mode: 'formula_inline' | 'text' | 'block',
  template: string,
  kind: string,
): SnlMacro => ({
  name,
  description: '',
  source: { entries: [], urls: [] },
  kind,
  dynamic_arity: false,
  tags: [],
  styles: [{ style_name: 'default', mode, template, tags: [] }],
})

const db: SnlMacroRecord = {
  Parent: macro('Parent', 'formula_inline', '\\left[#0\\right]', 'const'),
  SubFormula: macro('SubFormula', 'formula_inline', '#0 + #1', 'sub'),
  SubText: macro('SubText', 'text', 'before #0 after', 'sub'),
  SubBlock: macro('SubBlock', 'block', '#*', 'sub'),
}

const leaf = (name: string) => createSnlSyntaxTreeNode(name, { kind: 'fvar' })

afterEach(cleanup)

describe('sub metadata transparency', () => {
  it('emits no formula metadata while retaining child metadata', async () => {
    const tree = createSnlSyntaxTreeNode('SubFormula', { children: [leaf('a'), leaf('b')] })
    let latex = ''
    const { container } = render(
      <SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} onResolved={(v) => { latex = v }} />,
    )
    await waitFor(() => expect(container.querySelector('.katex')).not.toBeNull())
    expect(latex).not.toContain('name=SubFormula')
    expect(container.querySelector('[data-name="SubFormula"]')).toBeNull()
    expect(container.querySelector('[data-name="a"]')).not.toBeNull()
    expect(container.querySelector('[data-name="b"]')).not.toBeNull()
  })

  it('emits no text metadata and leaves the literal content in its parent surface', async () => {
    const tree = createSnlSyntaxTreeNode('SubText', { children: [leaf('x')] })
    const { container } = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} />)
    await waitFor(() => expect(container.textContent).toContain('before'))
    expect(container.querySelector('[data-name="SubText"]')).toBeNull()
    expect(container.querySelector('[data-name="x"]')).not.toBeNull()
  })

  it('emits no block host metadata while retaining child metadata', async () => {
    const tree = createSnlSyntaxTreeNode('SubBlock', { children: [leaf('x')] })
    const { container } = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} />)
    await waitFor(() => expect(container.querySelector('[data-name="x"]')).not.toBeNull())
    expect(container.querySelector('[data-name="SubBlock"]')).toBeNull()
    expect(container.querySelector('[data-kind="sub"]')).toBeNull()
  })

  it('lets a parent wrapper own visible nested sub content', async () => {
    const sub = createSnlSyntaxTreeNode('SubFormula', { children: [leaf('a'), leaf('b')] })
    const tree = createSnlSyntaxTreeNode('Parent', { children: [sub] })
    const { container } = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} />)
    await waitFor(() => expect(container.querySelector('[data-name="Parent"]')).not.toBeNull())
    expect(container.querySelector('[data-name="SubFormula"]')).toBeNull()
    expect(container.querySelector('[data-name="Parent"]')?.textContent).toContain('a')
  })
})
