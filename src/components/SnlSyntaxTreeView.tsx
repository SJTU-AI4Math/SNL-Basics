import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEventHandler,
  type ReactElement,
} from 'react'
import katex from 'katex'
import type { KatexOptions } from 'katex'
import type { SnlMacroTemplateQuery } from '../snl-syntax-tree/query'
import type { SnlMacroDb } from '../snl-macro/types'
import { bindRefAttrFragment, getBindRef, readBindRefFromDom } from '../snl-syntax-tree/binding'
import { buildBvarScopeIndex, type BvarScopeEntry } from '../snl-syntax-tree/bvar-scope-index'
import { fvarAppliedHeadLatex } from '../snl-syntax-tree/latex-escape'
import { fillLatexTemplate } from '../snl-syntax-tree/template'
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'
import { findBinderScopeAncestor, findMinimalHoverRoot } from '../snl-react-view/hover-dom'
import {
  defaultRenderHooks,
  type SnlHighlightSet,
  type SnlRenderHooks,
  type SnlResolvedSource,
  type SnlTooltipState,
} from '../snl-react-view/hooks'

interface RenderResult {
  latex: string
  html: string
}

/** Props for {@link SnlSyntaxTreeView}. */
export interface SnlSyntaxTreeViewProps {
  /** The (annotated) syntax tree to render. */
  tree: SnlSyntaxTree
  /** Template query — resolves a macro name to its KaTeX template string. */
  query: SnlMacroTemplateQuery
  /** The macro DB, used for mode dispatch and metadata. */
  templateDb: SnlMacroDb
  /** KaTeX options forwarded to `katex.renderToString`. */
  katexOptions?: KatexOptions
  /** Called with the resolved LaTeX source (math root only). */
  onResolved?: (latexSource: string) => void
  /** Override tooltip / hover / description / renderer behavior. Merged over defaults. */
  hooks?: SnlRenderHooks
}

/** Internal tooltip state = public SnlTooltipState + interaction key for staleness checks. */
type TooltipState = SnlTooltipState & { interactionKey: string }

async function resolveNodeLatex(
  node: SnlSyntaxTree,
  query: SnlMacroTemplateQuery,
  cache: Map<string, string>,
  templateDb: SnlMacroDb,
): Promise<string> {
  const hasDbTemplate = Boolean(node.name && templateDb[node.name]?.katex_react?.template)

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
      '\\htmlData{name=@NAME@,kind=fvar@BIND_REF_ATTR@}{@OP_PART@}(@ARG_LIST@)',
      {
        name: node.name,
        kind: 'fvar',
        bind_ref: ref ?? '',
        bind_ref_attr,
        op_part: opPart,
        arg_list: argList,
      },
    )
  }

  const key = `${node.name}::${node.kind}`
  let template = cache.get(key)
  if (!template) {
    template = await query({ name: node.name, node })
    cache.set(key, template)
  }

  const childValues = Object.fromEntries(
    childLatexList.map((latex, index) => [`child${index}`, latex]),
  )
  const ref = getBindRef(node)
  const bind_ref_attr = bindRefAttrFragment(ref)
  // Variadic macros fill @CHILDREN@ with children joined by their configured
  // separator (default ", ") — see fillLatexTemplate.
  const variadicJoin = (node.name ? templateDb[node.name]?.katex_react?.variadic_join : undefined) ?? ', '
  const children_joined = childLatexList.join(variadicJoin)
  const nodeValues = {
    name: node.name,
    kind: node.kind,
    bind_ref: ref ?? '',
    bind_ref_attr,
    children_joined,
  }

  return fillLatexTemplate(template, { ...childValues, ...nodeValues })
}

/** Resolve a node's render mode from its macro (default 'math' when unknown). */
function nodeMode(node: SnlSyntaxTree, db: SnlMacroDb): 'math' | 'text' | 'block' {
  return db[node.name]?.katex_react?.mode ?? 'math'
}

