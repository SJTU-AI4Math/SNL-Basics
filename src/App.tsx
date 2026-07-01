import { useEffect, useMemo, useState, type KeyboardEventHandler } from 'react'
import {
  createDefaultMacroTemplateQuery,
  loadSnlMacroDb,
  SnlSyntaxTreeEditor,
  SnlSyntaxTreeView,
  parseSnlSyntaxTree,
  serializeSnlSyntaxTree,
  tryParseSnlSyntaxTree,
  type SnlSyntaxTree,
  type SnlMacroDb,
} from './snl-react-view'

const INITIAL_INPUT =
  'FOL.forall.binder(x,FOL.implies.infix(FOL.app.apply(P,x),FOL.paren.round(FOL.or.infix(y,FOL.app.apply(Q,x)))))'

const MAX_UNDO_CHECKPOINTS = 10

// 用简洁文本方式展示树形层级，方便肉眼检查 parser/编辑器结果。
function toTreeDiagram(node: SnlSyntaxTree, depth = 0): string {
  const prefix = `${'  '.repeat(depth)}- `
  const line = `${prefix}${node.name}`
  if (node.children.length === 0) {
    return line
  }
  return `${line}\n${node.children.map((child) => toTreeDiagram(child, depth + 1)).join('\n')}`
}

function cloneTree(node: SnlSyntaxTree): SnlSyntaxTree {
  return {
    name: node.name,
    kind: node.kind,
    mdata: node.mdata,
    children: node.children.map((child) => cloneTree(child)),
  }
}

function buildMatchSignature(node: SnlSyntaxTree, db: SnlMacroDb): string {
  const nameMatched = Boolean(db[node.name])
  const current = `${Number(nameMatched)}`
  if (node.children.length === 0) {
    return current
  }
  return `${current}(${node.children.map((child) => buildMatchSignature(child, db)).join('|')})`
}

export default function App() {
  const [expression, setExpression] = useState(INITIAL_INPUT)
  const [tree, setTree] = useState<SnlSyntaxTree>(() => parseSnlSyntaxTree(INITIAL_INPUT))
  const [parseError, setParseError] = useState<string | null>(null)
  const [latexSource, setLatexSource] = useState('')
  const [templateDb, setTemplateDb] = useState<SnlMacroDb>({})
  const [, setUndoStack] = useState<SnlSyntaxTree[]>([])
  const query = useMemo(() => createDefaultMacroTemplateQuery(), [])
  const treeString = useMemo(() => serializeSnlSyntaxTree(tree), [tree])
  const treeDiagram = useMemo(() => toTreeDiagram(tree), [tree])

  useEffect(() => {
    void loadSnlMacroDb()
      .then((db) => setTemplateDb(db))
      .catch(() => setTemplateDb({}))
  }, [])

  const parseFromInput = () => {
    const result = tryParseSnlSyntaxTree(expression)
    if (result.ok) {
      setParseError(null)
      setTree(result.tree)
      setUndoStack([])
    } else {
      setParseError(result.error)
    }
  }

  const handleTreeChange = (next: SnlSyntaxTree) => {
    const prevSignature = buildMatchSignature(tree, templateDb)
    const nextSignature = buildMatchSignature(next, templateDb)

    if (prevSignature !== nextSignature) {
      setUndoStack((prev) => {
        const appended = [...prev, cloneTree(tree)]
        return appended.length > MAX_UNDO_CHECKPOINTS
          ? appended.slice(appended.length - MAX_UNDO_CHECKPOINTS)
          : appended
      })
    }
    setTree(next)
  }

  const handleUndo = () => {
    setUndoStack((prev) => {
      if (prev.length === 0) {
        return prev
      }
      const target = prev[prev.length - 1]
      setTree(cloneTree(target))
      return prev.slice(0, -1)
    })
  }

  const handleKeyDownCapture: KeyboardEventHandler<HTMLDivElement> = (e) => {
    const isUndo = (e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')
    if (!isUndo) {
      return
    }
    e.preventDefault()
    e.stopPropagation()
    handleUndo()
  }

  return (
    <div className="page" onKeyDownCapture={handleKeyDownCapture}>
      <h1>SnlSyntaxTree 全量 Demo</h1>
      <div className="section">
        <h2>1) Parser 输入</h2>
        <p>
          语法：name（含点缀后缀，如 DivRing.div.frac）(child1,child2(…))。方括号 [style]
          语法已废弃：请把 style 写成点缀后缀，例如 FOL.forall.binder(x,…)、DivRing.div.frac(a,b)。
          量词首个子节点即绑定变量；裸名叶子是否在作用域内由编译期推断为 bvar / fvar。
        </p>
        <div className="row">
          <input
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            className="expr-input"
          />
          <button type="button" onClick={parseFromInput}>
            Parse
          </button>
        </div>
        {parseError && <div className="error">{parseError}</div>}
      </div>

      <div className="grid">
        <div className="section">
          <h2>2) SnlSyntaxTree 编辑器</h2>
          <SnlSyntaxTreeEditor value={tree} onChange={handleTreeChange} templateDb={templateDb} />
        </div>

        <div className="section">
          <h2>3) KaTeX 渲染结果</h2>
          <SnlSyntaxTreeView
            tree={tree}
            query={query}
            templateDb={templateDb}
            katexOptions={{ displayMode: true, trust: true }}
            onResolved={setLatexSource}
          />
        </div>
      </div>

      <div className="grid">
        <div className="section">
          <h2>4) 当前树结构（字符串 + 示意图）</h2>
          <div className="panel-subtitle">字符串</div>
          <pre className="panel-pre">{treeString}</pre>
          <div className="panel-subtitle">树示意图</div>
          <pre className="panel-pre">{treeDiagram}</pre>
        </div>

        <div className="section">
          <h2>5) 生成的 KaTeX 源码</h2>
          <pre className="latex-preview">{latexSource || '等待生成...'}</pre>
        </div>
      </div>
    </div>
  )
}
