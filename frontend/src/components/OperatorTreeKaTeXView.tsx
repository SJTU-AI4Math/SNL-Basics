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
import { fillLatexTemplate } from '../operator-tree/template'
import type { OperatorTree } from '../operator-tree/types'

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
  name: string
  style: string
  kind: string
  operatorDescription: string
  styleDescription: string
}

async function resolveNodeLatex(
  node: OperatorTree,
  query: KaTeXTemplateQuery,
  cache: Map<string, string>,
): Promise<string> {
  const key = `${node.name}::${node.style}`
  let template = cache.get(key)
  if (!template) {
    template = await query({ name: node.name, style: node.style, node })
    cache.set(key, template)
  }

  const childLatexList = await Promise.all(
    node.children.map((child) => resolveNodeLatex(child, query, cache)),
  )
  const childValues = Object.fromEntries(
    childLatexList.map((latex, index) => [`child${index}`, latex]),
  )
  const nodeValues = {
    name: node.name,
    style: node.style,
    kind: node.kind,
  }

  return fillLatexTemplate(template, { ...childValues, ...nodeValues })
}

function useOperatorTreeRender(
  tree: OperatorTree,
  query: KaTeXTemplateQuery,
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
        const latex = await resolveNodeLatex(tree, query, cache)
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
  }, [cache, katexOptions, query, tree])

  return { loading, error, result }
}

export function OperatorTreeKaTeXView({
  tree,
  query,
  templateDb,
  katexOptions,
  onResolved,
}: OperatorTreeKaTeXViewProps) {
  const { loading, error, result } = useOperatorTreeRender(tree, query, katexOptions)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [hoverKey, setHoverKey] = useState('')
  const prefetchTimerRef = useRef<number | null>(null)
  const showTimerRef = useRef<number | null>(null)

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

  const fetchDescriptions = async (name: string, style: string) => {
    // 预留异步查询接口（当前以本地 db 模拟）。
    await new Promise((resolve) => window.setTimeout(resolve, 120))
    const operatorRecord = templateDb[name]
    const styleRecord = operatorRecord?.styles?.[style]
    return {
      operatorDescription: operatorRecord?.description ?? '未找到算子说明',
      styleDescription: styleRecord?.description ?? '未找到 style 说明',
    }
  }

  const tooltipElRef = useRef<HTMLDivElement | null>(null)

  const activateHoverTarget = (target: HTMLElement, x: number, y: number) => {
    const name = target.dataset.name ?? ''
    const style = target.dataset.style ?? ''
    const kind = target.dataset.kind ?? ''
    // 同步高亮采用 name+style 作为逻辑主键。
    const key = `${name}|${style}`

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
      name,
      style,
      kind,
      operatorDescription: '',
      styleDescription: '',
    })

    prefetchTimerRef.current = window.setTimeout(() => {
      void fetchDescriptions(name, style).then((desc) => {
        setTooltip((prev) => {
          if (!prev || `${prev.name}|${prev.style}` !== key) {
            return prev
          }
          return { ...prev, loading: false, ...desc }
        })
      })
    }, 500)

    showTimerRef.current = window.setTimeout(() => {
      setTooltip((prev) => {
        if (!prev || `${prev.name}|${prev.style}` !== key) {
          return prev
        }
        return { ...prev, visible: true }
      })
    }, 1000)
  }

  const hoveredElsRef = useRef<HTMLElement[]>([])
  const containerRef = useRef<HTMLDivElement | null>(null)
  const lastHtmlRef = useRef<string | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el || !result) return
    if (lastHtmlRef.current === result.html) return
    lastHtmlRef.current = result.html
    el.innerHTML = result.html
  }, [result])

  const setHoveredGroup = (elements: HTMLElement[]) => {
    const prev = hoveredElsRef.current
    const same =
      prev.length === elements.length && prev.every((el, idx) => el === elements[idx])
    if (same) {
      return
    }
    prev.forEach((el) => el.classList.remove('katex-hovered'))
    elements.forEach((el) => el.classList.add('katex-hovered'))
    hoveredElsRef.current = elements
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
    const target = candidates[0] ?? null

    if (!target) {
      setHoveredGroup([])
      setHoverKey('')
      clearHoverTimers()
      setTooltip((prev) => (prev ? { ...prev, visible: false } : null))
      return
    }

    const groupName = target.dataset.name ?? ''
    const groupStyle = target.dataset.style ?? ''
    const group = Array.from(
      container.querySelectorAll<HTMLElement>(
        `[data-name="${CSS.escape(groupName)}"][data-style="${CSS.escape(groupStyle)}"]`,
      ),
    )
    setHoveredGroup(group)
    activateHoverTarget(target, event.clientX + 12, event.clientY + 12)
  }

  const handleKaTeXMouseLeave = () => {
    setHoveredGroup([])
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
          <div className="tooltip-kind">kind: {tooltip.kind || '(none)'}</div>
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
