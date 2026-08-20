import { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
import '../../src/snl-react-view/style.css'
import './style.css'
import { SnlSyntaxTreeView } from '../../src/components/SnlSyntaxTreeView'
import { MacroDataDriver } from '../../src/snl-macro/macro-data-driver'
import { ReaderRuntime } from '../../src/runtime'
import type { SnlMacroRecord } from '../../src/snl-macro/types'
import { createSnlSyntaxTreeNode } from '../../src/snl-syntax-tree/types'
import { defaultRenderers, type SnlBlockRenderer } from '../../src/snl-react-view/hooks'
import { SvgTemplateAssetRegistry } from '../../src/snl-react-view/svg-template-asset-registry'
import { createSvgTemplateRenderer } from '../../src/snl-react-view/svg-template-renderer'
import { FORMULA_FOREIGN_RENDERER_CAPABILITY, formulaForeignCapability } from '../../src/snl-react-view/formula-foreign-box'
import arrowSource from './arrow.svg?raw'

const projection = {
  mode: 'block' as const,
  body: '#0#1',
  block_template_name: 'fixture-formula-svg',
  svg_template: {
    asset: {
      source: 'arrow.svg', base_identity: 'task6-formula-fixture',
      revision: 'fixture-v1', request_epoch: 1,
    },
    generation: 1,
    producer_revision: 'fixture-formula-renderer-v1',
    accessibility: { label: 'Arrow from A to B' },
    formula_embed: { total_height_em: 1.8, baseline_ratio: 0.72 },
  },
}

const contexts: Record<string, string> = {
  inline: 'a+#0+b',
  numerator: '\\frac{#0}{x+1}',
  denominator: '\\frac{x+1}{#0}',
  sqrt: '\\sqrt{#0}',
  superscript: 'x^{#0}',
  subscript: 'x_{#0}',
  matrix: '\\begin{pmatrix}#0&x\\\\y&z\\end{pmatrix}',
  limits: '\\sum_{i=0}^{#0} i',
  delimiters: '\\left(#0\\right)',
}

const localizedProjection = {
  type: 'i18n' as const, default_language: 'en',
  values: {
    en: projection,
    'zh-CN': { ...projection, svg_template: { ...projection.svg_template, accessibility: { label: 'Updated arrow from A to B' } } },
    fr: { ...projection, svg_template: { ...projection.svg_template, accessibility: { label: 'Changed-height arrow from A to B' }, formula_embed: { total_height_em: 2.0, baseline_ratio: 0.72 } } },
  },
}

const db: SnlMacroRecord = {
  diagram: {
    name: 'diagram', description: '', source: { entries: [], urls: [] }, kind: 'const',
    dynamic_arity: false, tags: [], styles: [{ style_name: 'default', tags: [], template: localizedProjection }],
  },
  A: {
    name: 'A', description: '', source: { entries: [], urls: [] }, kind: 'const', dynamic_arity: false, tags: [],
    styles: [{ style_name: 'default', tags: [], template: { mode: 'formula_inline', body: 'A' } }],
  },
  B: {
    name: 'B', description: '', source: { entries: [], urls: [] }, kind: 'const', dynamic_arity: false, tags: [],
    styles: [{ style_name: 'default', tags: [], template: { mode: 'formula_inline', body: 'B' } }],
  },
}
for (const [name, body] of Object.entries(contexts)) {
  db[`context-${name}`] = {
    name: `context-${name}`, description: '', source: { entries: [], urls: [] }, kind: 'const',
    dynamic_arity: false, tags: [], styles: [{ style_name: 'default', tags: [], template: { mode: 'formula_inline', body } }],
  }
}

let currentLanguage = 'en'
const readerRuntime = new ReaderRuntime({ queries: { query_environment: () => ({ language: currentLanguage }) } })
const driver = new MacroDataDriver({ queries: { query_macro: async ({ macro_name }) => db[macro_name] ?? null } })
const registry = new SvgTemplateAssetRegistry({ loader: async () => arrowSource, maxSettled: 4 })
const BaseSvgRenderer = createSvgTemplateRenderer({ assetRegistry: registry })
let interactionCount = 0
const SvgRenderer: SnlBlockRenderer = (props) => (
  <div
    className="interactive-formula-svg"
    tabIndex={0}
    data-interactions={interactionCount}
    onClick={(event) => {
      interactionCount += 1
      event.currentTarget.dataset.interactions = String(interactionCount)
    }}
  >
    <BaseSvgRenderer {...props} />
  </div>
)
const capability = formulaForeignCapability(BaseSvgRenderer)
if (!capability) throw new Error('fixture SVG renderer lost its formula capability')
Object.defineProperty(SvgRenderer, FORMULA_FOREIGN_RENDERER_CAPABILITY, {
  value: {
    ...capability,
    prepare: async (candidate: Parameters<typeof capability.prepare>[0]) => {
      const label = (candidate.template as typeof projection).svg_template?.accessibility.label
      if (label === 'Updated arrow from A to B' || label === 'Changed-height arrow from A to B') {
        await new Promise<void>((resolve, reject) => {
          const signal = candidate.signal
          const onAbort = () => {
            clearTimeout(timer)
            signal?.removeEventListener('abort', onAbort)
            reject(new DOMException('fixture preparation aborted', 'AbortError'))
          }
          const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort)
            resolve()
          }, 20)
          signal?.addEventListener('abort', onAbort, { once: true })
          if (signal?.aborted) onAbort()
        })
      }
      return capability.prepare(candidate)
    },
  },
})
const hooks = { renderers: { ...defaultRenderers, 'fixture-formula-svg': SvgRenderer } }
const trees = Object.keys(contexts).map((name) => ({
  name,
  tree: createSnlSyntaxTreeNode(`context-${name}`, {
    children: [createSnlSyntaxTreeNode('diagram', {
      children: [createSnlSyntaxTreeNode('A'), createSnlSyntaxTreeNode('B')],
    })],
  }),
}))