/**
 * Renders a single math subtree as an inline KaTeX span. Used for math leaves
 * embedded inside text/block trees (the whole-tree math path stays innerHTML).
 */
function MathSpan({
  node,
  query,
  templateDb,
  katexOptions,
}: {
  node: SnlSyntaxTree
  query: SnlMacroTemplateQuery
  templateDb: SnlMacroDb
  katexOptions?: KatexOptions
}): ReactElement {
  const [html, setHtml] = useState('')
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const latex = await resolveNodeLatex(node, query, new Map<string, string>(), templateDb)
        const out = katex.renderToString(latex, { throwOnError: false, ...katexOptions })
        if (!cancelled) setHtml(out)
      } catch {
        if (!cancelled) setHtml('')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [node, query, templateDb, katexOptions])
  return <span className="snl-math-span" dangerouslySetInnerHTML={{ __html: html }} />
}

function useSnlSyntaxTreeRender(
  tree: SnlSyntaxTree,
  query: SnlMacroTemplateQuery,
  templateDb: SnlMacroDb,
  katexOptions: KatexOptions | undefined,
  enabled: boolean,
) {
  const [result, setResult] = useState<RenderResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const reqIdRef = useRef(0)
  const cache = useMemo(() => new Map<string, string>(), [query])

  useEffect(() => {
    if (!enabled) {
      setResult(null)
      setError(null)
      setLoading(false)
      return
    }
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
  }, [cache, enabled, katexOptions, query, templateDb, tree])

  return { loading, error, result }
}

