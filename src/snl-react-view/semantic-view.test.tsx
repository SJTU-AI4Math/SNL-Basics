// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import type { SnlMacro, SnlMacroRecord } from '../snl-macro/types'
import { parseSnlSyntaxTree } from '../snl-syntax-tree/parser'
import { testDriver } from './test-helpers'

const macro = (name: string, template: string, kind?: string): SnlMacro => ({
  name, description: '', source: { entries: [], urls: [] }, kind,
  dynamic_arity: false, tags: [],
  styles: [{ style_name: 'default', mode: 'formula_inline', template, tags: [] }],
})

const base: SnlMacroRecord = { scope: macro('scope', '#0\\;#1') }
afterEach(cleanup)

describe('semantic resolver integration', () => {
  it('renders a tree-source bvar with path identity and no synthetic bindRef', async () => {
    const tree = parseSnlSyntaxTree('scope(@x,x)')
    const { container } = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(base)} />)
    await waitFor(() => expect(container.querySelector('[data-tree-path="1"]')).not.toBeNull())
    const binder = container.querySelector<HTMLElement>('[data-tree-path="0"]')!
    const use = container.querySelector<HTMLElement>('[data-tree-path="1"]')!
    expect(binder.dataset.kind).toBe('binder')
    expect(use.dataset.kind).toBe('bvar')
    expect(use.dataset.sourcePath).toBe('0')
    expect(use.dataset.src).toBeUndefined()
    expect(use.hasAttribute('data-bindref')).toBe(false)
  })

  it('lets a Macro hit classify the same spelling as const', async () => {
    const tree = parseSnlSyntaxTree('scope(@x,x)')
    const macros = { ...base, x: macro('x', 'x') }
    const { container } = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(macros)} />)
    await waitFor(() => expect(container.querySelector('[data-tree-path="1"]')).not.toBeNull())
    expect(container.querySelector<HTMLElement>('[data-tree-path="1"]')?.dataset.kind).toBe('const')
    expect(container.querySelector<HTMLElement>('[data-tree-path="1"]')?.dataset.src).toBeUndefined()
  })

  it('keeps a const binder source const while linking unknown uses to its path', async () => {
    const tree = parseSnlSyntaxTree('scope(C@x,x)')
    const macros = { ...base, C: macro('C', 'C') }
    const { container } = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(macros)} />)
    await waitFor(() => expect(container.querySelector('[data-tree-path="1"]')).not.toBeNull())
    expect(container.querySelector<HTMLElement>('[data-tree-path="0"]')?.dataset.kind).toBe('const')
    expect(container.querySelector<HTMLElement>('[data-tree-path="1"]')?.dataset.sourcePath).toBe('0')
  })

  it('reports style fallback diagnostics through the view boundary', async () => {
    const diagnostics: Array<{ code: string }> = []
    const tree = parseSnlSyntaxTree('C[missing]')
    const { container } = render(
      <SnlSyntaxTreeView
        tree={tree}
        macro_data_driver={testDriver({ C: macro('C', 'C') })}
        onDiagnostics={(items) => { diagnostics.splice(0, diagnostics.length, ...items) }}
      />,
    )
    await waitFor(() => expect(container.querySelector('[data-name="C"]')).not.toBeNull())
    expect(container.querySelector('.katex-error')).toBeNull()
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'SNL_STYLE_NOT_FOUND' }))
  })
})