declare global {
  interface Window {
    __formulaForeignFixture?: {
      ready(): boolean
      rerender(): void
      switchLanguage(): void
      switchMarkup(): void
      changedMarkupProbe(): unknown
      snapshot(): unknown
    }
  }
}

function App() {
  const [revision, setRevision] = useState(0)
  const [languageRevision, setLanguageRevision] = useState(0)
  const stableTrees = useMemo(() => trees, [])
  window.__formulaForeignFixture = {
    ready: () => document.querySelectorAll('.context .snl-foreign-box[data-state="positioned"] .interactive-formula-svg').length === stableTrees.length,
    rerender: () => setRevision(value => value + 1),
    switchLanguage: () => {
      currentLanguage = currentLanguage === 'en' ? 'zh-CN' : 'en'
      setLanguageRevision(value => value + 1)
    },
    switchMarkup: () => {
      const oldMarker = document.querySelector<HTMLElement>('.snlFormulaForeignMarker .rule')
      const oldSurface = document.querySelector<HTMLElement>('.interactive-formula-svg')
      const oldWrapper = oldSurface?.closest<HTMLElement>('.snl-foreign-box') ?? null
      ;(window as typeof window & { __changedMarkupProbe?: unknown }).__changedMarkupProbe = null
      const observer = new MutationObserver(() => {
        if (!oldMarker || oldMarker.isConnected) return
        ;(window as typeof window & { __changedMarkupProbe?: unknown }).__changedMarkupProbe = {
          wrapperConnected: oldWrapper?.isConnected ?? false,
          state: oldWrapper?.dataset.state ?? null,
          visibility: oldWrapper?.style.visibility ?? null,
          ariaHidden: oldWrapper?.getAttribute('aria-hidden') ?? null,
          inert: oldWrapper?.hasAttribute('inert') ?? false,
        }
        observer.disconnect()
      })
      observer.observe(document.body, { childList: true, subtree: true })
      currentLanguage = 'fr'
      setLanguageRevision(value => value + 1)
    },
    changedMarkupProbe: () => (window as typeof window & { __changedMarkupProbe?: unknown }).__changedMarkupProbe ?? null,
    snapshot: () => ({
      revision, languageRevision, currentLanguage,
      contexts: [...document.querySelectorAll<HTMLElement>('.context')].map(section => {
        const marker = section.querySelector<HTMLElement>('[data-snl-formula-foreign-marker]')
        const surface = section.querySelector<HTMLElement>('.interactive-formula-svg')
        const svg = surface?.querySelector<SVGSVGElement>('svg')
        const markerRect = marker?.getBoundingClientRect()
        const surfaceRect = surface?.getBoundingClientRect()
        return {
          name: section.dataset.context,
          markerId: marker?.dataset.snlFormulaForeignMarker,
          svgId: svg?.id,
          interactions: surface?.dataset.interactions,
          focused: document.activeElement === surface,
          marker: markerRect ? { x: markerRect.x, y: markerRect.y, width: markerRect.width, height: markerRect.height } : null,
          surface: surfaceRect ? { x: surfaceRect.x, y: surfaceRect.y, width: surfaceRect.width, height: surfaceRect.height } : null,
          fallbackCount: section.querySelectorAll('.snl-formula-foreign-fallback:not([hidden])').length,
          errors: section.querySelectorAll('.snl-formula-foreign-error').length,
        }
      }),
      page: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, clientHeight: document.documentElement.clientHeight, scrollHeight: document.documentElement.scrollHeight },
    }),
  }
  return <main data-revision={revision} data-language-revision={languageRevision}>
    <h1>Fixed-metric SVG boxes in KaTeX</h1>
    <button id="rerender" onClick={() => setRevision(value => value + 1)}>rerender surrounding formulas</button>
    <div className="context-grid">
      {stableTrees.map(({ name, tree }) => (
        <section className="context" data-context={name} key={name}>
          <h2>{name}</h2>
          <SnlSyntaxTreeView tree={tree} macro_data_driver={driver} reader_runtime={readerRuntime} hooks={hooks} />
        </section>
      ))}
    </div>
  </main>
}

createRoot(document.getElementById('root')!).render(<App />)
