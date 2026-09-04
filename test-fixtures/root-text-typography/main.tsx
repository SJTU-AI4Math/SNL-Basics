import React from 'react'
import { createRoot } from 'react-dom/client'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { SnlSyntaxTreeView } from '../../src/components/SnlSyntaxTreeView'
import { parseSnlSyntaxTree } from '../../src/snl-syntax-tree/parser'
import { createSnlSyntaxTreeNode } from '../../src/snl-syntax-tree/types'
import { MacroDataDriver } from '../../src/snl-macro/macro-data-driver'
import type { SnlMacro } from '../../src/snl-macro/types'
import { EntryDataDriver } from '../../src/entry-react/entry-data-driver'
import { EntrySurface } from '../../src/entry-react/entry-render'

declare const __SNL_TYPOGRAPHY_VERIFY_NONCE__: string

const mode = document.body.dataset.mode
if (mode === 'entry') await import('../../src/entry-react/style.css')
else await import('../../src/snl-react-view/style.css')

const enumerateMacro: SnlMacro = {
  name: 'tex-list',
  description: '',
  source: { entries: [], urls: [] },
  dynamic_arity: true,
  tags: [],
  styles: [{
    style_name: 'default',
    tags: [],
    template: { mode: 'block', body: '#*', separator: '', block_template_name: 'enumerate' },
  }],
}
const noteMacro: SnlMacro = {
  name: 'note', description: '', source: { entries: [], urls: [] }, dynamic_arity: false, tags: [],
  styles: [{ style_name: 'default', tags: [], template: { mode: 'text', body: '注意以下几点：#0' } }],
}
const itemMacro: SnlMacro = {
  name: 'text-item', description: '', source: { entries: [], urls: [] }, dynamic_arity: false, tags: [],
  styles: [{ style_name: 'default', tags: [], template: { mode: 'text', body: '嵌套列表正文' } }],
}
const formulaSemanticMacro: SnlMacro = {
  name: 'formula-semantic', description: '', source: { entries: [], urls: [] }, dynamic_arity: false, kind: 'fvar', tags: [],
  styles: [{ style_name: 'default', tags: [], template: { mode: 'formula_inline', body: 'x' } }],
}
const macroDriver = new MacroDataDriver({ queries: {
  query_macro: async ({ macro_name }) => macro_name === 'tex-list' ? enumerateMacro : macro_name === 'note' ? noteMacro : macro_name === 'text-item' ? itemMacro : macro_name === 'formula-semantic' ? formulaSemanticMacro : null,
} })
const entryDriver = new EntryDataDriver({ queries: { query_entry: async () => null, query_entry_kind: async () => null } })
const source = '%$x$ 中文 TeX 正文 Hamburgefontsiv root text with an uninterrupted_identifier_that_must_wrap_narrowly%'
const blockSource = 'tex-list(%第一项中文 TeX prose wraps across several lines in this narrow list%,%第二项 $x_i$ 与正文%)'
const nestedBlockTree = createSnlSyntaxTreeNode('note', { children: [
  createSnlSyntaxTreeNode('tex-list', { children: [createSnlSyntaxTreeNode('text-item')] }),
] })

function Surface() {
  const rendered = mode === 'entry'
    ? <EntrySurface entry={{ id: 'root-text', kind: 'definition', title: '中文 TeX Root Text', content: { snl: source } }} kind={null} entry_data_driver={entryDriver} macro_data_driver={macroDriver} />
    : <SnlSyntaxTreeView tree={parseSnlSyntaxTree(source)} macro_data_driver={macroDriver} />
  return <>
    <div id="surface" style={{ width: '11rem', fontSize: '16px' }}>{rendered}</div>
    <div id="block-surface" style={{ width: '11rem', fontSize: '16px' }}>
      <SnlSyntaxTreeView tree={parseSnlSyntaxTree(blockSource)} macro_data_driver={macroDriver} />
    </div>
    <div id="nested-block-surface" style={{ width: '11rem', fontSize: '16px' }}>
      <SnlSyntaxTreeView tree={nestedBlockTree} macro_data_driver={macroDriver} />
    </div>
    <div id="formula-semantic-surface">
      <SnlSyntaxTreeView tree={createSnlSyntaxTreeNode('formula-semantic')} macro_data_driver={macroDriver} />
    </div>
    <div id="reference" dangerouslySetInnerHTML={{ __html: katex.renderToString('\\text{Hamburgefontsiv}', { throwOnError: true }) }} />
    <pre id="result" data-status="pending">pending</pre>
  </>
}

