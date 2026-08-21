import { createContext, useContext, useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
import './style.css'
import '../../src/snl-react-view/style.css'
import { SnlSyntaxTreeView } from '../../src/components/SnlSyntaxTreeView'
import { MacroDataDriver } from '../../src/snl-macro/macro-data-driver'
import type { SnlMacroRecord } from '../../src/snl-macro/types'
import { createSnlSyntaxTreeNode } from '../../src/snl-syntax-tree/types'
import { defaultRenderers, type SnlBlockRenderer } from '../../src/snl-react-view/hooks'
import { SvgTemplateAssetRegistry } from '../../src/snl-react-view/svg-template-asset-registry'
import { createSvgTemplateRenderer } from '../../src/snl-react-view/svg-template-renderer'
import { ForeignBoxHost } from '../../src/snl-react-view/foreign-box-host'
import { useForeignBox } from '../../src/snl-react-view/use-foreign-box'
import squareSource from './commutative-square.svg?raw'

if (new URLSearchParams(location.search).has('narrow-sidebar')) {
  document.body.classList.add('narrow-sidebar-fixture')
}

const sparseRepeatedSource = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300">' +
  '<rect x="1" y="1" width="598" height="298" fill="none" stroke="currentColor" />' +
  '<g data-snl-slot="2" transform="translate(100 80)" />' +
  '<g data-snl-slot="0" transform="translate(300 150)" />' +
  '<g data-snl-slot="2" transform="translate(500 220)" />' +
  '</svg>'

const projection = {
  mode: 'block' as const,
  body: '#0#1#2#3',
  block_template_name: 'fixture-svg',
  svg_template: {
    asset: {
      source: 'commutative-square.svg',
      base_identity: 'task5-browser-fixture',
      revision: 'fixture-v1',
      request_epoch: 1,
    },
    generation: 1,
    producer_revision: 'fixture-renderer-v1',
    accessibility: { label: 'Commutative square with universal comparison maps' },
  },
}

const sparseProjection = {
  ...projection,
  body: '#0#1#2#3',
  svg_template: {
    ...projection.svg_template,
    asset: {
      ...projection.svg_template.asset,
      source: 'sparse-repeated.svg',
      revision: 'sparse-repeated-v1',
    },
    accessibility: { label: 'Sparse and repeated slots with a block child' },
  },
}

const db: SnlMacroRecord = {
  square: {
    name: 'square', description: '', source: { entries: [], urls: [] }, kind: 'const',
    dynamic_arity: false, tags: [], styles: [{ style_name: 'default', tags: [], template: projection }],
  },
  sparseSquare: {
    name: 'sparseSquare', description: '', source: { entries: [], urls: [] }, kind: 'const',
    dynamic_arity: false, tags: [], styles: [{ style_name: 'default', tags: [], template: sparseProjection }],
  },
  invalidSquare: {
    name: 'invalidSquare', description: '', source: { entries: [], urls: [] }, kind: 'const',
    dynamic_arity: true, tags: [], styles: [{ style_name: 'default', tags: [], template: { ...projection, body: '#*' } }],
  },
  labelA: {
    name: 'labelA', description: '', source: { entries: [], urls: [] }, kind: 'const',
    dynamic_arity: false, tags: [], styles: [{ style_name: 'default', tags: [], template: { mode: 'text', body: 'A left label wraps' } }],
  },
  labelB: {
    name: 'labelB', description: '', source: { entries: [], urls: [] }, kind: 'const',
    dynamic_arity: false, tags: [], styles: [{ style_name: 'default', tags: [], template: { mode: 'text', body: 'B right label wraps' } }],
  },
  labelC: {
    name: 'labelC', description: '', source: { entries: [], urls: [] }, kind: 'const',
    dynamic_arity: false, tags: [], styles: [{ style_name: 'default', tags: [], template: { mode: 'text', body: 'C' } }],
  },
  blockLabel: {
    name: 'blockLabel', description: '', source: { entries: [], urls: [] }, kind: 'const',
    dynamic_arity: false, tags: [], styles: [{ style_name: 'default', tags: [], template: { mode: 'block', body: '#0', block_template_name: 'centered' } }],
  },
  blockLeaf: {
    name: 'blockLeaf', description: '', source: { entries: [], urls: [] }, kind: 'const',
    dynamic_arity: false, tags: [], styles: [{ style_name: 'default', tags: [], template: { mode: 'text', body: 'block child' } }],
  },
  labelD: {
    name: 'labelD', description: '', source: { entries: [], urls: [] }, kind: 'const',
    dynamic_arity: false, tags: [], styles: [{ style_name: 'default', tags: [], template: { mode: 'formula_inline', body: 'f=g' } }],
  },
}
const driver = new MacroDataDriver({ queries: { query_macro: async ({ macro_name }) => db[macro_name] ?? null } })
const registry = new SvgTemplateAssetRegistry({ loader: async (identity) => identity.source === 'sparse-repeated.svg' ? sparseRepeatedSource : squareSource, maxSettled: 2 })
const BaseSvgRenderer = createSvgTemplateRenderer({ assetRegistry: registry })
const ProjectionUpdateContext = createContext(false)
const SvgRenderer: SnlBlockRenderer = (props) => {
  const alternate = useContext(ProjectionUpdateContext)
  const raw = props.template.svg_template as Record<string, unknown>
  const template = alternate ? {
    ...props.template,
    svg_template: { ...raw, accessibility: { label: 'Updated commutative square projection' } },
  } : props.template
  return <BaseSvgRenderer {...props} template={template} />
}
const labelChildren = ['labelA', 'labelB', 'labelC', 'labelD'].map((name) => createSnlSyntaxTreeNode(name))
const tree = createSnlSyntaxTreeNode('square', { children: labelChildren })
const invalidTree = createSnlSyntaxTreeNode('invalidSquare', { children: labelChildren })
const sparseChildren = [
  createSnlSyntaxTreeNode('labelA'),
  createSnlSyntaxTreeNode('labelB'),
  createSnlSyntaxTreeNode('blockLabel', { children: [createSnlSyntaxTreeNode('blockLeaf')] }),
  createSnlSyntaxTreeNode('labelD'),
]
const sparseTree = createSnlSyntaxTreeNode('sparseSquare', { children: sparseChildren })

function DepthCenterProbe() {
  const child = <div data-depth-center-child="true">depth</div>
  const foreign = useForeignBox({
    identity: { treePath: 'depth-center-probe', generation: 1, producer: 'browser-depth-probe' },
    child,
    alignment: 'center',
    ssrFallback: child,
  })
  useLayoutEffect(() => {
    foreign.reportMetrics({ width: 96, height: 20, depth: 12, baseline: 'alphabetic' })
  }, [foreign.reportMetrics])
  return <div data-depth-center-marker="true" ref={foreign.markerRef}>{foreign.ssrFallback}</div>
}

declare global {
  interface Window {
    __svgFixture?: { toggle(): void; ready(): boolean; snapshot(): unknown }
  }
}

function App() {
  const [alternate, setAlternate] = useState(false)
  window.__svgFixture = {
    toggle: () => setAlternate((value) => !value),
    ready: () => document.querySelectorAll('.fixture-frame .snl-foreign-box[data-state="positioned"]').length === 4,
    snapshot: () => {
      const svg = document.querySelector('svg.snl-svg-template-artwork')
      const host = document.querySelector('.fixture-frame') as HTMLElement | null
      return {
        svgId: svg?.id,
        markers: [...document.querySelectorAll('g[data-snl-slot]')].map((marker) => ({
          slot: marker.getAttribute('data-snl-slot'), transform: marker.getAttribute('transform'),
        })),
        positioned: document.querySelectorAll('.snl-foreign-box[data-state="positioned"]').length,
        hostWidth: host?.getBoundingClientRect().width ?? 0,
        scrollWidth: host?.scrollWidth ?? 0,
      }
    },
  }
  return <main>
    <h1>Parameterized sanitized SVG fixture</h1>
    <button id="language-toggle" onClick={() => setAlternate((value) => !value)}>toggle language/style projection</button>
    <section className={`fixture-frame ${alternate ? 'alternate' : ''}`}>
      <ProjectionUpdateContext.Provider value={alternate}>
        <SnlSyntaxTreeView
          tree={tree}
          macro_data_driver={driver}
          hooks={{ renderers: { ...defaultRenderers, 'fixture-svg': SvgRenderer } }}
        />
      </ProjectionUpdateContext.Provider>
    </section>
    <section className="sparse-block-fixture" aria-label="sparse repeated block slots">
      <SnlSyntaxTreeView
        tree={sparseTree}
        macro_data_driver={driver}
        hooks={{ renderers: { ...defaultRenderers, 'fixture-svg': SvgRenderer } }}
      />
    </section>
    <section id="fallback-probe" aria-label="fixed-arity fallback probe">
      <SnlSyntaxTreeView
        tree={invalidTree}
        macro_data_driver={driver}
        hooks={{ renderers: { ...defaultRenderers, 'fixture-svg': SvgRenderer } }}
      />
    </section>
    <section className="depth-center-probe" aria-label="nonzero-depth center alignment probe">
      <ForeignBoxHost className="depth-center-host">
        <DepthCenterProbe />
      </ForeignBoxHost>
    </section>
  </main>
}

createRoot(document.getElementById('root')!).render(<App />)
