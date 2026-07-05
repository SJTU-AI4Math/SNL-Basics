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
import type { SnlMacro, SnlMacroDb, SnlMacroStyle } from '../snl-macro/types'
import { getBindRef, readBindRefFromDom } from '../snl-syntax-tree/binding'
import { buildBvarScopeIndex, type BvarScopeEntry } from '../snl-syntax-tree/bvar-scope-index'
import { tightenHoverBoxes } from '../snl-react-view/tighten-hover-boxes'
import { escapeLatexText, escapeTextButPreservePlaceholders } from '../snl-syntax-tree/latex-escape'
import { fillLatexTemplate } from '../snl-syntax-tree/template'
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'
import { findBinderScopeAncestor, findMinimalHoverRoot } from '../snl-react-view/hover-dom'
import { HTMLDATA_KATEX_DEFAULTS } from '../snl-react-view/katex-defaults'
import {
  DEFAULT_KIND_PALETTE,
  paletteToCss,
  type KindPalette,
} from '../snl-react-view/kind-palette'
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

/**
 * Sanitize a value for use inside a `\htmlData{key=value,…}` attribute list.
 *
 * KaTeX's `\htmlData` uses `,` as an attr separator and `{` / `}` as brace
 * delimiters, so those characters MUST NOT appear inside a value or KaTeX's
 * tokenizer misparses the attribute list. `#` is a template-substitution
 * marker in the surrounding LaTeX and would confuse downstream tools. All
 * three get replaced with `_` — lossy but visible in the rendered
 * `data-name="…"` attribute, which is purely metadata (hover / tooltip look
 * up the macro by the ORIGINAL name via the tree, not the attr).
 *
 * Backslash IS allowed — KaTeX passes it through verbatim and downstream
 * tools need to see e.g. `\operatorname` in data-name for hover matching.
 *
 * Control chars (ASCII 0..1f + del) are treated as fatal — those signal
 * an upstream bug.
 */
