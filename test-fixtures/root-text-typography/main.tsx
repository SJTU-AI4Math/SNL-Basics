import React from 'react'
import { createRoot } from 'react-dom/client'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { SnlSyntaxTreeView } from '../../src/components/SnlSyntaxTreeView'
import { parseSnlSyntaxTree } from '../../src/snl-syntax-tree/parser'
import { MacroDataDriver } from '../../src/snl-macro/macro-data-driver'
import { EntryDataDriver } from '../../src/entry-react/entry-data-driver'
import { EntrySurface } from '../../src/entry-react/entry-render'

const mode = document.body.dataset.mode
if (mode === 'entry') await import('../../src/entry-react/style.css')
else await import('../../src/snl-react-view/style.css')

const macroDriver = new MacroDataDriver({ queries: { query_macro: async () => null } })
const entryDriver = new EntryDataDriver({ queries: { query_entry: async () => null, query_entry_kind: async () => null } })
const source = '%$x$ Hi Hamburgefontsiv root text with an uninterrupted_identifier_that_must_wrap_narrowly%'

function Surface() {
  const rendered = mode === 'entry'
    ? <EntrySurface entry={{ id: 'root-text', kind: 'definition', title: 'Root Text', content: { snl: source } }} kind={null} entry_data_driver={entryDriver} macro_data_driver={macroDriver} />
    : <SnlSyntaxTreeView tree={parseSnlSyntaxTree(source)} macro_data_driver={macroDriver} />
  return <>
    <div id="surface" style={{ width: '11rem', fontSize: '16px' }}>{rendered}</div>
    <div id="reference" dangerouslySetInnerHTML={{ __html: katex.renderToString('\\text{Hamburgefontsiv}', { throwOnError: true }) }} />
    <pre id="result" data-status="pending">pending</pre>
  </>
}

createRoot(document.getElementById('app')!).render(<Surface />)

async function verify() {
  await new Promise<void>((resolve) => setTimeout(resolve, 100))
  const root = document.querySelector<HTMLElement>('#surface .katex-html.snl-text')
  const math = root?.querySelector<HTMLElement>(':scope > .snl-math-span .katex')
  const reference = document.querySelector<HTMLElement>('#reference > .katex')
  const referenceText = reference?.querySelector<HTMLElement>('.mord.text')
  if (!root || !math || !reference || !referenceText) throw new Error(`missing production DOM in ${mode}`)

  const rootProbe = document.createElement('span')
  rootProbe.textContent = 'Hamburgefontsiv'
  rootProbe.style.cssText = 'position:absolute;white-space:nowrap'
  root.append(rootProbe)
  const literalNode = [...root.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes('Hamburgefontsiv'))
  if (!literalNode) throw new Error('missing mixed root Text literal run')
  const literalRange = document.createRange()
  literalRange.setStart(literalNode, 0)
  literalRange.setEnd(literalNode, Math.min(3, literalNode.textContent?.length ?? 0))

  const referenceHost = document.getElementById('reference')!
  ;(root.closest('[data-entry-body]') ?? document.getElementById('surface')!).append(referenceHost)
  const rootStyle = getComputedStyle(root)
  const referenceStyle = getComputedStyle(reference)
  const rootSize = Number.parseFloat(rootStyle.fontSize)
  const referenceSize = Number.parseFloat(referenceStyle.fontSize)
  const lineHeight = Number.parseFloat(rootStyle.lineHeight)
  const widthDelta = Math.abs(rootProbe.getBoundingClientRect().width - referenceText.getBoundingClientRect().width)
  const baselineDelta = Math.abs(literalRange.getBoundingClientRect().bottom - math.getBoundingClientRect().bottom)
  const metrics = {
    mode,
    rootClass: root.className,
    rootFamily: rootStyle.fontFamily,
    referenceFamily: referenceStyle.fontFamily,
    rootSize,
    referenceSize,
    lineHeight,
    widthDelta,
    baselineDelta,
    clientWidth: root.clientWidth,
    scrollWidth: root.scrollWidth,
    rootHeight: root.getBoundingClientRect().height,
  }
  const assertions = [
    [rootStyle.fontFamily.includes('KaTeX_Main'), 'root Text does not resolve to KaTeX_Main'],
    [referenceStyle.fontFamily.includes('KaTeX_Main'), 'reference is not KaTeX Computer Modern'],
    [Math.abs(rootSize - referenceSize) < 0.05, 'root Text size differs from adjacent KaTeX'],
    [Math.abs(lineHeight - rootSize * 1.2) < 0.1, 'root Text line-height is not KaTeX-compatible'],
    [widthDelta < 0.5, 'root Text 1em glyph metrics differ from KaTeX text'],
    [baselineDelta < 4, 'mixed root Text and formula baseline diverges'],
    [root.scrollWidth <= root.clientWidth + 1, 'narrow root Text overflows instead of wrapping'],
    [root.getBoundingClientRect().height > lineHeight * 2, 'narrow wrapping fixture did not wrap'],
  ] as const
  const failed = assertions.filter(([ok]) => !ok).map(([, message]) => message)
  const result = document.getElementById('result')!
  result.dataset.status = failed.length ? 'fail' : 'pass'
  result.textContent = JSON.stringify({ metrics, failed })
}

verify().catch((error) => {
  const result = document.getElementById('result')!
  result.dataset.status = 'fail'
  result.textContent = JSON.stringify({ failed: [error instanceof Error ? error.message : String(error)] })
})
