import React from 'react'
import { createRoot } from 'react-dom/client'
import { ReaderRuntime } from '../../src/runtime'
import { SnlSyntaxTreeView } from '../../src/components/SnlSyntaxTreeView'
import { MacroDataDriver } from '../../src/snl-macro/macro-data-driver'
import type { SnlMacro } from '../../src/snl-macro/types'
import { parseSnlSyntaxTree } from '../../src/snl-syntax-tree/parser'
import { serializeSnlSyntaxTree } from '../../src/snl-react-view/serialize'

/** Read the painted HTML channel, excluding KaTeX's hidden MathML/TeX annotation. */
export function automaticStyleText(host: Element): string {
  const html = host.querySelector('.katex-html')?.cloneNode(true) as HTMLElement | undefined
  html?.querySelectorAll('.katex-mathml').forEach(node => node.remove())
  return html?.textContent ?? ''
}

/** Ordinary fixed templates: no opaque backend fields can bypass inference. */
export function automaticStyleFixture(display = false) {
  const macro: SnlMacro = {
    name: 'AutoStyle', description: '', source: { entries: [], urls: [] },
    kind: 'const', dynamic_arity: false, tags: [],
    styles: [
      { style_name: 'full', tags: [], template: { mode: 'text', body: 'FULL #0 : #1 = #2' } },
      { style_name: 'body', tags: [], template: {
        type: 'i18n', default_language: 'en', values: {
          en: display ? { mode: 'formula_display', body: '\\mathrm{BODY} #0 = #2' } : { mode: 'text', body: 'BODY #0 = #2' },
          zh: display ? { mode: 'formula_display', body: '\\mathrm{ZH} #2 = #0' } : { mode: 'text', body: '正文 #2 = #0' },
        },
      } },
    ],
  }
  let language = 'en'
  let requests = 0
  const driver = new MacroDataDriver({
    context_reader: () => ({ language, color_scheme: 'light' }),
    queries: { query_macro: async ({ macro_name }) => {
      if (macro_name !== macro.name) return null
      requests++
      return macro
    } },
  })
  return {
    macro, driver, runtime: new ReaderRuntime({ queries: { query_environment: () => ({ language }) } }), setLanguage: (value: string) => { language = value },
    requests: () => requests,
    full: parseSnlSyntaxTree('AutoStyle(@x,T,x@x)'),
    body: parseSnlSyntaxTree('AutoStyle(@x,,x@x)'),
    explicit: parseSnlSyntaxTree('AutoStyle[full](@x,,x@x)'),
  }
}

