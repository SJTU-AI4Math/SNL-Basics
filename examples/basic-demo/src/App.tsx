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
import { DEMO_MACROS, DEMO_PRESETS, DEMO_SVG_SOURCES, type DemoPreset } from './demoPresets'

const INITIAL_INPUT = DEMO_PRESETS[0].source
const SAMPLES = ['群.示例(@x,x)', 'Théorie.groupe(élément)', 'Ελληνικά.Ομάδα(αντικείμενο)']

const svgAssets = new SvgTemplateAssetRegistry({
  loader: async (identity) => {
    const source = DEMO_SVG_SOURCES[identity.source]
    if (!source) throw new Error(`Unknown demo SVG: ${identity.source}`)
    return source
  },
  maxSettled: DEMO_PRESETS.length,
})
const svgRenderer = createSvgTemplateRenderer({ assetRegistry: svgAssets })

const macroDb: Record<string, SnlMacro> = {
  ...DEMO_MACROS,
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
  const [activePresetId, setActivePresetId] = useState<DemoPreset['id'] | null>(DEMO_PRESETS[0].id)

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
    setActivePresetId(DEMO_PRESETS.find((preset) => preset.source === source)?.id ?? null)
  }

  return <div className="page">
    <h1>SNL-Basics — Entry demo</h1>
    <p className="lede">
      Rendering, hover previews, click-to-pin, recursive popovers, and blank-click dismissal all use
      the public Entry route. Switch among the presets to see complex mathematical artwork whose formula objects remain ordinary SNL child trees.
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

    <section className="section">
      <h2>2 · Mathematical SVG presets</h2>
      <p className="hint">Every label is a formula/text Macro child. The SVG owns only curves, arrows, axes, and geometric artwork.</p>
      <div className="preset-grid" role="list" aria-label="Mathematical diagram presets">
        {DEMO_PRESETS.map((preset) => <div key={preset.id} role="listitem">
          <button
            type="button"
            className="preset"
            aria-pressed={preset.id === activePresetId}
            onClick={() => load(preset.source)}
          >
            <strong>{preset.label}</strong>
            <span>{preset.description}</span>
          </button>
        </div>)}
      </div>
    </section>

    <section className="section demo-entry-stage">
      <h2>3 · Entry route</h2>
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
      <h2>4 · SNL syntax tree</h2>
      <div className="grid">
        <div><div className="panel-subtitle">Serialized</div><pre className="panel-pre">{treeString}</pre></div>
        <div><div className="panel-subtitle">Outline</div><pre className="panel-pre">{treeDiagram}</pre></div>
      </div>
    </section>
  </div>
}
