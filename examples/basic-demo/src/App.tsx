/**
 * SNL-Basics — basic demo.
 *
 * Descendant of the original Fulcrum-Smarterm `OperatorTree` demo, rewritten
 * against the v0.1.0 public API. Everything here is imported from the package
 * root barrel — no deep `src/…` imports — so it doubles as an integration test
 * of the published tarball.
 */
import { useMemo, useState } from 'react'
import {
  MacroDataDriver,
  SnlSyntaxTreeView,
  annotateBindings,
  parseSnlSyntaxTree,
  serializeSnlSyntaxTree,
  tryParseSnlSyntaxTree,
  type SnlMacro,
  type SnlSyntaxTree,
} from '@sjtu-ai4math/snl-basics'
const macroDb: Record<string, SnlMacro> = {}

const INITIAL_INPUT = '群.示例(@x,x)'

const SAMPLES = [
  INITIAL_INPUT,
  'Théorie.groupe(élément)',
  'Ελληνικά.Ομάδα(αντικείμενο)',
]

/** Render the tree as an indented outline, for eyeballing parser output. */
function toTreeDiagram(node: SnlSyntaxTree, depth = 0): string {
  const style = node.style_name ? `[${node.style_name}]` : ''
  const line = `${'  '.repeat(depth)}- ${node.macro_name}${style}  (kind=${node.kind})`
  if (node.children.length === 0) return line
  return `${line}\n${node.children.map((c) => toTreeDiagram(c, depth + 1)).join('\n')}`
}

/** Parse + annotate binders/bound variables so hover highlighting works. */
function buildTree(source: string): SnlSyntaxTree {
  const tree = parseSnlSyntaxTree(source)
  annotateBindings(tree)
  return tree
}

export default function App() {
  const [expression, setExpression] = useState(INITIAL_INPUT)
  const [tree, setTree] = useState<SnlSyntaxTree>(() => buildTree(INITIAL_INPUT))
  const [parseError, setParseError] = useState<string | null>(null)
  const [latexSource, setLatexSource] = useState('')

  // The single query-only data source between the view and macro data.
  // Storage and transport stay entirely on the consumer side — here it is a
  // plain in-memory object; a remote backend would `fetch` inside query_macro.
  const driver = useMemo(
    () =>
      new MacroDataDriver({
        queries: {
          async query_macro({ macro_name }) {
            return macroDb[macro_name] ?? null
          },
        },
      }),
    [],
  )

  const treeString = useMemo(() => serializeSnlSyntaxTree(tree), [tree])
  const treeDiagram = useMemo(() => toTreeDiagram(tree), [tree])

  const load = (source: string) => {
    setExpression(source)
    const result = tryParseSnlSyntaxTree(source)
    if (!result.ok) {
      setParseError(result.error)
      return
    }
    annotateBindings(result.tree)
    setParseError(null)
    setTree(result.tree)
  }

  return (
    <div className="page">
      <h1>SNL-Basics — basic demo</h1>
      <p className="lede">
        Parse an SNL expression, render it through KaTeX with hover interactions, and inspect
        both the syntax tree and the generated LaTeX. Hover a symbol to see its macro tooltip;
        hover a bound variable to highlight its binder.
      </p>

      <section className="section">
        <h2>1 · Source</h2>
        <p className="hint">
          Grammar: <code>name ('[' style ']')? ('(' args ')')?</code>. The optional style bracket
          picks a render style of the same macro (same arity). Omit it to use the macro's default
          style. Binder sites use the explicit <code>@name</code> syntax; Basics does not assign
          domain semantics from Macro names.
        </p>
        <div className="row">
          <input
            className="expr-input"
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') load(expression)
            }}
          />
          <button type="button" onClick={() => load(expression)}>
            Parse
          </button>
        </div>
        <div className="samples">
          {SAMPLES.map((s) => (
            <button key={s} type="button" className="sample" onClick={() => load(s)}>
              {s}
            </button>
          ))}
        </div>
        {parseError && <div className="error">{parseError}</div>}
      </section>

      <section className="section">
        <h2>2 · Rendered</h2>
        <SnlSyntaxTreeView
          tree={tree}
          macro_data_driver={driver}
          katexOptions={{ displayMode: true }}
          onResolved={setLatexSource}
        />
      </section>

      <div className="grid">
        <section className="section">
          <h2>3 · Syntax tree</h2>
          <div className="panel-subtitle">Serialized</div>
          <pre className="panel-pre">{treeString}</pre>
          <div className="panel-subtitle">Outline</div>
          <pre className="panel-pre">{treeDiagram}</pre>
        </section>

        <section className="section">
          <h2>4 · Generated KaTeX source</h2>
          <pre className="panel-pre">{latexSource || 'resolving…'}</pre>
        </section>
      </div>
    </div>
  )
}
