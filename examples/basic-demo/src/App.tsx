/** SNL-Basics demo using the same public Entry rendering route as consumers. */
import { useMemo, useState } from 'react'
import {
  annotateBindings,
  createSvgTemplateRenderer,
  SvgTemplateAssetRegistry,
  parseSnlSyntaxTree,
  serializeSnlSyntaxTree,
  tryParseSnlSyntaxTree,
  type SnlMacro,
  type SnlSyntaxTree,
} from '@sjtu-ai4math/snl-basics'
import {
  EntryDataDriver,
  EntryPreviewProvider,
  EntrySurface,
  MacroDataDriver,
  type EntryData,
  type EntryKind,
} from '@sjtu-ai4math/snl-basics/entry'

const INITIAL_INPUT = 'Demo.formula(Demo.svgDiagram(Demo.A,Demo.B,Demo.L,Demo.R))'
const SAMPLES = [INITIAL_INPUT, 'Demo.svgDiagram(Demo.A,Demo.B,Demo.L,Demo.R)', '群.示例(@x,x)', 'Théorie.groupe(élément)', 'Ελληνικά.Ομάδα(αντικείμενο)']

const SVG_SOURCE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 100"><rect x="2" y="2" width="236" height="96" rx="10" fill="none" stroke="#3b82f6" stroke-width="4"/><g data-snl-slot="0" transform="translate(60 28)"/><g data-snl-slot="1" transform="translate(180 28)"/><g data-snl-slot="2" transform="translate(90 55)"/><g data-snl-slot="3" transform="translate(150 55)"/><path d="M82 28H158" stroke="currentColor" stroke-width="4"/><path d="M158 28l-12-8v16z" fill="currentColor"/></svg>'
const svgAssets = new SvgTemplateAssetRegistry({
  loader: async (identity) => {
    if (identity.source !== 'demo-commutative.svg') throw new Error(`Unknown demo SVG: ${identity.source}`)
    return SVG_SOURCE
  },
  maxSettled: 4,
})
const svgRenderer = createSvgTemplateRenderer({ assetRegistry: svgAssets })

const macroDb: Record<string, SnlMacro> = {
  'Demo.formula': {
    name: 'Demo.formula', description: 'Embeds an explicitly opted-in SVG block in KaTeX.',
    source: { entries: [], urls: [] }, dynamic_arity: false, kind: 'const', tags: [],
    styles: [{ style_name: 'default', tags: [], template: { mode: 'formula_display', body: 'x + #0 = y' } }],
  },
  'Demo.svgDiagram': {
    name: 'Demo.svgDiagram', description: 'A parameterized four-slot SVG template.',
    source: { entries: [], urls: [] }, dynamic_arity: false, kind: 'const', tags: [],
    styles: [{ style_name: 'default', tags: [], template: {
      mode: 'block', body: '#0#1#2#3', block_template_name: 'svg_template',
      svg_template: {
        asset: { source: 'demo-commutative.svg', base_identity: 'basic-demo', revision: 'demo-v1', request_epoch: 1 },
        generation: 1, producer_revision: 'basic-demo-v1',
        accessibility: { label: 'Demo commutative diagram from A to B' },
        formula_embed: { total_height_em: 3.2, baseline_ratio: 0.72 },
      },
    } }],
  },
  'Demo.A': { name: 'Demo.A', description: 'Formula slot A.', source: { entries: [], urls: [] }, dynamic_arity: false, kind: 'const', tags: [], styles: [{ style_name: 'default', tags: [], template: { mode: 'formula_inline', body: 'A' } }] },
  'Demo.B': { name: 'Demo.B', description: 'Formula slot B.', source: { entries: [], urls: [] }, dynamic_arity: false, kind: 'const', tags: [], styles: [{ style_name: 'default', tags: [], template: { mode: 'formula_inline', body: 'B' } }] },
  'Demo.L': { name: 'Demo.L', description: 'Text slot L.', source: { entries: [], urls: [] }, dynamic_arity: false, kind: 'const', tags: [], styles: [{ style_name: 'default', tags: [], template: { mode: 'text', body: 'L' } }] },
  'Demo.R': { name: 'Demo.R', description: 'Text slot R.', source: { entries: [], urls: [] }, dynamic_arity: false, kind: 'const', tags: [], styles: [{ style_name: 'default', tags: [], template: { mode: 'text', body: 'R' } }] },
  '群.示例': {
    name: '群.示例', description: 'A source-backed group example.',
    source: { entries: ['demo.group.zh'], urls: [] }, dynamic_arity: false, kind: 'const', tags: [],
    styles: [{ style_name: 'default', tags: [], template: { mode: 'formula_inline', body: '\\operatorname{群}(#0,#1)' } }],
  },
  'Théorie.groupe': {
    name: 'Théorie.groupe', description: 'Un exemple de groupe.',
    source: { entries: ['demo.group.fr'], urls: [] }, dynamic_arity: false, kind: 'const', tags: [],
    styles: [{ style_name: 'default', tags: [], template: { mode: 'formula_inline', body: '\\operatorname{Groupe}(#0)' } }],
  },
  'Ελληνικά.Ομάδα': {
    name: 'Ελληνικά.Ομάδα', description: 'Παράδειγμα ομάδας.',
    source: { entries: ['demo.group.el'], urls: [] }, dynamic_arity: false, kind: 'const', tags: [],
    styles: [{ style_name: 'default', tags: [], template: { mode: 'formula_inline', body: '\\operatorname{Ομάδα}(#0)' } }],
  },
}

