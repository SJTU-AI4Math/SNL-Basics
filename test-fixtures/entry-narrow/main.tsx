import React from 'react'
import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
import '../../dist-lib/entry.css'
import { EntrySurface } from '../../src/entry-react/entry-render'
import { EntryDataDriver, type EntryContent, type EntryData } from '../../src/entry-react/entry-data-driver'
import { MacroDataDriver } from '../../src/snl-macro/macro-data-driver'
import type { SnlMacroRecord } from '../../src/snl-macro/types'

const long = 'ContainmentToken'.repeat(24)
const longId = `semantic-${'identifier'.repeat(28)}`
const macros: SnlMacroRecord = {
  LongText: {
    name: 'LongText', description: '', source: { entries: [], urls: [] }, kind: 'const', dynamic_arity: false, tags: [],
    styles: [{ style_name: 'default', template: { mode: 'text', body: longId }, tags: [] }],
  },
  MixedText: {
    name: 'MixedText', description: '', source: { entries: [], urls: [] }, kind: 'const', dynamic_arity: false, tags: [],
    styles: [{ style_name: 'default', template: { mode: 'text', body: `${longId} #0 tail` }, tags: [] }],
  },
}
const macroDriver = new MacroDataDriver({ queries: { query_macro: async ({ macro_name }) => macros[macro_name] ?? null } })
const entryDriver = new EntryDataDriver({ queries: { query_entry: async () => null, query_entry_kind: async () => null } })
const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="40"><rect width="1600" height="40" fill="red"/></svg>')}`

const scenarios: Array<{ id: string; content: EntryContent; title?: string; pointer?: unknown }> = [
  { id: 'title', title: long, content: { text: 'short' }, pointer: { source: true } },
  { id: 'plain', content: { text: long } },
  { id: 'typst', content: { typst: long } },
  { id: 'snl-id', content: { snl: 'LongText' } },
  { id: 'snl-formula', content: { snl: String.raw`$\underbrace{${'x+'.repeat(100)}x}_{${'long'.repeat(30)}}$` } },
  { id: 'snl-mixed', content: { snl: 'MixedText(x)' } },
  { id: 'markdown-token', content: { markdown: long } },
  { id: 'code', content: { markdown: `\`\`\`text\n${long}\n\`\`\`` } },
  { id: 'latex', content: { latex: String.raw`\underbrace{${'x+'.repeat(100)}x}_{${'long'.repeat(30)}}` } },
  { id: 'image', content: { markdown: `![oversized](${image})` } },
  { id: 'mixed', content: { markdown: `Prose ${long} with inline math $x^2+y^2=z^2$ after it.` } },
]

function card(s: typeof scenarios[number]): React.ReactElement {
  const entry: EntryData = { id: s.id, kind: 'definition', title: s.title ?? s.id, content: s.content, pointer: s.pointer }
  return <div className="scenario" data-scenario={s.id} key={s.id}><EntrySurface entry={entry} kind={null} entry_data_driver={entryDriver} macro_data_driver={macroDriver} /></div>
}