export function SnlSyntaxTreeView({
  tree,
  query,
  templateDb,
  katexOptions,
  onResolved,
  hooks,
}: SnlSyntaxTreeViewProps) {
  const mergedHooks = useMemo(() => ({ ...defaultRenderHooks, ...hooks }), [hooks])
  const isMathRoot = nodeMode(tree, templateDb) === 'math'
  const { loading, error, result } = useSnlSyntaxTreeRender(
    tree,
    query,
    templateDb,
    katexOptions,
    isMathRoot,
  )
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [hoverKey, setHoverKey] = useState('')
  const prefetchTimerRef = useRef<number | null>(null)
  const showTimerRef = useRef<number | null>(null)
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

  // Non-math roots render as a React tree; rebuild the bvar-scope index from the
  // mounted DOM (best-effort — MathSpan leaves settle async, and the highlight
  // strategy falls back to a live DOM query when an entry is missing).
  useEffect(() => {
    if (isMathRoot) return
    const el = containerRef.current
    if (!el) return
    lastHtmlRef.current = null
    bvarScopeIndexRef.current = buildBvarScopeIndex(el)
  }, [isMathRoot, tree])

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

  const resolveInfo = async (
    name: string,
    variableRole: 'bvar' | 'fvar' | 'none',
    bindingHint: string,
  ) => {
    await new Promise((resolve) => window.setTimeout(resolve, 120))
    const macro = templateDb[name]
    const base = await mergedHooks.resolveMacroInfo!(name, macro)
    let description = base.description

    if (variableRole === 'fvar') {
      description = '自由变量（无编译期 bindRef，或与量词引入不匹配）'
    } else if (variableRole === 'bvar') {
      description = `${description}\n\n${bindingHint}`.trim()
    }

    return { description, extra: base.extra }
  }

  const activateHoverTarget = (
    target: HTMLElement,
    container: HTMLElement,
    x: number,
    y: number,
  ) => {
    const name = target.dataset.name ?? ''
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
          bindingHint = `绑定变量：bindRef=${bindRef}，对应量词 binder「${bName}」。`
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

    const key = `${name}|${kind}|${bindRef}`

    // 消费者拦截钩子：在内部状态机之外额外通知
    mergedHooks.onHover?.({
      name,
      kind,
      node: { name, kind, mdata: bindRef ? { bindRef } : null, children: [] },
      bindingHint,
      variableRole,
      target,
      clientX: x,
      clientY: y,
    })

    if (hoverKey === key) {
      // 同一元素内移动：仅更新位置（不重新解析说明）
      setTooltip((prev) => (prev && prev.interactionKey === key ? { ...prev, x, y } : prev))
      return
    }

    const macro = templateDb[name]
    const source: SnlResolvedSource | null = macro
      ? (mergedHooks.resolveSource?.(macro.source) ?? null)
      : null

    setHoverKey(key)
    clearHoverTimers()
    setTooltip({
      visible: false,
      x,
      y,
      loading: true,
      interactionKey: key,
      name,
      kind,
      variableRole,
      bindingHint,
      info: null,
      source,
    })

    prefetchTimerRef.current = window.setTimeout(() => {
      void resolveInfo(name, variableRole, bindingHint).then((info) => {
        setTooltip((prev) => {
          if (!prev || prev.interactionKey !== key) {
            return prev
          }
          return { ...prev, loading: false, info }
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
        'snl-hovered',
        'snl-bvar-scope',
        'snl-binder-decl',
        'snl-single-hover',
        'snl-op-skin-hover',
      )
    })
    hoverMarkedElsRef.current = []
  }

  const applyHighlightSet = (set: SnlHighlightSet) => {
    const touched = new Set<HTMLElement>()
    for (const el of set.hovered) {
      el.classList.add('snl-hovered')
      touched.add(el)
    }
    if (set.singleHover) {
      set.singleHover.classList.add('snl-single-hover')
      touched.add(set.singleHover)
    }
    for (const el of set.bvarScope) {
      el.classList.add('snl-bvar-scope')
      touched.add(el)
    }
    for (const el of set.binderDecl) {
      el.classList.add('snl-binder-decl')
      touched.add(el)
    }
    for (const el of set.opSkinHover) {
      el.classList.add('snl-op-skin-hover')
      touched.add(el)
    }
    hoverMarkedElsRef.current = [...touched]
  }

  const applyHoverHighlight = (target: HTMLElement, container: HTMLElement) => {
    clearHoverMarks()
    const strategy = mergedHooks.highlightStrategy ?? defaultRenderHooks.highlightStrategy!
    const set = strategy.computeHighlightSet(target, container, bvarScopeIndexRef.current)
    applyHighlightSet(set)
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
    mergedHooks.onLeave?.()
  }

  // Mode-aware React dispatch (used for non-math roots and for children of
  // text/block nodes). Math nodes render as inline KaTeX via <MathSpan/>.
  const renderNode = (node: SnlSyntaxTree): ReactElement => {
    const mode = nodeMode(node, templateDb)
    if (mode === 'block') {
      const key = templateDb[node.name]?.katex_react?.react_renderer_key
      const Renderer = key ? mergedHooks.renderers?.[key] : undefined
      if (Renderer) {
        return <Renderer node={node} macroDb={templateDb} renderChild={renderNode} />
      }
      return (
        <div className="snl-block">
          {node.children.map((child, index) => (
            <Fragment key={index}>{renderNode(child)}</Fragment>
          ))}
        </div>
      )
    }
    if (mode === 'text') {
      return (
        <span className="snl-text">
          {node.children.map((child, index) => (
            <Fragment key={index}>{renderNode(child)}</Fragment>
          ))}
        </span>
      )
    }
    return (
      <MathSpan node={node} query={query} templateDb={templateDb} katexOptions={katexOptions} />
    )
  }

  if (isMathRoot) {
    if (loading) {
      return <div className="katex-panel">Loading KaTeX ...</div>
    }
    if (error) {
      return <div className="katex-panel katex-error">{error}</div>
    }
    if (!result) {
      return <div className="katex-panel">无可渲染结果</div>
    }
  }

  return (
    <div className="katex-panel">
      <div
        ref={containerRef}
        className="katex-html"
        onMouseMove={handleKaTeXMouseMove}
        onMouseLeave={handleKaTeXMouseLeave}
      >
        {isMathRoot ? null : renderNode(tree)}
      </div>
      {tooltip ? mergedHooks.renderTooltip?.(tooltip) ?? null : null}
    </div>
  )
}
