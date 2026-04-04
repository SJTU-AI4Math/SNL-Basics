import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEventHandler,
} from 'react'
import katex from 'katex'
import type { KatexOptions } from 'katex'
import type { KaTeXTemplateQuery } from '../operator-tree/query'
import type { TemplateDb } from '../operator-tree/template-db'
import { bindRefAttrFragment, getBindRef, readBindRefFromDom } from '../operator-tree/binding'
import { getEffectiveStyle } from '../operator-tree/effective-style'
import { buildBvarScopeIndex, type BvarScopeEntry } from '../operator-tree/bvar-scope-index'
import { fvarAppliedHeadLatex } from '../operator-tree/latex-escape'
import { fillLatexTemplate } from '../operator-tree/template'
import type { OperatorTree } from '../operator-tree/types'

/** 仅当 el 到 root 的路径上（不含 root）不出现另一层 contantSubtree 时，该 constSymbol 才属于本层算子皮（不染色子树内嵌算子） */
function isDirectConstSymbolUnderContantSubtreeRoot(el: HTMLElement, root: HTMLElement): boolean {
  if (!root.contains(el)) {
    return false
  }
  let cur: HTMLElement | null = el.parentElement
  while (cur !== null && cur !== root) {
    if (cur.dataset.kind === 'contantSubtree') {
      return false
    }
    cur = cur.parentElement
  }
  return cur === root
}

function collectDirectConstSymbols(root: HTMLElement): HTMLElement[] {
  const out = new Set<HTMLElement>()

  // 量词：∀ / ∃ 与 binder–body 间逗号在 KaTeX 里是 binderScope 的直接子 constSymbol（与体内 implies 等子树并列）
  for (const bs of root.querySelectorAll<HTMLElement>('[data-kind="binderScope"]')) {
    if (!root.contains(bs)) {
      continue
    }
    const closestCt = bs.closest<HTMLElement>('[data-kind="contantSubtree"]')
    if (closestCt !== root) {
      continue
    }
    for (const child of bs.children) {
      if (child instanceof HTMLElement && child.dataset.kind === 'constSymbol') {
        out.add(child)
      }
    }
  }

  for (const el of root.querySelectorAll<HTMLElement>(
    '[data-kind="constSymbol"],[data-kind="constFence"]',
  )) {
    if (out.has(el)) {
      continue
    }
    if (isDirectConstSymbolUnderContantSubtreeRoot(el, root)) {
      out.add(el)
    }
  }
  return [...out]
}

function findBinderScopeAncestor(
  start: HTMLElement,
  container: HTMLElement,
  bindRef: string,
): HTMLElement | null {
  let el: HTMLElement | null = start
  while (el && container.contains(el)) {
    if (el.dataset.kind === 'binderScope' && readBindRefFromDom(el) === bindRef) {
      return el
    }
    el = el.parentElement
  }
  return null
}

/** 自指针处向上找高亮根：优先级 变量叶子（binder/bvar/fvar）> contantSubtree > const/constSymbol/constFence；一趟收集，避免三趟重复上溯 */
const HOVER_LEAF_KINDS = new Set(['bvar', 'binder', 'fvar'])

function findMinimalHoverRoot(start: HTMLElement, container: HTMLElement): HTMLElement {
  let leaf: HTMLElement | null = null
  let subtree: HTMLElement | null = null
  let constEl: HTMLElement | null = null
  let cur: HTMLElement | null = start
  while (cur && container.contains(cur)) {
    if (cur.hasAttribute('data-name')) {
      const k = cur.dataset.kind ?? ''
      if (HOVER_LEAF_KINDS.has(k) && !leaf) {
        leaf = cur
      }
      if (k === 'contantSubtree' && !subtree) {
        subtree = cur
      }
      if ((k === 'const' || k === 'constSymbol' || k === 'constFence') && !constEl) {
        constEl = cur
      }
    }
    cur = cur.parentElement
  }
  return leaf ?? subtree ?? constEl ?? start
}

interface RenderResult {
  latex: string
  html: string
}

interface OperatorTreeKaTeXViewProps {
  tree: OperatorTree
  query: KaTeXTemplateQuery
  templateDb: TemplateDb
  katexOptions?: KatexOptions
  onResolved?: (latexSource: string) => void
}

interface TooltipState {
  visible: boolean
  x: number
  y: number
  loading: boolean
  interactionKey: string
  name: string
  style: string
  kind: string
  /** bvar：已找到 binder；fvar：无 bindRef 或未匹配引入 */
  variableRole: 'bvar' | 'fvar' | 'none'
  bindingHint: string
  operatorDescription: string
  styleDescription: string
}