function measure(width: number): { width: number; failures: string[]; metrics: Record<string, unknown> } {
  const fixture = document.querySelector<HTMLElement>('#fixture')!
  fixture.style.width = `${width}px`
  const failures: string[] = []
  const metrics: Record<string, unknown> = {}
  const check = (ok: boolean, label: string) => { if (!ok) failures.push(label) }
  for (const host of fixture.querySelectorAll<HTMLElement>('.scenario')) {
    const id = host.dataset.scenario!
    const section = host.querySelector<HTMLElement>('section')!
    check(section.getBoundingClientRect().width <= width + 0.5, `${id}: root outer width`)
    check(host.scrollWidth <= host.clientWidth, `${id}: scenario overflow`)
  }
  const title = fixture.querySelector<HTMLElement>('[data-scenario="title"] .snl-entry-title, [data-scenario="title"] strong')!
  check(title.scrollWidth <= title.clientWidth + 1, 'title: wraps')
  const source = fixture.querySelector<HTMLElement>('[data-scenario="title"] button')!
  check(source.getBoundingClientRect().width > 0, 'title: source visible')
  for (const id of ['plain', 'typst']) {
    const pre = fixture.querySelector<HTMLElement>(`[data-scenario="${id}"] pre`)!
    check(pre.scrollWidth <= pre.clientWidth + 1, `${id}: token wraps`)
  }
  const snlName = fixture.querySelector<HTMLElement>('[data-scenario="snl-id"] .snl-text[data-name]')
  check(snlName?.dataset.name === 'LongText', 'snl-id: renders textual SNL root')
  check(snlName?.textContent === longId, 'snl-id: preserves identifier')
  const snlTextPanel = snlName.closest<HTMLElement>('.katex-panel')!
  const snlTextRange = document.createRange()
  snlTextRange.selectNodeContents(snlName)
  const snlTextRects = [...snlTextRange.getClientRects()]
  check(snlTextRects.length > 1, 'snl-id: wraps across lines')
  check(snlTextRects.every((rect) => rect.width <= snlTextPanel.clientWidth + 1), 'snl-id: line fragments contained')
  check(snlTextPanel.scrollWidth <= snlTextPanel.clientWidth + 1, 'snl-id: no horizontal scroll')
  check(getComputedStyle(snlName).overflowWrap === 'anywhere', 'snl-id: emergency wrap resolved')
  const snlPanel = fixture.querySelector<HTMLElement>('[data-scenario="snl-formula"] .katex-panel')!
  const snlFormula = snlPanel.querySelector<HTMLElement>('.katex')!
  check(getComputedStyle(snlPanel).overflowX === 'auto', 'snl-formula: panel owns local scroll')
  check(snlPanel.scrollWidth > snlPanel.clientWidth, 'snl-formula: local horizontal scroll')
  check(getComputedStyle(snlFormula).overflowWrap === 'normal', 'snl-formula: unbroken')
  const snlMixed = fixture.querySelector<HTMLElement>('[data-scenario="snl-mixed"] .snl-text')!
  const snlMixedMath = snlMixed.querySelector<HTMLElement>('.snl-math-span .katex')!
  check(snlMixed.scrollWidth <= snlMixed.clientWidth + 1, 'snl-mixed: prose wraps')
  check(getComputedStyle(snlMixedMath).overflowWrap === 'normal', 'snl-mixed: nested formula reset')
  const markdown = fixture.querySelector<HTMLElement>('[data-scenario="markdown-token"] .snl-markdown-body')!
  check(markdown.scrollWidth <= markdown.clientWidth + 1, 'markdown-token: wraps')
  const code = fixture.querySelector<HTMLElement>('[data-scenario="code"] pre')!
  check(getComputedStyle(code).whiteSpace === 'pre', 'code: white-space pre')
  check(code.scrollWidth > code.clientWidth, 'code: local horizontal scroll')
  const latexHost = fixture.querySelector<HTMLElement>('[data-scenario="latex"] .snl-latex-body')!
  check(latexHost.scrollWidth > latexHost.clientWidth, 'latex: local horizontal scroll')
  check(getComputedStyle(latexHost.querySelector('.katex')!).whiteSpace !== 'normal', 'latex: KaTeX unbroken')
  const img = fixture.querySelector<HTMLImageElement>('[data-scenario="image"] img')!
  check(img.getBoundingClientRect().width <= img.parentElement!.getBoundingClientRect().width + 0.5, 'image: max width')
  const mixed = fixture.querySelector<HTMLElement>('[data-scenario="mixed"] .snl-markdown-body')!
  check(mixed.scrollWidth <= mixed.clientWidth + 1, 'mixed: contained')
  check(Boolean(mixed.querySelector('.katex')), 'mixed: inline math retained')
  check(fixture.scrollWidth <= fixture.clientWidth, 'fixture: root contained')
  check(document.documentElement.scrollWidth <= document.documentElement.clientWidth, 'document: contained')
  metrics.fixture = { clientWidth: fixture.clientWidth, scrollWidth: fixture.scrollWidth }
  metrics.snl = {
    text: { panelClientWidth: snlTextPanel.clientWidth, panelScrollWidth: snlTextPanel.scrollWidth, lineCount: snlTextRects.length, maxLineWidth: Math.max(...snlTextRects.map((rect) => rect.width)), overflowWrap: getComputedStyle(snlName).overflowWrap },
    formula: { clientWidth: snlPanel.clientWidth, scrollWidth: snlPanel.scrollWidth, overflowX: getComputedStyle(snlPanel).overflowX, overflowWrap: getComputedStyle(snlFormula).overflowWrap },
    document: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
  }
  return { width, failures, metrics }
}

function App(): React.ReactElement {
  return <><style>{`html,body{margin:0;padding:0;max-width:100%;overflow-x:auto} #fixture{font-family:sans-serif} .scenario{width:100%;margin:0 0 12px;outline:1px dotted #999}`}</style><main id="fixture">{scenarios.map(card)}</main><pre id="result" /></>
}

createRoot(document.getElementById('root')!).render(<App />)
setTimeout(() => {
  const results = [480, 240].map(measure)
  const result = document.getElementById('result')!
  result.textContent = JSON.stringify(results, null, 2)
  result.dataset.status = results.every((item) => item.failures.length === 0) ? 'pass' : 'fail'
  ;(window as Window & { __entryNarrowResults?: unknown }).__entryNarrowResults = results
}, 500)
