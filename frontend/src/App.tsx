import { useEffect, useMemo, useState, type KeyboardEventHandler } from 'react'
import { OperatorTreeEditor } from './components/OperatorTreeEditor/OperatorTreeEditor'
import { OperatorTreeKaTeXView } from './components/OperatorTreeKaTeXView'
import type { KaTeXTemplateQuery } from './operator-tree/query'
import { parseOperatorTree } from './operator-tree/parser'
import type { TemplateDb } from './operator-tree/template-db'
import type { OperatorTree } from './operator-tree/types'

const INITIAL_INPUT = 'DivRing.div[frac](Add.add[infix](Mul.mul[infix](a,b),c),Sub.sub[infix](d,e))'

const MAX_UNDO_CHECKPOINTS = 10

let dbCache: TemplateDb | null = null

function escapeLatexText(raw: string): string {
  return raw.replace(/[\\{}_$%&#^~]/g, (ch) => `\\${ch}`)
}

function fallbackLatexSymbol(name: string): string {
  // 常见变量名直接透传；复杂名字用 \mathrm{...} 包裹，减少 KaTeX 语法错误风险。
  if (/^[A-Za-z]+$/.test(name)) {
    return name
  }
  return `\\mathrm{${escapeLatexText(name)}}`
}

async function loadTemplateDb(): Promise<TemplateDb> {
  if (dbCache) {
    return dbCache
  }
  const res = await fetch('/katex-template-db.json')
  if (!res.ok) {
    throw new Error(`template db load failed (${res.status})`)
  }
  dbCache = (await res.json()) as TemplateDb
  return dbCache
}

function createDbQuery(): KaTeXTemplateQuery {
  return async ({ name, style }) => {
    // 模拟一次异步数据库查询延迟。
    await new Promise((resolve) => setTimeout(resolve, 100))
    const db = await loadTemplateDb()
    const byName = db[name]
    const templateFromStyle = style ? byName?.styles?.[style]?.latex : undefined
    const firstStyleTemplate =
      !style && byName
        ? Object.values(byName.styles)[0]?.latex
        : undefined
    const template = templateFromStyle ?? firstStyleTemplate
    if (template) {
      return template
    }
    return `\\htmlData{name=@NAME@,style=@STYLE@,kind=bvar}{${fallbackLatexSymbol(name)}}`
  }
}

function tryParseTree(input: string): { tree: OperatorTree | null; error: string | null } {
  try {
    return { tree: parseOperatorTree(input), error: null }
  } catch (error) {
    return {
      tree: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// 把树结构还原成输入语法，便于用户复制和二次编辑。
function serializeOperatorTree(node: OperatorTree): string {
  const stylePart = node.style ? `[${node.style}]` : ''
  const childrenPart =
    node.children.length > 0
      ? `(${node.children.map((child) => serializeOperatorTree(child)).join(',')})`
      : ''
  return `${node.name}${stylePart}${childrenPart}`
}

// 用简洁文本方式展示树形层级，方便肉眼检查 parser/编辑器结果。
function toTreeDiagram(node: OperatorTree, depth = 0): string {
  const prefix = `${'  '.repeat(depth)}- `
  const line = `${prefix}${node.name}${node.style ? ` [${node.style}]` : ''}`
  if (node.children.length === 0) {
    return line
  }
  return `${line}\n${node.children.map((child) => toTreeDiagram(child, depth + 1)).join('\n')}`
}

function cloneTree(node: OperatorTree): OperatorTree {
  return {
    name: node.name,
    style: node.style,
    kind: node.kind,
    mdata: node.mdata,
    children: node.children.map((child) => cloneTree(child)),
  }
}

function buildMatchSignature(node: OperatorTree, db: TemplateDb): string {
  const nameMatched = Boolean(db[node.name])
  const styleMatched = Boolean(node.style && db[node.name]?.styles?.[node.style])
  const current = `${Number(nameMatched)}${Number(styleMatched)}`
  if (node.children.length === 0) {
    return current
  }
  return `${current}(${node.children.map((child) => buildMatchSignature(child, db)).join('|')})`
}

export default function App() {
  const [expression, setExpression] = useState(INITIAL_INPUT)
  const [tree, setTree] = useState<OperatorTree>(() => parseOperatorTree(INITIAL_INPUT))
  const [parseError, setParseError] = useState<string | null>(null)
  const [latexSource, setLatexSource] = useState('')
  const [templateDb, setTemplateDb] = useState<TemplateDb>({})
  const [, setUndoStack] = useState<OperatorTree[]>([])
  const query = useMemo(() => createDbQuery(), [])
  const treeString = useMemo(() => serializeOperatorTree(tree), [tree])
  const treeDiagram = useMemo(() => toTreeDiagram(tree), [tree])

  useEffect(() => {
    void loadTemplateDb()
      .then((db) => setTemplateDb(db))
      .catch(() => setTemplateDb({}))
  }, [])

  const parseFromInput = () => {
    const result = tryParseTree(expression)
    setParseError(result.error)
    if (result.tree) {
      setTree(result.tree)
      setUndoStack([])
    }
  }

  const handleTreeChange = (next: OperatorTree) => {
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
      <h1>OperatorTree 全量 Demo</h1>
      <div className="section">
        <h2>1) Parser 输入</h2>
        <p>语法：name[style](child1,child2(...))，例如 DivRing.div[frac](a,b)</p>
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
          <h2>2) OperatorTree 编辑器</h2>
          <OperatorTreeEditor value={tree} onChange={handleTreeChange} templateDb={templateDb} />
        </div>

        <div className="section">
          <h2>3) KaTeX 渲染结果</h2>
          <OperatorTreeKaTeXView
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