async function resolveNodeLatex(
  node: OperatorTree,
  query: KaTeXTemplateQuery,
  cache: Map<string, string>,
  templateDb: TemplateDb,
): Promise<string> {
  const effectiveStyle = getEffectiveStyle(node, templateDb)
  const hasDbTemplate = Boolean(
    node.name && templateDb[node.name]?.styles?.[effectiveStyle]?.latex,
  )

  const childLatexList = await Promise.all(
    node.children.map((child) => resolveNodeLatex(child, query, cache, templateDb)),
  )

  // 裸名应用且无 DB 模板（如 op(x,y,FOL.and(x,y))）：\\operatorname{op}(…)，子式逗号分隔，整段 htmlData
  if (node.children.length > 0 && !hasDbTemplate && !node.name.includes('.')) {
    const ref = getBindRef(node)
    const bind_ref_attr = bindRefAttrFragment(ref)
    const opPart = fvarAppliedHeadLatex(node.name)
    const argList = childLatexList.join(',')
    return fillLatexTemplate(
      // 仅包住 \\operatorname{…}，括号与参数在外，避免整段应用共一个 span 悬停时子式一起变蓝
      '\\htmlData{name=@NAME@,style=@STYLE@,kind=fvar@BIND_REF_ATTR@}{@OP_PART@}(@ARG_LIST@)',
      {
        name: node.name,
        style: effectiveStyle,
        kind: 'fvar',
        bind_ref: ref ?? '',
        bind_ref_attr,
        op_part: opPart,
        arg_list: argList,
      },
    )
  }

  const key = `${node.name}::${effectiveStyle}::${node.kind}`
  let template = cache.get(key)
  if (!template) {
    template = await query({ name: node.name, style: effectiveStyle, node })
    cache.set(key, template)
  }

  const childValues = Object.fromEntries(
    childLatexList.map((latex, index) => [`child${index}`, latex]),
  )
  const ref = getBindRef(node)
  const bind_ref_attr = bindRefAttrFragment(ref)
  const nodeValues = {
    name: node.name,
    style: effectiveStyle,
    kind: node.kind,
    bind_ref: ref ?? '',
    bind_ref_attr,
  }

  return fillLatexTemplate(template, { ...childValues, ...nodeValues })
}

