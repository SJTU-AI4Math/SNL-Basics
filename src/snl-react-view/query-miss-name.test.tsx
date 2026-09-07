// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import katex from 'katex'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import { parseSnlSyntaxTree } from '../snl-syntax-tree/parser'
import { serializeSnlSyntaxTree } from './serialize'
import { resolveRootLatex } from './render-source'
import { testDriver } from './test-helpers'
import type { SnlMacro } from '../snl-macro/types'
const testMacro = (name: string, template: { body: string; mode?: 'text' }): SnlMacro => ({
  name, description: '', source: { entries: [], urls: [] }, tags: [], dynamic_arity: false,
  styles: [{ style_name: 'default', tags: [], template: { mode: 'formula_inline', ...template } }],
})

afterEach(cleanup)

describe('query-miss name typography', () => {
  it.each(['binder', 'bvar', 'fvar', 'const'])('uses mathsf and literal underscores for %s leaves and applications', async kind => {
    const driver = testDriver({})
    for (const source of ['variable', 'variable_name', 'variable__name', 'variable_name(a,b)', 'Name.variable_name(a,b)', 'x_1', 'βeta']) {
      const node = { ...parseSnlSyntaxTree(source), kind }
      const before = JSON.stringify(node)
      const latex = await resolveRootLatex(node, driver)
      const escaped = node.macro_name.replaceAll('_', '\\_')
      expect(latex).toContain(`\\mathsf{${escaped}}`)
      expect(latex).toContain(`kind=${kind}`)
      if (node.children.length) expect(latex).toContain(`\\mathsf{${escaped}}(`)
      const html = katex.renderToString(latex, { trust: true, throwOnError: true, strict: 'ignore' })
      expect(html).toContain('mathsf')
      expect(JSON.stringify(node)).toBe(before)
    }
  })

  it('leaves single letters, numbers, explicit formula payloads and backslash heads unchanged', async () => {
    for (const [source, expected] of [
      ['x', '{x}'], ['α', '{α}'], ['12', '{12}'], ['12.34', '{12.34}'],
      ['$variable$', '{variable}'], ['\\foo', '\\mathrm{foo}'],
      ['\\foo(a)', '\\operatorname{foo}('],
    ]) {
      const latex = await resolveRootLatex(parseSnlSyntaxTree(source), testDriver({}))
      expect(latex).not.toContain('\\mathsf')
      expect(latex).toContain(expected)
      expect(() => katex.renderToString(latex, { trust: true, throwOnError: true, strict: 'ignore' })).not.toThrow()
    }
  })

  it('does not override a registered or intentionally empty Macro template', async () => {
    for (const body of ['\\mathbf{R}', '']) {
      const latex = await resolveRootLatex(parseSnlSyntaxTree('variable_name'), testDriver({ variable_name: testMacro('variable_name', { body }) }))
      expect(latex).not.toContain('\\mathsf')
      if (body) expect(latex).toContain(body)
    }
  })

  it('renders actual binder and bound-use names without changing source or binding paths', async () => {
    const tree = parseSnlSyntaxTree('scope(@variable_name,variable_name(a,b))')
    const before = serializeSnlSyntaxTree(tree)
    const driver = testDriver({ scope: testMacro('scope', { body: '#0; #1', mode: 'text' }) })
    const { container } = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={driver} />)
    await waitFor(() => {
      expect(container.querySelector('.katex-error')).toBeNull()
      const binder = container.querySelector('[data-tree-path="0"][data-kind="binder"]')!
      const use = container.querySelector('[data-tree-path="1"][data-kind="bvar"]')!
      expect(binder?.querySelector('.mathsf')?.textContent).toBe('variable_name')
      expect(use?.querySelector('.mathsf')?.textContent).toBe('variable_name')
      expect(use?.getAttribute('data-source-path')).toBe('0')
      expect(use?.querySelector('[data-tree-path="1.0"]')).not.toBeNull()
      expect(use?.querySelector('[data-tree-path="1.1"]')).not.toBeNull()
    })
    expect(serializeSnlSyntaxTree(tree)).toBe(before)
  })
})