function sanitizeHtmlDataAttr(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`invalid \\htmlData attribute value (control char): ${JSON.stringify(value)}`)
  }
  return value.replace(/[,{}#]/g, '_')
}

/**
 * Resolve which {@link SnlMacroStyle} to render a node with. The tag comes from
 * the parser's `[style]` bracket (`node.style`); when missing, `styles[0]` is
 * the implicit default. Throws if the resolved tag isn't in `macro.styles`.
 */
function resolveStyle(node: SnlSyntaxTree, macro: SnlMacro): SnlMacroStyle {
  if (macro.styles.length === 0) {
    throw new Error(`macro "${macro.name}" has no styles`)
  }
  if (node.style == null) {
    return macro.styles[0]
  }
  const style = macro.styles.find((s) => s.tag === node.style)
  if (!style) {
    throw new Error(
      `unknown style "${node.style}" for macro "${macro.name}" ` +
        `(available: ${macro.styles.map((s) => s.tag).join(', ') || '(none)'})`,
    )
  }
  return style
}

/**
 * Auto-wrap a rendered node's latex in a single `\htmlData{name,kind[,style][,bindRef]}`.
 * This is the sole place metadata enters the KaTeX output — templates never
 * write `\htmlData` themselves.
 *
 * Kind resolution order (first defined wins), with a literal `'fvar'` fallback:
 *   1. `kindOverride` — the caller forcing a specific kind (e.g. bare-fvar
 *      application path emits 'fvar')
 *   2. `node.kind` — set by annotate-bind (quantifiers, bvar/fvar leaves,
 *      binder heads) or by the parser
 *   3. `macroDb[node.name].kind` — declared by the macro author in the DB
 *      (rule / const / …); this is how implies / apply / and / or etc. get
 *      their palette color without touching the parser
 *   4. 'fvar' — un-classified nodes render as free variables (no more grey
 *      'default' frame)
 */
function wrapHtmlData(
  node: SnlSyntaxTree,
  inner: string,
  macroDb: SnlMacroDb,
  kindOverride?: string,
): string {
  const name = sanitizeHtmlDataAttr(node.name)
  const dbKind = node.name ? macroDb[node.name]?.kind : undefined
  // Kind resolution priority: kindOverride > node.kind > macroDb kind > 'fvar'.
  // NB: `??` is wrong here — `createSnlSyntaxTreeNode` defaults `kind: ''`
  // (empty string is the canonical "not annotated" sentinel), and `??`
  // treats '' as a value, which would pin every unannotated node to '' and
  // hide the macro's declared kind from the palette (so changing a macro's
  // `kind` field in a live editor would not update its preview color).
  // `||` correctly falls through empty strings to `dbKind` / 'fvar'.
  const kind = sanitizeHtmlDataAttr(
    kindOverride || node.kind || dbKind || 'fvar',
  )
  const ref = getBindRef(node)
  const bindRefFragment = ref ? `,bindRef=${sanitizeHtmlDataAttr(ref)}` : ''
  const scopeFragment = node.scope ? `,scope=${sanitizeHtmlDataAttr(node.scope)}` : ''
  // Emit data-style only when a style was explicitly picked via `[style]`
  // (helpful for debugging + CSS if consumers want it).
  const styleFragment = node.style ? `,style=${sanitizeHtmlDataAttr(node.style)}` : ''
  return `\\htmlData{name=${name},kind=${kind}${styleFragment}${scopeFragment}${bindRefFragment}}{${inner}}`
}

/**
 * Wrap a child's rendered LaTeX so it's valid inside its parent's LaTeX
 * environment. The four cases from Fulcrum's rulebook:
 *
 *   parent \ child      formula                text
 *   -----------------   -------------------    -------------------
 *   formula             (direct concat)        \text{ ... }
 *   text                $ ... $                (direct concat)
 *
 * `block` never enters this function because block nodes are rendered on the
 * React side (see `renderNode`), not through the LaTeX pipeline.
 */
function wrapForParent(
  childLatex: string,
  childMode: SnlMacroStyle['mode'],
  parentMode: SnlMacroStyle['mode'],
): string {
  const childBucket = modeBucket(childMode)
  const parentBucket = modeBucket(parentMode)
  if (parentBucket === 'formula' && childBucket === 'text') {
    return `\\text{${childLatex}}`
  }
  if (parentBucket === 'text' && childBucket === 'formula') {
    return `$${childLatex}$`
  }
  // Same bucket (formula/formula or text/text), or child is block (best-effort
  // — the caller should never hand block children to this branch, but if it
  // happens we just splice the raw string).
  return childLatex
}

/** Collapse the 4-value mode into the LaTeX-visible bucket used by
 *  wrapForParent + resolveRootLatex. Both formula sub-modes behave
 *  identically for splicing purposes — only the ROOT render decides
 *  KaTeX displayMode. */
function modeBucket(mode: SnlMacroStyle['mode']): 'formula' | 'text' | 'block' {
  if (mode === 'block') return 'block'
  if (mode === 'text') return 'text'
  return 'formula'
}

async function resolveNodeLatex(
  node: SnlSyntaxTree,
  query: SnlMacroTemplateQuery,
  cache: Map<string, string>,
  macroDb: SnlMacroDb,
): Promise<string> {
  const macro = node.name ? macroDb[node.name] : undefined
  const style = macro ? resolveStyle(node, macro) : undefined
  const hasDbTemplate = Boolean(style?.template)

  // A node's rendering mode: env-mode override from delimited name > db style
  // > default formula_inline.
  const selfMode: SnlMacroStyle['mode'] =
    node.envMode ?? style?.mode ?? 'formula_inline'
  const selfBucket = modeBucket(selfMode)

  // Recurse first (children generate their own LaTeX in their own mode).
  const childRawList = await Promise.all(
    node.children.map((child) => resolveNodeLatex(child, query, cache, macroDb)),
  )

  // Then wrap each child for THIS node's LaTeX environment.
  const wrappedChildren = childRawList.map((latex, index) => {
    const child = node.children[index]
    const childMacro = child?.name ? macroDb[child.name] : undefined
    let cMode: SnlMacroStyle['mode'] = 'formula_inline'
    if (child?.envMode) {
      cMode = child.envMode
    } else if (childMacro) {
      try {
        cMode = resolveStyle(child, childMacro).mode
      } catch {
        cMode = 'formula_inline'
      }
    }
    return wrapForParent(latex, cMode, selfMode)
  })

  // --- Synthetic-macro path: node came from a delimited-name form ---
  // The parser stamped envMode, so we render the payload directly (bypassing
  // macroDb entirely). 猫猫 spec 2026-07-04-late 2 + Q4: "既然都写了 $$
  // delimiter，就默认这里是个和 database 无关的临时东西."
  //
  // Payload semantics — the payload IS a mini-template with the same
  // `#0` / `#1` / … / `#*` placeholder syntax as a regular macro template.
  // If the template doesn't reference `#N`, the children ARE NOT rendered
  // (they still exist in the tree — annotate-bind uses them for scoping —
  // but they contribute no visible LaTeX).
  //
  // Examples (from 猫猫 spec):
  //   `@$f$(x)`           → payload has no `#N` → renders "f", x invisible
  //   `@$x + y$(a)`       → no `#N`             → renders "x + y", a invisible
  //   `@$\operatorname{Im}(#0)$(x)` → `#0` → renders "Im(x)"
  //   `%hello #0%(name)`  → `#0` → renders "hello name" as text
  //
  // Per-envMode splicing:
  //   text mode  → escape the payload characters (they're literal text),
  //                but preserve `#N` placeholders (they're template markers,
  //                not literal `#` symbols the user wants displayed). Then
  //                wrap in \text{…}.
  //   formula    → payload IS raw LaTeX, `#N` substituted verbatim.
  //
  // The result is auto-wrapped in \htmlData like any other node so hover /
  // metadata still flow through.
  if (node.envMode) {
    const isText = node.envMode === 'text'
    // For text mode, escape everything BUT the `#N` template markers so
    // KaTeX doesn't interpret `_` / `$` / etc. as math. For formula mode
    // the payload IS LaTeX — no escaping.
    const templateBody = isText ? escapeTextButPreservePlaceholders(node.name) : node.name
    const childValues = Object.fromEntries(
      wrappedChildren.map((latex, index) => [`child${index}`, latex]),
    )
    const defaultJoin = isText ? '' : ', '
    const children_joined = wrappedChildren.join(defaultJoin)
    // Use the same template-filling machinery as regular macros. Unused
    // placeholders emit nothing; missing `#N` for a child index the
    // template doesn't mention → child is silently dropped (that's the
    // 猫猫-intended behavior, matching "宏是 $f$，这里面没参数，所以 x
    // 是没有地方填的").
    const filled = fillLatexTemplate(
      templateBody,
      { ...childValues, children_joined },
      isText ? 'text' : 'formula',
    )
    const body = isText ? `\\text{${filled}}` : filled
    return wrapHtmlData(node, body, macroDb)
  }

  // --- macroDb-miss fallback for plain-identifier names ---
  // 猫猫 spec 2026-07-04-late Q7 (rewritten):
  //   * `foo(a)`  where `foo` is NOT in db  → `foo(#0, …)` — bare LaTeX.
  //   * `\foo(a)` where `\foo` is NOT in db → `\operatorname{foo}(#0, …)`.
  //   * Leaf `\i`                           → `\mathrm{i}`.
  // Applied form (children present) is handled here; the leaf fallback is
  // done inside the query's default (fallbackLatexSymbol) path below —
  // except for the backslash-leaf case, which needs its own head.
  //
  // Kind: we do NOT pass a `kindOverride` here — an @-marked binder should
  // stay `kind='binder'` in the emitted \htmlData so palette / hover shows
  // it correctly. wrapHtmlData's fallback chain naturally lands on the
  // node's actual kind (binder / fvar / bvar / …), and the ultimate default
  // is still 'fvar' for un-classified nodes.
  if (!hasDbTemplate) {
    const bs = node.name.startsWith('\\')
    if (node.children.length > 0) {
      const stem = bs ? node.name.slice(1) : node.name
      const head = bs
        ? `\\operatorname{${escapeLatexText(stem)}}`
        : node.name
      const argList = wrappedChildren.join(', ')
      return wrapHtmlData(node, `${head}(${argList})`, macroDb)
    }
    // Leaf with a `\stem` name → `\mathrm{stem}`. Non-backslash leaves fall
    // through to the query below whose fallbackLatexSymbol already handles
    // pure-alpha vs mixed names (`x` → `x`, `x1` → `\mathrm{x1}`).
    if (bs) {
      const stem = node.name.slice(1)
      return wrapHtmlData(node, `\\mathrm{${escapeLatexText(stem)}}`, macroDb)
    }
  }

  const key = `${node.name}::${node.style ?? ''}::${node.kind}`
  let template = cache.get(key)
  if (!template) {
    template = await query({ name: node.name, node })
    cache.set(key, template)
  }

  const childValues = Object.fromEntries(
    wrappedChildren.map((latex, index) => [`child${index}`, latex]),
  )
  // Dynamic-arity macros fill `#*` with children joined by their configured
  // separator, optionally wrapped in `variadic_left` / `variadic_right`
  // delimiters. Defaults: `', '` (formula) or `''` (text) for the join,
  // empty for the delimiters. All three are ignored for fixed-arity macros.
  const defaultJoin = selfBucket === 'text' ? '' : ', '
  const variadicJoin = style?.variadic_join ?? defaultJoin
  const variadicLeft = style?.variadic_left ?? ''
  const variadicRight = style?.variadic_right ?? ''
  const children_joined =
    variadicLeft + wrappedChildren.join(variadicJoin) + variadicRight

  const filled = fillLatexTemplate(
    template,
    { ...childValues, children_joined },
    selfBucket === 'block' ? 'formula' : selfBucket,
  )
  // A pure pass-through variadic helper (template === '#*' AND no delimiters,
  // e.g. matrix.row) emits top-level alignment tokens (`&` / `\\`) that must
  // stay ungrouped for the enclosing environment (\begin{pmatrix}…). Wrapping
  // it in \htmlData would nest those tokens inside a group and break the
  // matrix; skip the wrap.
  //
  // When delimiters ARE present (variadic_left / variadic_right, e.g. a
  // self-contained pmatrix macro), the emitted string already opens/closes
  // its own environment, so wrapping is safe — and REQUIRED for hover
  // feedback on the delimiters (猫猫 2026-07-04 bug 4).
  if (
    template.trim() === '#*' &&
    !variadicLeft &&
    !variadicRight
  ) {
    return filled
  }
  return wrapHtmlData(node, filled, macroDb)
}

/**
 * Render the ROOT node's LaTeX for a KaTeX render. If the root is text-mode,
 * wrap its raw LaTeX in `\text{...}` so KaTeX renders it as text.
 */
async function resolveRootLatex(
  root: SnlSyntaxTree,
  query: SnlMacroTemplateQuery,
  cache: Map<string, string>,
  macroDb: SnlMacroDb,
): Promise<string> {
  const raw = await resolveNodeLatex(root, query, cache, macroDb)
  // Root mode: envMode > db style > default. This is what decides whether
  // to wrap the whole thing in \text{...} (for a root-level text env).
  let rootMode: SnlMacroStyle['mode'] = 'formula_inline'
  if (root.envMode) {
    rootMode = root.envMode
  } else {
    const macro = macroDb[root.name]
    if (macro) {
      try {
        rootMode = resolveStyle(root, macro).mode
      } catch {
        rootMode = 'formula_inline'
      }
    }
  }
  // NOTE: the envMode path already emitted its own `\text{…}` head for the
  // 'text' case (see resolveNodeLatex), so we don't double-wrap. Only the
  // legacy db-driven text root path gets wrapped here.
  if (rootMode === 'text' && !root.envMode) {
    return `\\text{${raw}}`
  }
  return raw
}

/** Props for {@link SnlSyntaxTreeView}. */
export interface SnlSyntaxTreeViewProps {
  /** The (annotated) syntax tree to render. */
  tree: SnlSyntaxTree
  /** Template query — resolves a macro name to its KaTeX template string. */
  query: SnlMacroTemplateQuery
  /** The macro DB, used for mode dispatch and metadata. */
  macroDb: SnlMacroDb
  /** KaTeX options forwarded to `katex.renderToString`. */
  katexOptions?: KatexOptions
  /**
   * Kind → color registry. Merged over {@link DEFAULT_KIND_PALETTE} (consumer
   * entries win, defaults fill the rest). Drives per-kind text/hover colors via
   * an inline `<style>` the view injects.
   */
  kindPalette?: KindPalette
  /** Called with the resolved LaTeX source (formula root only). */
  onResolved?: (latexSource: string) => void
  /** Override tooltip / hover / description / renderer behavior. Merged over defaults. */
  hooks?: SnlRenderHooks
}

/** Internal tooltip state = public SnlTooltipState + interaction key for staleness checks. */
type TooltipState = SnlTooltipState & { interactionKey: string }

/**
 * Resolve a node's render mode from its macro's resolved style.
 * The mode lives per-style (v2/v5): different styles of the same macro can
 * render as formula vs text/block. Defaults to 'formula' when unknown.
 */
/**
 * Resolve a node's render mode from its macro's resolved style.
 * The mode lives per-style (v3): different styles of the same macro can
 * render as formula/text/block. Defaults to 'formula_inline' when unknown.
 */
function nodeMode(node: SnlSyntaxTree, db: SnlMacroDb): SnlMacroStyle['mode'] {
  // envMode from a delimited-name form (`%…%`, `$…$`, `$$…$$`) always wins
  // over the db lookup — that's the whole point of "temp macro" semantics.
  if (node.envMode) return node.envMode
  const macro = db[node.name]
  if (!macro) return 'formula_inline'
  try {
    return resolveStyle(node, macro).mode
  } catch {
    return 'formula_inline'
  }
}

/**
 * Resolve a node's KaTeX display mode. Only the ROOT node of an independent
 * KaTeX render counts — nested formula nodes' `display` values are ignored
 * within a single render call. In v3 the display axis is folded into the
 * mode itself: `formula_display` → block, everything else → inline.
 */
function nodeDisplay(node: SnlSyntaxTree, db: SnlMacroDb): 'inline' | 'block' {
  return nodeMode(node, db) === 'formula_display' ? 'block' : 'inline'
}

function MathSpan({
  node,
  query,
  macroDb,
  katexOptions,
}: {
  node: SnlSyntaxTree
  query: SnlMacroTemplateQuery
  macroDb: SnlMacroDb
  katexOptions?: KatexOptions
}): ReactElement {
  const [html, setHtml] = useState('')
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const latex = await resolveRootLatex(node, query, new Map<string, string>(), macroDb)
        const out = katex.renderToString(latex, {
          throwOnError: false,
          ...HTMLDATA_KATEX_DEFAULTS,
          displayMode: nodeDisplay(node, macroDb) === 'block',
          ...katexOptions,
        })
        if (!cancelled) setHtml(out)
      } catch {
        if (!cancelled) setHtml('')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [node, query, macroDb, katexOptions])
  return <span className="snl-math-span" dangerouslySetInnerHTML={{ __html: html }} />
}