/** Executed in real Chromium by the existing typography verifier, not a DOM mock. */
export async function verifyAutomaticStyle() {
  const fixture = automaticStyleFixture()
  const host = document.createElement('section')
  host.id = 'automatic-style-surface'
  document.getElementById('app')!.append(host)
  const root = createRoot(host)
  const sources = [fixture.full, fixture.body, fixture.explicit]
  const before = sources.map(serializeSnlSyntaxTree)
  const jsonBefore = JSON.stringify(sources)
  const macroBefore = JSON.stringify(fixture.macro)
  const cachedMacro = await fixture.driver.query_macro({ macro_name: fixture.macro.name })
  const snapshots: unknown[] = []
  const check = (ok: unknown, message: string) => { if (!ok) throw new Error(`automatic Style: ${message}`) }
  const settle = async () => {
    for (let n = 0; n < 100; n++) {
      await new Promise(resolve => setTimeout(resolve, 10))
      if (host.querySelectorAll('[data-name="AutoStyle"]').length === 2 && !host.querySelector('.katex-error')) return
    }
    throw new Error('automatic Style: production render did not settle')
  }
  const renderPair = (tree: typeof fixture.body) => root.render(<React.Fragment>
    <div data-case="changing"><SnlSyntaxTreeView tree={tree} macro_data_driver={fixture.driver} reader_runtime={fixture.runtime} /></div>
    <div data-case="full"><SnlSyntaxTreeView tree={fixture.full} macro_data_driver={fixture.driver} reader_runtime={fixture.runtime} /></div>
  </React.Fragment>)
  try {
    for (const [stage, tree, language, expected] of [
      ['initial', fixture.body, 'en', 'BODY x = x'],
      ['occupied', fixture.full, 'en', 'FULL x : T = x'],
      ['empty-again', fixture.body, 'en', 'BODY x = x'],
      ['localized', fixture.body, 'zh', '正文 x = x'],
      ['explicit', fixture.explicit, 'zh', 'FULL x : 1 = x'],
    ] as const) {
      fixture.setLanguage(language)
      renderPair(tree)
      // Allow React's async source resolution to commit after the parent rerender.
      await new Promise(resolve => setTimeout(resolve, 100))
      await settle()
      const changing = host.querySelector<HTMLElement>('[data-case="changing"]')!
      const text = automaticStyleText(changing)
      const fullText = automaticStyleText(host.querySelector('[data-case="full"]')!)
      check(text === expected, `${stage} exact-slot rendering: expected ${expected}, got ${text}`)
      check(fullText === 'FULL x : T = x', `${stage} shared cache contaminated full sibling`)
      const binder = changing.querySelector<HTMLElement>('[data-tree-path="0"]')!
      const bound = changing.querySelector<HTMLElement>('[data-tree-path="2"]')!
      check(binder && bound, `${stage} canonical child paths missing`)
      check(binder.dataset.kind === 'binder' && bound.dataset.kind === 'bvar', `${stage} binding roles changed`)
      check(bound.dataset.src === 'x', `${stage} binding source changed`)
      const paths = [...changing.querySelectorAll<HTMLElement>('[data-tree-path]')].map(node => node.dataset.treePath)
      check((paths.indexOf('2') < paths.indexOf('0')) === (stage === 'localized'), `${stage} localized operand order changed`)
      const rect = changing.getBoundingClientRect()
      check(rect.width > 0 && rect.height > 0 && getComputedStyle(changing).display !== 'none', `${stage} not visible`)
      snapshots.push({ stage, text, fullText, paths: [binder.dataset.treePath, bound.dataset.treePath], kinds: [binder.dataset.kind, bound.dataset.kind], width: rect.width, height: rect.height })
    }
    const invalid = parseSnlSyntaxTree('AutoStyle[missing](@x,,x@x)')
    const invalidBefore = JSON.stringify(invalid)
    renderPair(invalid)
    for (let n = 0; n < 100; n++) {
      await new Promise(resolve => setTimeout(resolve, 10))
      if (host.querySelector('[data-case="changing"] .katex-error')) break
    }
    const error = host.querySelector('[data-case="changing"] .katex-error')
    check(error?.textContent?.includes('unknown style "missing"'), 'unknown explicit Style silently fell back instead of rendering an error')
    check(automaticStyleText(host.querySelector('[data-case="full"]')!) === 'FULL x : T = x', 'explicit error contaminated shared sibling')
    check(JSON.stringify(invalid) === invalidBefore, 'explicit invalid selector was rewritten on input')
    snapshots.push({ stage: 'unknown-explicit-error', error: error!.textContent })
    renderPair(fixture.body)
    for (let n = 0; n < 100; n++) {
      await new Promise(resolve => setTimeout(resolve, 10))
      if (automaticStyleText(host.querySelector('[data-case="changing"]')!) === '正文 x = x') break
    }
    check(!host.querySelector('.katex-error') && automaticStyleText(host.querySelector('[data-case="changing"]')!) === '正文 x = x', 'implicit rendering did not recover after explicit error')
    snapshots.push({ stage: 'recovered-after-error', text: automaticStyleText(host.querySelector('[data-case="changing"]')!) })
    check(JSON.stringify(sources) === jsonBefore, 'input AST/bindings mutated')
    check(JSON.stringify(sources.map(serializeSnlSyntaxTree)) === JSON.stringify(before), 'serialization changed')
    check(JSON.stringify(fixture.macro) === macroBefore, 'shared Macro mutated')
    check(await fixture.driver.query_macro({ macro_name: fixture.macro.name }) === cachedMacro, 'cached Macro identity changed')
    check(fixture.requests() === 1, 'Macro cache missed across rerenders/locales')

    const display = automaticStyleFixture(true)
    root.render(<SnlSyntaxTreeView tree={display.body} macro_data_driver={display.driver} reader_runtime={display.runtime} />)
    await new Promise(resolve => setTimeout(resolve, 100))
    const formula = host.querySelector<HTMLElement>('.katex-display .katex-html')
    check(formula?.textContent?.includes('BODY'), 'inferred formula_display did not dispatch to display KaTeX')
    check(!host.querySelector('.katex-error'), 'formula_display KaTeX error')
    snapshots.push({ stage: 'formula-display', text: formula!.textContent, display: getComputedStyle(host.querySelector('.katex-display')!).display })
    return { snapshots, macroRequests: fixture.requests(), cachedIdentity: true, serializationUnchanged: true }
  } finally {
    root.unmount()
    host.remove()
  }
}