function useOperatorTreeRender(
  tree: OperatorTree,
  query: KaTeXTemplateQuery,
  templateDb: TemplateDb,
  katexOptions?: KatexOptions,
) {
  const [result, setResult] = useState<RenderResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const reqIdRef = useRef(0)
  const cache = useMemo(() => new Map<string, string>(), [query])

  useEffect(() => {
    let cancelled = false
    const reqId = ++reqIdRef.current

    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        // 先递归算出最终 LaTeX，再统一交给 KaTeX 生成 HTML。
        const latex = await resolveNodeLatex(tree, query, cache, templateDb)
        const html = katex.renderToString(latex, {
          throwOnError: false,
          ...katexOptions,
        })
        if (!cancelled && reqIdRef.current === reqId) {
          setResult({ latex, html })
        }
      } catch (err) {
        if (!cancelled && reqIdRef.current === reqId) {
          const message = err instanceof Error ? err.message : String(err)
          setError(`渲染失败: ${message}`)
          setResult(null)
        }
      } finally {
        if (!cancelled && reqIdRef.current === reqId) {
          setLoading(false)
        }
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [cache, katexOptions, query, templateDb, tree])

  return { loading, error, result }
}

export function OperatorTreeKaTeXView({
  tree,
  query,
  templateDb,
  katexOptions,
  onResolved,
}: OperatorTreeKaTeXViewProps) {
  const { loading, error, result } = useOperatorTreeRender(tree, query, templateDb, katexOptions)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [hoverKey, setHoverKey] = useState('')
  const prefetchTimerRef = useRef<number | null>(null)
  const showTimerRef = useRef<number | null>(null)
  const tooltipElRef = useRef<HTMLDivElement | null>(null)
  const hoverMarkedElsRef = useRef<HTMLElement[]>([])
  const containerRef = useRef<HTMLDivElement | null>(null)
  const lastHtmlRef = useRef<string | null>(null)
  const bvarScopeIndexRef = useRef<Map<string, BvarScopeEntry>>(new Map())

  useEffect(() => {
    if (result) {
      onResolved?.(result.latex)
    }
  }, [onResolved, result])

  useEffect(() => {
    return () => {
      if (prefetchTimerRef.current) {
        window.clearTimeout(prefetchTimerRef.current)
      }
      if (showTimerRef.current) {
        window.clearTimeout(showTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el || !result) return
    if (lastHtmlRef.current === result.html) return
    lastHtmlRef.current = result.html
    el.innerHTML = result.html
    bvarScopeIndexRef.current = buildBvarScopeIndex(el)
  }, [result])

  const clearHoverTimers = () => {
    if (prefetchTimerRef.current) {
      window.clearTimeout(prefetchTimerRef.current)
      prefetchTimerRef.current = null
    }
    if (showTimerRef.current) {
      window.clearTimeout(showTimerRef.current)
      showTimerRef.current = null
    }
  }

  const fetchDescriptions = async (
    name: string,
    style: string,
    variableRole: 'bvar' | 'fvar' | 'none',
    bindingHint: string,
  ) => {
    await new Promise((resolve) => window.setTimeout(resolve, 120))
    const operatorRecord = templateDb[name]
    const styleRecord = operatorRecord?.styles?.[style]
    let operatorDescription = operatorRecord?.description ?? '未找到算子说明'
    let styleDescription = styleRecord?.description ?? '未找到 style 说明'

    if (variableRole === 'fvar') {
      operatorDescription = '自由变量（无编译期 bindRef，或与量词引入不匹配）'
      styleDescription = bindingHint || styleDescription
    } else if (variableRole === 'bvar') {
      operatorDescription = `${operatorDescription}\n\n${bindingHint}`.trim()
    }

    return {
      operatorDescription,
      styleDescription,
    }
  }

  const activateHoverTarget = (
    target: HTMLElement,
    container: HTMLElement,
    x: number,
    y: number,
  ) => {
    const name = target.dataset.name ?? ''
    const style = target.dataset.style ?? ''
    const kind = target.dataset.kind ?? ''
    const bindRef = readBindRefFromDom(target)

    let variableRole: 'bvar' | 'fvar' | 'none' = 'none'
    let bindingHint = ''

    if (kind === 'bvar') {
      if (bindRef) {
        const binderEl = findBinderScopeAncestor(target, container, bindRef)
        if (binderEl) {
          variableRole = 'bvar'
          const bName = binderEl.dataset.name ?? ''
          const bStyle = binderEl.dataset.style ?? ''
          bindingHint = `绑定变量：bindRef=${bindRef}，对应量词 binder「${bName}[${bStyle}]」。`
        } else {
          variableRole = 'fvar'
          bindingHint = `标注为 bvar（bindRef=${bindRef}），但未找到带 binderScope 的祖先。`
        }
      } else {
        variableRole = 'fvar'
        bindingHint = '标注为 bvar 但无 bindRef（未匹配到上层量词引入）。'
      }
    } else if (kind === 'binder' && bindRef) {
      const binderScopeEl = findBinderScopeAncestor(target, container, bindRef)
      if (binderScopeEl) {
        variableRole = 'bvar'
        bindingHint = `binder 引入处 bindRef=${bindRef}（作用域内同 ref 的 bvar 为使用处）。`
      } else {
        variableRole = 'fvar'
        bindingHint = `binder 但未找到 binderScope（bindRef=${bindRef}）。`
      }
    } else if (kind === 'fvar') {
      variableRole = 'fvar'
      bindingHint = '自由变量 occurrence。'
    }

    const key = `${name}|${style}|${kind}|${bindRef}`

    if (hoverKey === key) {
      if (tooltipElRef.current) {
        tooltipElRef.current.style.left = `${x}px`
        tooltipElRef.current.style.top = `${y}px`
      }
      return
    }

    setHoverKey(key)
    clearHoverTimers()
    setTooltip({
      visible: false,
      x,
      y,
      loading: true,
      interactionKey: key,
      name,
      style,
      kind,
      variableRole,
      bindingHint,
      operatorDescription: '',
      styleDescription: '',
    })

    prefetchTimerRef.current = window.setTimeout(() => {
      void fetchDescriptions(name, style, variableRole, bindingHint).then((desc) => {
        setTooltip((prev) => {
          if (!prev || prev.interactionKey !== key) {
            return prev
          }
          return { ...prev, loading: false, ...desc }
        })
      })
    }, 500)

    showTimerRef.current = window.setTimeout(() => {
      setTooltip((prev) => {
        if (!prev || prev.interactionKey !== key) {
          return prev
        }
        return { ...prev, visible: true }
      })
    }, 1000)
  }

  const clearHoverMarks = () => {
    hoverMarkedElsRef.current.forEach((el) => {
      el.classList.remove(
        'katex-hovered',
        'katex-bvar-scope',
        'katex-binder-decl',
        'katex-single-hover',
        'katex-op-skin-hover',
      )
    })
    hoverMarkedElsRef.current = []
  }

  const applyHoverHighlight = (target: HTMLElement, container: HTMLElement) => {
    clearHoverMarks()
    const kind = target.dataset.kind ?? ''
    const bindRef = readBindRefFromDom(target)

    const touched = new Set<HTMLElement>()

    if ((kind === 'bvar' || kind === 'binder') && bindRef) {
      const entry = bvarScopeIndexRef.current.get(bindRef)
      let bvars: HTMLElement[]
      let binders: HTMLElement[]
      if (entry) {
        bvars = entry.bvars
        binders = entry.binders
      } else {
        const scopeRoot = Array.from(
          container.querySelectorAll<HTMLElement>('[data-kind="binderScope"]'),
        ).find((el) => readBindRefFromDom(el) === bindRef)
        if (!scopeRoot) {
          bvars = []
          binders = []
        } else {
          bvars = Array.from(scopeRoot.querySelectorAll<HTMLElement>('[data-kind="bvar"]')).filter(
            (el) => readBindRefFromDom(el) === bindRef,
          )
          binders = Array.from(scopeRoot.querySelectorAll<HTMLElement>('[data-kind="binder"]')).filter(
            (el) => readBindRefFromDom(el) === bindRef,
          )
        }
      }
      for (const el of bvars) {
        el.classList.add('katex-hovered', 'katex-bvar-scope')
        touched.add(el)
      }
      for (const el of binders) {
        el.classList.add('katex-hovered', 'katex-binder-decl')
        touched.add(el)
      }
      // 仅当前指针下的那一处带「框」；同作用域其它仅字色（见 style.css）
      if (touched.has(target)) {
        target.classList.add('katex-single-hover')
      }
    } else {
      const root = findMinimalHoverRoot(target, container)
      root.classList.add('katex-hovered', 'katex-single-hover')
      touched.add(root)
      if (root.dataset.kind === 'contantSubtree') {
        for (const g of collectDirectConstSymbols(root)) {
          g.classList.add('katex-hovered', 'katex-op-skin-hover')
          touched.add(g)
        }
      }
    }

    hoverMarkedElsRef.current = [...touched]
  }

  const handleKaTeXMouseMove: MouseEventHandler<HTMLDivElement> = (event) => {
    const container = containerRef.current
    if (!container) return

    const elements = document.elementsFromPoint(event.clientX, event.clientY)
    const candidates = elements.filter(
      (el): el is HTMLElement =>
        el instanceof HTMLElement &&
        el.hasAttribute('data-name') &&
        container.contains(el),
    )
    const hit = candidates[0] ?? null

    if (!hit) {
      clearHoverMarks()
      setHoverKey('')
      clearHoverTimers()
      setTooltip((prev) => (prev ? { ...prev, visible: false } : null))
      return
    }

    const semantic = findMinimalHoverRoot(hit, container)
    applyHoverHighlight(semantic, container)
    activateHoverTarget(semantic, container, event.clientX + 12, event.clientY + 12)
  }

  const handleKaTeXMouseLeave = () => {
    clearHoverMarks()
    setHoverKey('')
    clearHoverTimers()
    setTooltip((prev) => (prev ? { ...prev, visible: false } : null))
  }

  if (loading) {
    return <div className="katex-panel">Loading KaTeX ...</div>
  }
  if (error) {
    return <div className="katex-panel katex-error">{error}</div>
  }
  if (!result) {
    return <div className="katex-panel">无可渲染结果</div>
  }

  return (
    <div className="katex-panel">
      <div
        ref={containerRef}
        className="katex-html"
        onMouseMove={handleKaTeXMouseMove}
        onMouseLeave={handleKaTeXMouseLeave}
      />
      {tooltip && (
        <div
          ref={tooltipElRef}
          className={`katex-hover-tooltip ${tooltip.visible ? 'visible' : ''}`}
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="tooltip-title">{tooltip.name}[{tooltip.style}]</div>
          <div className="tooltip-kind">
            kind: {tooltip.kind || '(none)'}
            {tooltip.variableRole !== 'none' ? ` · ${tooltip.variableRole}` : ''}
          </div>
          {tooltip.loading ? (
            <div className="tooltip-loading">加载说明中...</div>
          ) : (
            <>
              <div className="tooltip-desc">{tooltip.operatorDescription}</div>
              <div className="tooltip-desc">{tooltip.styleDescription}</div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