function useSnlSyntaxTreeRender(
  tree: SnlSyntaxTree,
  query: SnlMacroTemplateQuery,
  macroDb: SnlMacroDb,
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
        const latex = await resolveRootLatex(tree, query, cache, macroDb)
        const html = katex.renderToString(latex, {
          throwOnError: false,
          ...HTMLDATA_KATEX_DEFAULTS,
          displayMode: nodeDisplay(tree, macroDb) === 'block',
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
  }, [cache, enabled, katexOptions, query, macroDb, tree])

  return { loading, error, result }
}

/**
 * Renders an (annotated) {@link SnlSyntaxTree} to KaTeX-in-React with hover
 * interactions. Dispatches by the resolved style's `mode`
 * (formula / text / block). All interaction is customizable via `hooks`.
 */
export function SnlSyntaxTreeView({
  tree,
  query,
  macroDb,
  katexOptions,
  kindPalette,
  onResolved,
  hooks,
}: SnlSyntaxTreeViewProps) {
  const mergedHooks = useMemo(() => ({ ...defaultRenderHooks, ...hooks }), [hooks])
  const paletteCss = useMemo(
    () => paletteToCss({ ...DEFAULT_KIND_PALETTE, ...kindPalette }),
    [kindPalette],
  )
  // Both formula AND text roots run through KaTeX (a text root just wraps
  // its whole latex in `\text{...}` — see resolveNodeLatex + wrapForParent).
  // Only block roots use the React branch below.
  const isKatexRoot = nodeMode(tree, macroDb) !== 'block'
  const { loading, error, result } = useSnlSyntaxTreeRender(
    tree,
    query,
    macroDb,
    katexOptions,
    isKatexRoot,
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
    tightenHoverBoxes(el)
    bvarScopeIndexRef.current = buildBvarScopeIndex(el)
  }, [result])

  // Non-KaTeX roots (block only) render as a React tree; rebuild the
  // bvar-scope index from the mounted DOM (best-effort — MathSpan leaves
  // settle async, and the highlight strategy falls back to a live DOM query
  // when an entry is missing).
  useEffect(() => {
    if (isKatexRoot) return
    const el = containerRef.current
    if (!el) return
    lastHtmlRef.current = null
    bvarScopeIndexRef.current = buildBvarScopeIndex(el)
  }, [isKatexRoot, tree])

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
    const macro = macroDb[name]
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
          bindingHint = `标注为 bvar（bindRef=${bindRef}），但未找到带 data-scope="binder" 的祖先。`
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
        bindingHint = `binder 但未找到 binder scope（bindRef=${bindRef}）。`
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

    const macro = macroDb[name]
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
      el.classList.remove('snl-bvar-scope', 'snl-binder-decl', 'snl-single-hover')
    })
    hoverMarkedElsRef.current = []
  }

  const applyHighlightSet = (set: SnlHighlightSet) => {
    const touched = new Set<HTMLElement>()
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

    // elementsFromPoint returns every element painted at (x,y) in front-to-back
    // order. In principle every DOM ancestor of the topmost hit is present, so
    // filtering for data-name would grab the innermost SNL wrap.
    //
    // In practice, some KaTeX layout primitives (vlist, mspace, table cell
    // strut) sit in their own stacking layers or don't paint at the pointer
    // coordinate, so an ancestor `.enclosing[data-name]` occasionally does
    // NOT appear in the elementsFromPoint list even though it's the correct
    // hover target (case 猫猫 flagged 2026-07-04 for dynamic-arity delimiters
    // and separators between children in a matrix template).
    //
    // Fix: take the topmost element regardless of data-name, then walk UP the
    // DOM tree until we hit an ancestor carrying data-name. Falls back to
    // clearing when no ancestor has one.
    const topmost = document
      .elementsFromPoint(event.clientX, event.clientY)
      .find(
        (el): el is HTMLElement =>
          el instanceof HTMLElement && container.contains(el),
      )

    const hit = topmost
      ? findMinimalHoverRoot(topmost, container)
      : null
    // findMinimalHoverRoot already skips partial-kind ancestors, but its
    // fallback returns the raw `start` when nothing matches. Guard on both
    // "has data-name" AND "not partial" so hovering into empty space above a
    // partial node clears the highlight instead of latching onto it.
    const hasName =
      hit && hit.hasAttribute('data-name') && hit.dataset.kind !== 'partial'
        ? hit
        : null

    if (!hasName) {
      clearHoverMarks()
      setHoverKey('')
      clearHoverTimers()
      setTooltip((prev) => (prev ? { ...prev, visible: false } : null))
      return
    }

    applyHoverHighlight(hasName, container)
    activateHoverTarget(hasName, container, event.clientX + 12, event.clientY + 12)
  }

  const handleKaTeXMouseLeave = () => {
    clearHoverMarks()
    setHoverKey('')
    clearHoverTimers()
    setTooltip((prev) => (prev ? { ...prev, visible: false } : null))
    mergedHooks.onLeave?.()
  }

  // Mode-aware React dispatch (used for non-KaTeX roots — i.e. block only —
  // and for children of block nodes). Formula and text nodes both render
  // through <MathSpan/>, which runs the full LaTeX pipeline (formula stays
  // math, text wraps in `\text{...}` and can nest `$...$` for math children).
  const renderNode = (node: SnlSyntaxTree): ReactElement => {
    const mode = nodeMode(node, macroDb)
    if (mode === 'block') {
      const macro = macroDb[node.name]
      const key = macro ? resolveStyle(node, macro).react_renderer_key : undefined
      const Renderer = key ? mergedHooks.renderers?.[key] : undefined
      if (Renderer) {
        return <Renderer node={node} macroDb={macroDb} renderChild={renderNode} />
      }
      return (
        <div className="snl-block">
          {node.children.map((child, index) => (
            <Fragment key={index}>{renderNode(child)}</Fragment>
          ))}
        </div>
      )
    }
    // formula OR text: single unified path — KaTeX renders the whole subtree,
    // with parent/child mode dispatch (`\text{...}` / `$...$`) resolved by
    // resolveNodeLatex's wrapForParent(). A text macro can still opt into a
    // custom React renderer via `react_renderer_key`.
    if (mode === 'text') {
      const macro = macroDb[node.name]
      const style = macro ? resolveStyle(node, macro) : undefined
      const key = style?.react_renderer_key
      const Renderer = key ? mergedHooks.renderers?.[key] : undefined
      if (Renderer) {
        return <Renderer node={node} macroDb={macroDb} renderChild={renderNode} />
      }
    }
    return (
      <MathSpan node={node} query={query} macroDb={macroDb} katexOptions={katexOptions} />
    )
  }

  if (isKatexRoot) {
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
      <style dangerouslySetInnerHTML={{ __html: paletteCss }} />
      <div
        ref={containerRef}
        className="katex-html"
        onMouseMove={handleKaTeXMouseMove}
        onMouseLeave={handleKaTeXMouseLeave}
      >
        {isKatexRoot ? null : renderNode(tree)}
      </div>
      {tooltip ? mergedHooks.renderTooltip?.(tooltip) ?? null : null}
    </div>
  )
}