createRoot(document.getElementById('app')!).render(<Surface />)

async function verify() {
  await new Promise<void>((resolve) => setTimeout(resolve, 100))
  await document.fonts.ready
  const root = document.querySelector<HTMLElement>('#surface .katex-html.snl-text')
  const math = root?.querySelector<HTMLElement>(':scope > .snl-math-span .katex')
  const reference = document.querySelector<HTMLElement>('#reference > .katex')
  const referenceText = reference?.querySelector<HTMLElement>('.mord.text')
  const listItem = document.querySelector<HTMLElement>('#block-surface .snl-block-enumerate > li')
  const listText = listItem?.querySelector<HTMLElement>('.snl-text')
  const nestedListItem = document.querySelector<HTMLElement>('#nested-block-surface .snl-block-enumerate > li')
  const nestedListText = nestedListItem?.querySelector<HTMLElement>('.snl-text')
  const formulaSemantic = document.querySelector<HTMLElement>("#formula-semantic-surface .katex [data-kind='fvar']")
  const entryTitle = document.querySelector<HTMLElement>('#surface .snl-entry-title')
  if (!root || !math || !reference || !referenceText || !listItem || !listText || !nestedListItem || !nestedListText || !formulaSemantic) throw new Error(`missing production DOM in ${mode}`)

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
  const cjkProbe = document.createElement('span')
  cjkProbe.textContent = '中文'
  cjkProbe.style.cssText = "position:absolute;white-space:nowrap;font-family:'SNL Noto Serif SC'"
  root.append(cjkProbe)
  const cjkNode = [...root.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes('中文'))
  if (!cjkNode) throw new Error('missing mixed root Text CJK run')
  const cjkStart = cjkNode.textContent!.indexOf('中文')
  const cjkRange = document.createRange()
  cjkRange.setStart(cjkNode, cjkStart)
  cjkRange.setEnd(cjkNode, cjkStart + 2)

  const rootStyle = getComputedStyle(root)
  const referenceStyle = getComputedStyle(reference)
  const markerStyle = getComputedStyle(listItem, '::marker')
  const listTextStyle = getComputedStyle(listText)
  const titleStyle = entryTitle ? getComputedStyle(entryTitle) : null
  const nestedMarkerStyle = getComputedStyle(nestedListItem, '::marker')
  const nestedListTextStyle = getComputedStyle(nestedListText)
  const formulaSemanticStyle = getComputedStyle(formulaSemantic)
  const markerBaselineProbe = document.createElement('span')
  markerBaselineProbe.textContent = '\u200b'
  listItem.prepend(markerBaselineProbe)
  const listTextRects = [...listText.getClientRects()]
  const markerBaselineProbeRect = markerBaselineProbe.getBoundingClientRect()
  const markerFirstLineDelta = listTextRects.length > 0
    ? Math.abs(markerBaselineProbeRect.top - listTextRects[0].top)
    : Number.POSITIVE_INFINITY
  const rootSize = Number.parseFloat(rootStyle.fontSize)
  const referenceSize = Number.parseFloat(referenceStyle.fontSize)
  const lineHeight = Number.parseFloat(rootStyle.lineHeight)
  const widthDelta = Math.abs(rootProbe.getBoundingClientRect().width - referenceText.getBoundingClientRect().width)
  const baselineDelta = Math.abs(literalRange.getBoundingClientRect().bottom - math.getBoundingClientRect().bottom)
  const cjkWidthDelta = Math.abs(cjkRange.getBoundingClientRect().width - cjkProbe.getBoundingClientRect().width)
  const markerSizeDelta = Math.abs(Number.parseFloat(markerStyle.fontSize) - Number.parseFloat(listTextStyle.fontSize))
  const nestedMarkerSizeDelta = Math.abs(Number.parseFloat(nestedMarkerStyle.fontSize) - Number.parseFloat(nestedListTextStyle.fontSize))
  const cjkFaces = await document.fonts.load(`400 ${rootStyle.fontSize} 'SNL Noto Serif SC'`, '中文')
  const katexFaces = await document.fonts.load(`400 ${rootStyle.fontSize} KaTeX_Main`, 'Hamburgefontsiv')
  const cjkFontResources = performance.getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((name) => /noto-serif-sc-.+\.woff2(?:[?#]|$)/.test(name))
  const cjkFontLoaded = cjkFaces.length > 0
  const katexFontLoaded = katexFaces.length > 0
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
    cjkWidthDelta,
    cjkFontLoaded,
    cjkFontResources,
    katexFontLoaded,
    markerFamily: markerStyle.fontFamily,
    markerSize: markerStyle.fontSize,
    listTextSize: listTextStyle.fontSize,
    markerSizeDelta,
    nestedMarkerSize: nestedMarkerStyle.fontSize,
    nestedListTextSize: nestedListTextStyle.fontSize,
    nestedMarkerSizeDelta,
    listTextDisplay: listTextStyle.display,
    listTextLineRects: listTextRects.length,
    markerFirstLineDelta,
    formulaSemanticDisplay: formulaSemanticStyle.display,
    titleFamily: titleStyle?.fontFamily ?? null,
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
    [cjkFontLoaded, 'bundled CJK serif face did not load'],
    [cjkFontResources.length > 0, 'bundled CJK serif loaded without a Noto WOFF2 resource'],
    [katexFontLoaded, 'KaTeX_Main did not load; metrics would only compare fallbacks'],
    [cjkWidthDelta < 0.5, 'root CJK run did not use the bundled serif face'],
    [markerStyle.fontFamily.includes('SNL Noto Serif SC'), 'block marker is outside the TeX prose family'],
    [markerSizeDelta < 0.05, 'block marker size differs from adjacent prose'],
    [nestedMarkerSizeDelta < 0.05, 'text-embedded block marker compounds relative to adjacent prose'],
    [listTextStyle.display === 'inline', 'native list text became an atomic inline-block'],
    [listTextRects.length >= 2, 'narrow list marker fixture did not wrap across lines'],
    [markerFirstLineDelta < 5, 'native list marker baseline does not align with the first text line'],
    [formulaSemanticStyle.display === 'inline-block', 'KaTeX semantic metadata lost its atomic display'],
    [mode !== 'entry' || titleStyle?.fontFamily.includes('SNL Noto Serif SC'), 'Entry title is outside the TeX prose family'],
    [root.scrollWidth <= root.clientWidth + 1, 'narrow root Text overflows instead of wrapping'],
    [root.getBoundingClientRect().height > lineHeight * 2, 'narrow wrapping fixture did not wrap'],
  ] as const
  const failed = assertions.filter(([ok]) => !ok).map(([, message]) => message)
  const result = document.getElementById('result')!
  result.dataset.status = failed.length ? 'fail' : 'pass'
  result.textContent = JSON.stringify({ nonce: __SNL_TYPOGRAPHY_VERIFY_NONCE__, metrics, failed })
}

verify().catch((error) => {
  const result = document.getElementById('result')!
  result.dataset.status = 'fail'
  result.textContent = JSON.stringify({ nonce: __SNL_TYPOGRAPHY_VERIFY_NONCE__, failed: [error instanceof Error ? error.message : String(error)] })
})