const entries: Record<string, EntryData> = {
  'demo.group.zh': { id: 'demo.group.zh', kind: 'definition', title: '群示例', content: { markdown: '这是由 Macro source 打开的 Entry 浮窗。' } },
  'demo.group.fr': { id: 'demo.group.fr', kind: 'definition', title: 'Exemple de groupe', content: { markdown: 'Cette fenêtre est rendue récursivement par `EntryView`.' } },
  'demo.group.el': { id: 'demo.group.el', kind: 'definition', title: 'Παράδειγμα ομάδας', content: { markdown: 'Αυτό το αναδυόμενο παράθυρο ακολουθεί τη διαδρομή Entry.' } },
}

const entryKinds: Record<string, EntryKind> = {
  definition: {
    id: 'definition', name: 'Definition',
    coloring: {
      light: { stroke: '#1677a6', background: '#eef8fc' },
      dark: { stroke: '#72c7ec', background: '#102832' },
    },
  },
}

function toTreeDiagram(node: SnlSyntaxTree, depth = 0): string {
  const style = node.style_name ? `[${node.style_name}]` : ''
  const line = `${'  '.repeat(depth)}- ${node.macro_name}${style}  (kind=${node.kind})`
  return node.children.length === 0 ? line : `${line}\n${node.children.map((child) => toTreeDiagram(child, depth + 1)).join('\n')}`
}

function buildTree(source: string): SnlSyntaxTree {
  const tree = parseSnlSyntaxTree(source)
  annotateBindings(tree)
  return tree
}

export default function App() {
  const [expression, setExpression] = useState(INITIAL_INPUT)
  const [renderedSource, setRenderedSource] = useState(INITIAL_INPUT)
  const [tree, setTree] = useState<SnlSyntaxTree>(() => buildTree(INITIAL_INPUT))
  const [parseError, setParseError] = useState<string | null>(null)

  const macroDriver = useMemo(() => new MacroDataDriver({
    queries: { query_macro: async ({ macro_name }) => macroDb[macro_name] ?? null },
    context_reader: () => ({ color_scheme: 'light' }),
  }), [])
  const entryDriver = useMemo(() => new EntryDataDriver({
    queries: {
      query_entry: async ({ entry_id }) => entries[entry_id] ?? null,
      query_entry_kind: async ({ kind_id }) => entryKinds[kind_id] ?? null,
    },
    context_reader: () => ({ color_scheme: 'light' }),
  }), [])

  const treeString = useMemo(() => serializeSnlSyntaxTree(tree), [tree])
  const treeDiagram = useMemo(() => toTreeDiagram(tree), [tree])
  const rootEntry: EntryData = {
    id: 'demo.current', kind: 'definition', title: 'Interactive Entry',
    content: { snl: renderedSource },
  }

  const load = (source: string) => {
    setExpression(source)
    const result = tryParseSnlSyntaxTree(source)
    if (!result.ok) { setParseError(result.error); return }
    annotateBindings(result.tree)
    setParseError(null)
    setRenderedSource(source)
    setTree(result.tree)
  }

  return <div className="page">
    <h1>SNL-Basics — Entry demo</h1>
    <p className="lede">
      Rendering, hover previews, click-to-pin, recursive popovers, and blank-click dismissal all use
      the public Entry route. The default sample embeds a parameterized SVG foreign box in KaTeX; hover or click a source-backed Macro in the other samples.
    </p>

    <section className="section">
      <h2>1 · Source</h2>
      <p className="hint">Binder sites use <code>@name</code>. Click a sample, then hover or click its named Macro.</p>
      <div className="row">
        <input className="expr-input" value={expression} onChange={(event) => setExpression(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') load(expression) }} />
        <button type="button" onClick={() => load(expression)}>Parse</button>
      </div>
      <div className="samples">{SAMPLES.map((sample) => <button key={sample} type="button" className="sample" onClick={() => load(sample)}>{sample}</button>)}</div>
      {parseError && <div className="error">{parseError}</div>}
    </section>

    <section className="section demo-entry-stage">
      <h2>2 · Entry route</h2>
      <EntryPreviewProvider
        entry_data_driver={entryDriver}
        macro_data_driver={macroDriver}
        options={{ openDelayMs: 300, fadeMs: 100 }}
        style={{ maxWidth: 620, background: 'var(--demo-surface, white)', boxShadow: '0 8px 28px rgba(0,0,0,.28)' }}
      >
        <EntrySurface
          entry={rootEntry}
          kind={entryKinds.definition}
          entry_data_driver={entryDriver}
          macro_data_driver={macroDriver}
          hooks={{ renderers: { svg_template: svgRenderer } }}
        />
      </EntryPreviewProvider>
    </section>

    <section className="section">
      <h2>3 · Parser diagnostics</h2>
      <div className="grid">
        <div><div className="panel-subtitle">Serialized</div><pre className="panel-pre">{treeString}</pre></div>
        <div><div className="panel-subtitle">Outline</div><pre className="panel-pre">{treeDiagram}</pre></div>
      </div>
    </section>
  </div>
}
