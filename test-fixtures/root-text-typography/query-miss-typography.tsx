import React from 'react'
import { createRoot } from 'react-dom/client'
import { SnlSyntaxTreeView } from '../../src/components/SnlSyntaxTreeView'
import { MacroDataDriver } from '../../src/snl-macro/macro-data-driver'
import { parseSnlSyntaxTree } from '../../src/snl-syntax-tree/parser'
import { serializeSnlSyntaxTree } from '../../src/snl-react-view/serialize'

/** Real browser/font gate: shared query-miss policy, not a mocked template. */
export async function verifyQueryMissTypography() {
  const host = document.createElement('section')
  document.getElementById('app')!.append(host)
  const root = createRoot(host)
  const driver = new MacroDataDriver({ queries: { query_macro: async ({ macro_name }) => macro_name === 'scope' ? {
    name: 'scope', description: '', source: { entries: [], urls: [] }, tags: [], dynamic_arity: false,
    styles: [{ style_name: 'default', tags: [], template: { mode: 'text', body: '#0; #1' } }],
  } : null } })
  const snapshots: unknown[] = []
  try {
    for (const source of ['variable', 'variable_name(a,b)', 'variable__name', 'scope(@variable_name,variable_name(a,b))']) {
      const tree = parseSnlSyntaxTree(source)
      const before = serializeSnlSyntaxTree(tree)
      root.render(<SnlSyntaxTreeView tree={tree} macro_data_driver={driver} />)
      for (let n = 0; n < 100; n++) {
        await new Promise(resolve => setTimeout(resolve, 10))
        if (host.querySelector('.katex-html .mathsf')?.textContent === tree.macro_name ||
          tree.macro_name === 'scope' && host.querySelector('[data-kind="bvar"] .mathsf')) break
      }
      await document.fonts.ready
      const spans = [...host.querySelectorAll<HTMLElement>('.katex-html .mathsf')]
      if (host.querySelector('.katex-error') || spans.length !== (tree.macro_name === 'scope' ? 2 : 1)) {
        throw new Error(`query-miss typography missing or failed: ${source}`)
      }
      const families = spans.map(span => getComputedStyle(span).fontFamily)
      if (!families.every(family => family.includes('KaTeX_SansSerif'))) throw new Error(`query-miss font is not sans-serif: ${families}`)
      if (tree.macro_name === 'scope') {
        const bound = host.querySelector('[data-kind="bvar"]')
        if (bound?.getAttribute('data-source-path') !== '0') throw new Error('query-miss typography changed binding source')
      }
      if (serializeSnlSyntaxTree(tree) !== before) throw new Error('query-miss typography changed source')
      snapshots.push({ source, names: spans.map(span => span.textContent), families })
    }
    return { snapshots }
  } finally {
    root.unmount()
    host.remove()
  }
}
