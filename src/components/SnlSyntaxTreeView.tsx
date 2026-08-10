import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEventHandler,
  type MouseEventHandler,
  type ReactElement,
  type ReactNode,
} from 'react'
import katex from 'katex'
import type { KatexOptions } from 'katex'
import type { SnlMacro, SnlMacroRecord } from '../snl-macro/types'
import { MacroDataDriver } from '../snl-macro/macro-data-driver'
import type { LanguageEnvironment, ReaderRuntime } from '../runtime'
import {
  SnlInteractionDriver,
  decodeTreePath,
  resolveTreePath,
  type SnlInteractionContext,
  type TreePath,
} from '../snl-react-view/interaction-driver'
import { getBindRef, getSrc, getTreeSourcePath } from '../snl-syntax-tree/binding'
import {
  buildBvarScopeIndex,
  readBindingSourceKeyFromDom,
  type BvarScopeEntry,
} from '../snl-syntax-tree/bvar-scope-index'
import { tightenHoverBoxes } from '../snl-react-view/tighten-hover-boxes'
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'
import { resolveSnlSemantics, type SnlDiagnostic } from '../snl-syntax-tree/semantic-resolver'

import {
  assert_valid_style_template,
  modeBucket,
  nodeDisplay,
  nodeMode,
  resolveRootLatex,
  resolveStyle,
  resolve_style_template,
} from '../snl-react-view/render-source'
import { findMinimalHoverRoot } from '../snl-react-view/hover-dom'
import { applySnlHoverHighlight } from '../snl-react-view/hover-apply'
import { HTMLDATA_KATEX_DEFAULTS } from '../snl-react-view/katex-defaults'
import { resolveRenderedKind } from '../snl-react-view/kind-behavior'
import {
  DEFAULT_SNL_ACTIVATION_CONTROLLER,
  type SnlActivationDispatcher,
} from '../snl-react-view/activation-controller'
import {
  DEFAULT_SNL_DEACTIVATION_CONTROLLER,
  type SnlActivationLease,
  type SnlActivationSnapshot,
  type SnlDeactivationController,
  type SnlDeactivationReason,
} from '../snl-react-view/deactivation-controller'
import {
  DEFAULT_KIND_PALETTE,
  paletteToCss,
  type KindPalette,
} from '../snl-react-view/kind-palette'
import {
  defaultRenderHooks,
  type SnlRenderHooks,
  type SnlHoverPhaseEvent,
  type SnlHoverSession,
  type SnlResolvedSource,
  type SnlTooltipState,
} from '../snl-react-view/hooks'

interface RenderResult {
  latex: string
  html: string
  reqId: number
}

const OWNED_INTERACTION_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  'option',
  'summary',
  'label',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[data-snl-interaction-boundary]',
].join(',')

/** True when a descendant control owns the event before its SNL activation root. */
function hasOwnedInteractionBoundary(start: HTMLElement, activationRoot: HTMLElement): boolean {
  let current: HTMLElement | null = start
  while (current && current !== activationRoot) {
    if (current.matches(OWNED_INTERACTION_SELECTOR)) return true
    current = current.parentElement
  }
  return false
}

/** Props for {@link SnlSyntaxTreeView}. */
export interface SnlSyntaxTreeViewProps {
  /** The (annotated) syntax tree to render. */
  tree: SnlSyntaxTree
  /** The single macro data source — query-only driver with bounded cache. */
  macro_data_driver: MacroDataDriver
  /** Consumer-owned runtime used to select the language-dependent default style. */
  reader_runtime?: ReaderRuntime<LanguageEnvironment<string>>
  /** Injectable interaction handler (hover/leave/click/ctrl-click via delegated events). */
  interaction_driver?: SnlInteractionDriver
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
  /** Initialization-time switch/replacement/params policy for phases 0/1/2. */
  activation_controller?: SnlActivationDispatcher<SnlHoverPhaseEvent>
  /** Synchronous policy for clearing the current activation. */
  deactivation_controller?: SnlDeactivationController<any, any>
  /** Resolver warnings/errors for editor surfaces; rendering remains fail-closed. */
  onDiagnostics?: (diagnostics: readonly SnlDiagnostic[]) => void
}

/** Internal tooltip state = public SnlTooltipState + interaction key for staleness checks. */
type TooltipState = SnlTooltipState & { interactionKey: string }

/**
 * Resolve a node's render mode from its macro's resolved style.
 * The mode lives per-style (v2/v5): different styles of the same macro can
 * render as formula vs text/block. Defaults to 'formula' when unknown.
 */
function MathSpan({
  node,
  driver,
  reader_runtime,
  treePath,
  katexOptions,
  language,
}: {
  node: SnlSyntaxTree
  driver: MacroDataDriver
  reader_runtime?: ReaderRuntime<LanguageEnvironment<string>>
  treePath: TreePath
  katexOptions?: KatexOptions
  language: string
}): ReactElement {
  const spanRef = useRef<HTMLSpanElement | null>(null)
  const currentHtmlRef = useRef<string>('')
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    void (async () => {
      try {
        const latex = await resolveRootLatex(
          node,
          driver,
          controller.signal,
          treePath,
          reader_runtime,
          language,
        )
        const macro = node.env_mode ? null : await driver.query_macro({ macro_name: node.macro_name, signal: controller.signal })
        const out = katex.renderToString(latex, {
          throwOnError: false,
          ...HTMLDATA_KATEX_DEFAULTS,
          displayMode: nodeDisplay(
            node,
            macro,
            language,
          ) === 'block',
          ...katexOptions,
        })
        if (cancelled) return
        const el = spanRef.current
        if (el && currentHtmlRef.current !== out) {
          currentHtmlRef.current = out
          el.classList.remove('katex-error', 'snl-render-error')
          el.removeAttribute('role')
          el.innerHTML = out
        }
      } catch (reason) {
        if (cancelled) return
        const el = spanRef.current
        if (el) {
          const message = reason instanceof Error ? reason.message : String(reason)
          currentHtmlRef.current = ''
          el.classList.add('katex-error', 'snl-render-error')
          el.setAttribute('role', 'alert')
          el.textContent = `SNL render error: ${message}`
        }
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [node, driver, reader_runtime, treePath, katexOptions, language])
  return <span className="snl-math-span" ref={spanRef} />
}

/**
 * TextRun — renders a text-mode node (leaf or macro) as native HTML,
 * with formula children escaping into KaTeX and block children into
 * block renderers. Cat 2026-07-10: replaces the old "wrap the whole
 * text subtree in \text{...}" path, so a text macro can now contain
 * a block macro (enumerate / list / table).
 *
 * Semantics:
 *  - Text LEAF (envMode==='text', no children) → the leaf's `name`
 *    field carries the raw text; emit it as a plain <span>.
 *  - Text MACRO with a template → split the template on #N / #* and
 *    interleave literal text runs with rendered children. Missing
 *    slots become the standard [N] placeholder.
 *  - Text MACRO WITHOUT a template → concat children joined by the
 *    style's variadic separator (default '').
 *  - Any escape-command in the literal text (e.g. \alpha) is kept
 *    verbatim. This is a deliberate simplification: consumers who
 *    want the LaTeX glyph should wrap that fragment in $...$ so it
 *    goes through KaTeX. Reserved literals `\{`, `\}`, `\\`, `\#`
 *    are unescaped so authors can produce those characters.
 */
/**
 * Resolve the kind we should stamp on a rendered node's DOM. Mirrors
 * wrapHtmlData's priority: node.kind > queried macro kind > root 'sub' /
 * descendant 'fvar'. Kept in
 * sync so TextRun spans hover-highlight exactly like KaTeX \htmlData
 * output. Empty-string kind (createSnlSyntaxTreeNode default) falls
 * through — `||` is deliberate.
 */
function resolveNodeKind(node: SnlSyntaxTree, macros: SnlMacroRecord, isRoot = false): string {
  const macro = node.env_mode ? null : macros[node.macro_name]
  return resolveRenderedKind(node, macro, isRoot)
}

function TextRun({
  node,
  macros,
  reader_runtime,
  treePath,
  renderChild,
  language,
}: {
  node: SnlSyntaxTree
  macros: SnlMacroRecord
  reader_runtime?: ReaderRuntime<LanguageEnvironment<string>>
  treePath: string
  renderChild: (child: SnlSyntaxTree, index: number) => ReactElement
  language: string
}): ReactElement {
  // Envelope semantics — see the block comment below.
  const envIsText = node.env_mode === 'text'
  const temporarySource = node.temporary_source ?? node.macro_name ?? ''
  const nameHasPlaceholder = /#(\*|\d{1,2})/.test(temporarySource)
  const isSyntheticTemplate = envIsText && nameHasPlaceholder

  // DOM attribute payload — mirrors wrapHtmlData so hover / palette /
  // popover machinery treats a TextRun span exactly like a KaTeX
  // \htmlData-wrapped node. `data-name` drives hover-root discovery,
  // `data-kind` drives the palette CSS.
  const kind = resolveNodeKind(node, macros, treePath === '')
  const dataAttrs: Record<string, string | undefined> = {
    'data-name': node.macro_name || undefined,
    'data-kind': kind,
    'data-tree-path': treePath,
  }
  if (node.style_name) dataAttrs['data-style'] = node.style_name
  if (node.scope) dataAttrs['data-scope'] = node.scope
  const bindRef = getBindRef(node)
  if (bindRef) dataAttrs['data-bindref'] = bindRef
  const srcVal = getSrc(node)
  if (srcVal) dataAttrs['data-src'] = srcVal
  const sourcePath = getTreeSourcePath(node)
  if (sourcePath !== undefined) dataAttrs['data-source-path'] = sourcePath

  const wrap = (children: ReactNode): ReactElement => kind === 'sub'
    ? <>{children}</>
    : <span className="snl-text snl-hoverable" {...dataAttrs}>{children}</span>

  // (a) envMode text without #N placeholders is its own literal payload.
  // Temporary Canvas nodes remain structurally extensible, so append their
  // children after rendering the payload (including `$…$` math islands)
  // instead of dropping the payload merely because a child slot exists.
  if (envIsText && !isSyntheticTemplate) {
    return wrap(
      <>
        {renderTextWithMathIslands(temporarySource)}
        {node.children.map((child, index) => (
          <Fragment key={index}>{renderChild(child, index)}</Fragment>
        ))}
      </>,
    )
  }
  // (d) plain leaf (no macro) → literal name.
  if (!envIsText && node.children.length === 0 && !macros[node.macro_name]) {
    return wrap(renderTextWithMathIslands(node.macro_name ?? ''))
  }

  const macro = macros[node.macro_name]
  const style = macro
    ? resolveStyle(node, macro, language)
    : undefined
  const template = isSyntheticTemplate
    ? temporarySource
    : style
      ? resolve_style_template(style, reader_runtime, language)
      : ''
  const children = node.children

  // Build the ordered fragment list by scanning the template for
  // `#N` / `#*` / `\#`. We reuse the same escape sentinel as
  // fillLatexTemplate so `\#` survives.
  const parts: Array<{ kind: 'text'; value: string } | { kind: 'child'; index: number | '*' }> = []
  if (template.length > 0) {
    const ESCAPED = '\u0001HASH\u0001'
    const src = template.replace(/\\#/g, ESCAPED)
    const re = /#(\*|\d{1,2})/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(src)) !== null) {
      if (m.index > last) {
        parts.push({
          kind: 'text',
          value: src.slice(last, m.index).split(ESCAPED).join('#'),
        })
      }
      parts.push({
        kind: 'child',
        index: m[1] === '*' ? '*' : Number(m[1]),
      })
      last = re.lastIndex
    }
    if (last < src.length) {
      parts.push({
        kind: 'text',
        value: src.slice(last).split(ESCAPED).join('#'),
      })
    }
  } else {
    // No template: emit every child joined by the style's separator.
    const sep = style?.separator ?? ''
    children.forEach((_, i) => {
      if (i > 0 && sep) parts.push({ kind: 'text', value: sep })
      parts.push({ kind: 'child', index: i })
    })
  }

  return wrap(
    parts.map((p, i) => {
      if (p.kind === 'text') {
        return (
          <Fragment key={i}>{renderTextWithMathIslands(p.value)}</Fragment>
        )
      }
      if (p.index === '*') {
        // Variadic slot — emit every child in order, separated by the
        // style's join (default '' in text mode, matching KaTeX path).
        const sep = style?.separator ?? ''
        return (
          <Fragment key={i}>
            {children.map((child, ci) => (
              <Fragment key={ci}>
                {ci > 0 && sep ? <span>{sep}</span> : null}
                {renderChild(child, ci)}
              </Fragment>
            ))}
          </Fragment>
        )
      }
      const child = children[p.index]
      if (!child) {
        return (
          <span key={i} className="snl-missing-arg">
            [{p.index}]
          </span>
        )
      }
      return <Fragment key={i}>{renderChild(child, p.index)}</Fragment>
    }),
  )
}

/**
 * Undo the small set of literal-escape sequences authors need in a
 * text-mode payload. Everything else (`\alpha`, `\frac{...}`) is left
 * ALONE — if you want a LaTeX glyph in text mode, wrap it in `$...$`
 * so it goes through KaTeX via a formula child.
 */
function unescapeTextLiterals(s: string): string {
  return s
    .replace(/\\#/g, '#')
    .replace(/\\\{/g, '{')
    .replace(/\\\}/g, '}')
    .replace(/\\\\/g, '\\')
}

/**
 * Render a literal-text run from a text-mode context, but recognize
 * `$…$` (inline math) and `$$…$$` (display math) islands and hand them
 * to KaTeX. Cat 2026-07-12: 'text 宏里面的 $ ... $ 依然要走 KaTeX'.
 *
 * Escape convention:
 *   `\$`  → literal dollar (does NOT open math)
 *   `$…$` → inline math; contents are raw KaTeX source
 *   `$$…$$` → display math; contents are raw KaTeX source
 *
 * Non-math runs still go through `unescapeTextLiterals` for `\#`, `\{`,
 * `\}`, `\\`. Unbalanced `$` (no closing pair) falls back to literal.
 * On KaTeX throw, the offending run is emitted as literal text in red so
 * a broken formula never eats the surrounding prose.
 */
function renderTextWithMathIslands(src: string): ReactNode[] {
  const parts: ReactNode[] = []
  // Scanner state — walk char by char so we can honor `\$` cleanly.
  let i = 0
  let literalStart = 0
  const flushLiteral = (end: number, keyOffset: number): void => {
    if (end <= literalStart) return
    const piece = src.slice(literalStart, end)
    // Strip \\$ → $ AFTER we've decided this is literal (we still needed
    // the backslash to prevent math opening earlier in the scan).
    const withDollar = piece.replace(/\\\$/g, '$')
    const lines = unescapeTextLiterals(withDollar).split(/\r\n?|\n/)
    lines.forEach((line, lineIndex) => {
      if (line.length > 0) {
        parts.push(<Fragment key={`t-${keyOffset}-${lineIndex}`}>{line}</Fragment>)
      }
      // Native HTML collapses literal newlines inside a span. Materialize
      // authored line breaks explicitly so text templates such as
      // `interface(...):\n#1` keep the break before a block child.
      if (lineIndex < lines.length - 1) {
        parts.push(<br key={`br-${keyOffset}-${lineIndex}`} />)
      }
    })
  }
  while (i < src.length) {
    const ch = src[i]
    // Backslash-escaped dollar: skip the pair, stay in literal mode.
    if (ch === '\\' && src[i + 1] === '$') {
      i += 2
      continue
    }
    if (ch !== '$') {
      i += 1
      continue
    }
    // Encountered a `$`. Decide inline vs display and find the closer.
    const isDisplay = src[i + 1] === '$'
    const openLen = isDisplay ? 2 : 1
    const searchFrom = i + openLen
    // For inline, we must skip over `\$` sequences in the payload.
    let closeAt = -1
    if (isDisplay) {
      closeAt = src.indexOf('$$', searchFrom)
    } else {
      let j = searchFrom
      while (j < src.length) {
        if (src[j] === '\\' && src[j + 1] === '$') {
          j += 2
          continue
        }
        // Guard against $$ inside inline scan (author probably meant
        // display) — treat as unmatched to be safe.
        if (src[j] === '$' && src[j + 1] === '$') {
          break
        }
        if (src[j] === '$') {
          closeAt = j
          break
        }
        j += 1
      }
    }
    if (closeAt < 0) {
      // Unmatched — treat the `$` as a literal, keep scanning.
      i += 1
      continue
    }
    // Emit the literal run before the opening delimiter.
    flushLiteral(i, i)
    const latex = src.slice(searchFrom, closeAt)
    const key = `m-${i}`
    let html: string
    try {
      html = katex.renderToString(latex, {
        displayMode: isDisplay,
        throwOnError: true,
        strict: false,
        trust: false,
      })
    } catch (err) {
      html = ''
      parts.push(
        <span
          key={key}
          style={{ color: 'var(--vscode-errorForeground, #f48771)' }}
          title={err instanceof Error ? err.message : String(err)}
        >
          {src.slice(i, closeAt + openLen)}
        </span>,
      )
    }
    if (html) {
      parts.push(
        <span key={key} className="snl-math-span" dangerouslySetInnerHTML={{ __html: html }} />,
      )
    }
    i = closeAt + openLen
    literalStart = i
  }
  flushLiteral(src.length, src.length)
  return parts
}

function useSnlSyntaxTreeRender(
  tree: SnlSyntaxTree,
  driver: MacroDataDriver,
  reader_runtime: ReaderRuntime<LanguageEnvironment<string>> | undefined,
  katexOptions: KatexOptions | undefined,
  enabled: boolean,
  language: string,
) {
  const [result, setResult] = useState<RenderResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const reqIdRef = useRef(0)

  useEffect(() => {
    if (!enabled) {
      setResult(null)
      setError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    const controller = new AbortController()
    const reqId = ++reqIdRef.current

    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const latex = await resolveRootLatex(
          tree,
          driver,
          controller.signal,
          [],
          reader_runtime,
          language,
        )
        const rootMacro = tree.env_mode ? null : await driver.query_macro({ macro_name: tree.macro_name, signal: controller.signal })
        const html = katex.renderToString(latex, {
          throwOnError: false,
          ...HTMLDATA_KATEX_DEFAULTS,
          displayMode: nodeDisplay(
            tree,
            rootMacro,
            language,
          ) === 'block',
          ...katexOptions,
        })
        if (!cancelled && reqIdRef.current === reqId) {
          setResult({ latex, html, reqId })
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
      controller.abort()
    }
  }, [enabled, katexOptions, driver, reader_runtime, tree, language])

  return { loading, error, result, reqIdRef }
}

/**
 * Renders an (annotated) {@link SnlSyntaxTree} to KaTeX-in-React with hover
 * interactions. Dispatches by the resolved style's `mode`
 * (formula / text / block). All interaction is customizable via `hooks`.
 */
export function SnlSyntaxTreeView({
  tree,
  macro_data_driver,
  reader_runtime,
  interaction_driver: _interaction_driver,
  katexOptions,
  kindPalette,
  onResolved,
  hooks,
  activation_controller = DEFAULT_SNL_ACTIVATION_CONTROLLER,
  deactivation_controller = DEFAULT_SNL_DEACTIVATION_CONTROLLER,
  onDiagnostics,
}: SnlSyntaxTreeViewProps) {
  const renderLanguage = reader_runtime?.query_environment().language ?? 'en'
  // Query all macros used by this tree through the single driver backend. The
  // state is tagged with the exact tree+driver identities, so a prop change
  // immediately makes the previous projection stale — it is never rendered
  // while the replacement query is in flight.
  const [macroState, setMacroState] = useState<{
    tree: SnlSyntaxTree
    driver: MacroDataDriver
    values: Record<string, SnlMacro | null>
    status: 'pending' | 'ready' | 'error'
    error: string | null
  }>(() => ({
    tree,
    driver: macro_data_driver,
    values: {},
    status: 'pending',
    error: null,
  }))

  const macroStateIsCurrent = macroState.tree === tree && macroState.driver === macro_data_driver
  const macroCache = macroStateIsCurrent ? macroState.values : {}
  const macroStatus = macroStateIsCurrent ? macroState.status : 'pending'
  const macroError = macroStateIsCurrent ? macroState.error : null

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    function collectMacroNames(node: SnlSyntaxTree, names: Set<string>): void {
      if (!node.env_mode && node.macro_name) names.add(node.macro_name)
      for (const child of node.children) collectMacroNames(child, names)
    }
    const names = new Set<string>()
    collectMacroNames(tree, names)

    void (async () => {
      try {
        const resolved: Record<string, SnlMacro | null> = {}
        await Promise.all(
          [...names].map(async (name) => {
            resolved[name] = await macro_data_driver.query_macro({ macro_name: name, signal: controller.signal })
          }),
        )
        if (!cancelled) {
          setMacroState({ tree, driver: macro_data_driver, values: resolved, status: 'ready', error: null })
        }
      } catch (err) {
        if (!cancelled) {
          setMacroState({
            tree,
            driver: macro_data_driver,
            values: {},
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [tree, macro_data_driver])

  const mergedHooks = useMemo(() => ({ ...defaultRenderHooks, ...hooks }), [hooks])
  const colorScheme = macro_data_driver.read_context().color_scheme
  const paletteCss = useMemo(() => {
    return paletteToCss({ ...DEFAULT_KIND_PALETTE, ...kindPalette }, colorScheme)
  }, [colorScheme, kindPalette])
  // Derive a SnlMacroRecord-compatible view from the cache (filters out nulls)
  const resolvedMacros: SnlMacroRecord = useMemo(() => {
    const db: SnlMacroRecord = {}
    for (const [k, v] of Object.entries(macroCache)) {
      if (v) db[k] = v
    }
    return db
  }, [macroCache])

  const semanticResolution = useMemo(
    () => macroStatus === 'ready'
      ? resolveSnlSemantics(tree, resolvedMacros)
      : { tree, diagnostics: [] },
    [macroStatus, resolvedMacros, tree],
  )
  const renderTree = semanticResolution.tree
  useEffect(() => {
    onDiagnostics?.(semanticResolution.diagnostics)
  }, [onDiagnostics, semanticResolution])

  const treePaths = useMemo(() => {
    const paths = new WeakMap<SnlSyntaxTree, string>()
    const visit = (node: SnlSyntaxTree, path: string): void => {
      paths.set(node, path)
      node.children.forEach((child, index) => visit(child, path ? `${path}.${index}` : `${index}`))
    }
    visit(renderTree, '')
    return paths
  }, [renderTree])

  // Determine root mode from the cache
  const rootMacro = macroCache[renderTree.macro_name] ?? null
  const rootBucket = macroStatus === 'ready'
    ? modeBucket(nodeMode(renderTree, rootMacro, renderLanguage))
    : 'formula'
  const isKatexRoot = macroStatus === 'ready' && rootBucket === 'formula'
  const { loading, error, result } = useSnlSyntaxTreeRender(
    renderTree,
    macro_data_driver,
    reader_runtime,
    katexOptions,
    isKatexRoot,
    renderLanguage,
  )
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [hoverKey, setHoverKey] = useState('')
  const [hasHoverTarget, setHasHoverTarget] = useState(false)

  const prefetchTimerRef = useRef<number | null>(null)
  const showTimerRef = useRef<number | null>(null)
  const lockTimerRef = useRef<number | null>(null)
  const hoverSessionIdRef = useRef(0)
  const hoverSessionRef = useRef<{ key: string; session: SnlHoverSession } | null>(null)
  const activationIdRef = useRef(0)
  const currentActivationRef = useRef<{
    snapshot: SnlActivationSnapshot
    lease: SnlActivationLease
  } | null>(null)
  const interactionGenerationRef = useRef(0)
  const interactionIdentityRef = useRef({ tree, driver: macro_data_driver })
  const infoRequestRef = useRef<{ key: string; generation: number } | null>(null)
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
      currentActivationRef.current = null
      interactionGenerationRef.current += 1
      hoverSessionRef.current = null
      infoRequestRef.current = null
      if (prefetchTimerRef.current) {
        window.clearTimeout(prefetchTimerRef.current)
      }
      if (showTimerRef.current) {
        window.clearTimeout(showTimerRef.current)
      }
      if (lockTimerRef.current) {
        window.clearTimeout(lockTimerRef.current)
      }
    }
  }, [])

  // Clear the DOM the moment `tree` changes so a stale KaTeX render
  // never sits on screen while the new async run is still resolving.
  // Cat 2026-07-13: typing `d → de → def` (where `def` is a macro) used
  // to briefly flash the `de` fvar render because that render had
  // already committed to innerHTML and stayed there until the `def`
  // run's setState propagated. Reset first, then let the effect below
  // paint the fresh result.
  useEffect(() => {
    if (!isKatexRoot) return
    const el = containerRef.current
    if (!el) return
    lastHtmlRef.current = null
    el.innerHTML = ''
  }, [isKatexRoot, renderTree])

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
  }, [isKatexRoot, renderTree])

  const clearHoverTimers = () => {
    if (prefetchTimerRef.current) {
      window.clearTimeout(prefetchTimerRef.current)
      prefetchTimerRef.current = null
    }
    if (showTimerRef.current) {
      window.clearTimeout(showTimerRef.current)
      showTimerRef.current = null
    }
    if (lockTimerRef.current) {
      window.clearTimeout(lockTimerRef.current)
      lockTimerRef.current = null
    }
  }

  const clearHoverMarks = () => {
    hoverMarkedElsRef.current.forEach((el) => {
      el.classList.remove('snl-bvar-scope', 'snl-binder-decl', 'snl-single-hover')
    })
    hoverMarkedElsRef.current = []
  }

  const clearActivationState = (preserveHiddenTooltip = false): void => {
    interactionGenerationRef.current += 1
    infoRequestRef.current = null
    hoverSessionRef.current = null
    clearHoverTimers()
    clearHoverMarks()
    setHasHoverTarget(false)
    setHoverKey('')
    setTooltip((previous) => preserveHiddenTooltip && previous
      ? { ...previous, visible: false }
      : null)
  }

  const createActivation = (
    node: SnlSyntaxTree,
    treePath: TreePath,
    target: HTMLElement,
    phase: 0 | 1 | 2,
  ): SnlActivationLease => {
    const current = currentActivationRef.current
    if (current && current.snapshot.target === target) {
      current.snapshot = Object.freeze({ ...current.snapshot, phase })
      return current.lease
    }
    const activationId = ++activationIdRef.current
    const lease: SnlActivationLease = Object.freeze({
      activation_id: activationId,
      request_deactivate: (reason: SnlDeactivationReason, cause?: unknown): boolean => {
        const active = currentActivationRef.current
        if (!active || active.snapshot.activation_id !== activationId) return false
        return deactivation_controller.dispatch(reason, active.snapshot, cause, () => {
          const latest = currentActivationRef.current
          if (!latest || latest.snapshot.activation_id !== activationId) return
          currentActivationRef.current = null
          const causeType = cause && typeof cause === 'object' && 'type' in cause
            ? String((cause as { type?: unknown }).type ?? '')
            : ''
          clearActivationState(
            reason === 'pointer-leave' ||
            (reason === 'blank-activation' && causeType === 'mousemove'),
          )
        })
      },
    })
    currentActivationRef.current = {
      snapshot: Object.freeze({
        activation_id: activationId,
        node,
        tree_path: Object.freeze([...treePath]),
        target,
        phase,
      }),
      lease,
    }
    return lease
  }

  const updateActivationPhase = (lease: SnlActivationLease, phase: 0 | 1 | 2): boolean => {
    const current = currentActivationRef.current
    if (!current || current.snapshot.activation_id !== lease.activation_id) return false
    current.snapshot = Object.freeze({ ...current.snapshot, phase })
    return true
  }

  const resolveInfo = async (
    name: string,
    variableRole: 'bvar' | 'fvar' | 'none',
    bindingHint: string,
  ) => {
    const macro = resolvedMacros[name]
    const base = await mergedHooks.resolveMacroInfo!(name, macro)
    let description = base.description

    if (variableRole === 'fvar') {
      description = '自由变量（无编译期 bindRef，或与量词引入不匹配）'
    } else if (variableRole === 'bvar') {
      description = `${description}\n\n${bindingHint}`.trim()
    }

    return { description, extra: base.extra }
  }

  const beginInfoRequest = (
    key: string,
    name: string,
    variableRole: 'bvar' | 'fvar' | 'none',
    bindingHint: string,
  ) => {
    const generation = interactionGenerationRef.current
    const pending = infoRequestRef.current
    if (pending?.key === key && pending.generation === generation) return
    infoRequestRef.current = { key, generation }
    void resolveInfo(name, variableRole, bindingHint)
      .catch((value: unknown) => ({
        description: value instanceof Error ? value.message : String(value),
      }))
      .then((info) => {
        if (interactionGenerationRef.current !== generation) return
        setTooltip((prev) => prev && prev.interactionKey === key
          ? { ...prev, loading: false, info }
          : prev)
      })
  }

  const invokeHook = <T,>(hook: ((event: T) => unknown) | undefined, event: T): void => {
    try {
      const result = hook?.(event)
      if (result !== undefined) void Promise.resolve(result).catch(() => {})
    } catch { /* consumer hooks cannot break defaults */ }
  }

  const invokeLeaveHook = (hook: (() => unknown) | undefined): void => {
    try {
      const result = hook?.()
      if (result !== undefined) void Promise.resolve(result).catch(() => {})
    } catch { /* consumer hooks cannot break cleanup */ }
  }

  const activateHoverTarget = (
    target: HTMLElement,
    x: number,
    y: number,
    modifiers: { ctrl_key: boolean; meta_key: boolean; shift_key: boolean; alt_key: boolean },
    lockImmediately = false,
  ): SnlActivationLease | null => {
    const tooltipX = x + 12
    const tooltipY = y + 12
    const name = target.dataset.name ?? ''
    const kind = target.dataset.kind ?? ''
    const bindingKey = readBindingSourceKeyFromDom(target)
    const pathAttr = target.getAttribute('data-tree-path')
    const treePath = pathAttr == null ? null : decodeTreePath(pathAttr)
    const actualNode = treePath == null ? undefined : resolveTreePath(renderTree, treePath)
    const bindingEntry = bindingKey
      ? bvarScopeIndexRef.current.get(bindingKey)
      : undefined
    const bindingScope = bindingEntry?.scopeRoot ?? null

    let variableRole: 'bvar' | 'fvar' | 'none' = 'none'
    let bindingHint = ''

    if (kind === 'bvar') {
      if (bindingKey || target.dataset.src) {
        if (bindingScope) {
          variableRole = 'bvar'
          const sourceName = bindingScope.dataset.name ?? ''
          bindingHint = `绑定变量：source=${bindingKey}，对应 source「${sourceName}」。`
        } else if (target.dataset.src) {
          variableRole = 'bvar'
          bindingHint = `外部 Entry source：${target.dataset.src}。`
        } else {
          variableRole = 'fvar'
          bindingHint = `标注为 bvar（source=${bindingKey}），但 source path 已失效。`
        }
      } else {
        variableRole = 'fvar'
        bindingHint = '标注为 bvar 但无有效 source。'
      }
    } else if (kind === 'binder' && bindingKey) {
      if (bindingScope) {
        variableRole = 'bvar'
        bindingHint = `binder source=${bindingKey}（同 source path 的 bvar 为使用处）。`
      } else {
        variableRole = 'fvar'
        bindingHint = `binder 但 source path 已失效（${bindingKey}）。`
      }
    } else if (kind === 'fvar') {
      variableRole = 'fvar'
      bindingHint = '自由变量 occurrence。'
    }

    const key = `${pathAttr ?? 'unresolved'}|${name}|${kind}|${bindingKey}`
    if (tooltip?.locked && !lockImmediately) return null

    const active = currentActivationRef.current
    if (active && active.snapshot.target !== target) {
      const retired = active.lease.request_deactivate('superseded', {
        next_node: actualNode,
        next_tree_path: treePath,
        next_target: target,
      })
      if (!retired) return null
    }

    let session = hoverSessionRef.current?.key === key
      ? hoverSessionRef.current.session
      : null
    if (!session) {
      interactionGenerationRef.current += 1
      infoRequestRef.current = null
      session = { id: ++hoverSessionIdRef.current, data: new Map() }
      hoverSessionRef.current = { key, session }
    }
    const hoverEvent: SnlHoverPhaseEvent | null = actualNode ? {
      session,
      name: actualNode.macro_name,
      kind,
      node: actualNode,
      bindingHint,
      variableRole,
      target,
      clientX: x,
      clientY: y,
    } : null
    if (!hoverEvent) return null
    const phase = lockImmediately ? 2 : 0
    if (!activation_controller.dispatch(phase, hoverEvent, () => {})) return null
    const activation = createActivation(actualNode!, treePath!, target, phase)
    const activationContainer = containerRef.current
    if (activationContainer) {
      ensureBindingIndexForTarget(target, activationContainer)
      applyHoverHighlight(target, activationContainer, phase)
    }
    const interactionMacro = actualNode ? (resolvedMacros[actualNode.macro_name] ?? null) : null
    if (actualNode && treePath) {
      if (!lockImmediately) invokeHook(mergedHooks.onHover, hoverEvent!)
      if (!lockImmediately && _interaction_driver) {
        void _interaction_driver.dispatch_hover({
          node: actualNode,
          tree_path: treePath,
          macro: interactionMacro,
          target,
          client_x: x,
          client_y: y,
          ctrl_key: modifiers.ctrl_key,
          meta_key: modifiers.meta_key,
          shift_key: modifiers.shift_key,
          alt_key: modifiers.alt_key,
          activation,
        }).catch(() => {})
      }
    }

    if (hoverKey === key) {
      if (lockImmediately) {
        clearHoverTimers()
        setTooltip((prev) => prev && prev.interactionKey === key
          ? { ...prev, visible: true, locked: true }
          : prev)
        beginInfoRequest(key, name, variableRole, bindingHint)
      } else {
        setTooltip((prev) => prev && prev.interactionKey === key
          ? { ...prev, x: tooltipX, y: tooltipY }
          : prev)
      }
      return activation
    }

    const macro = resolvedMacros[name]
    const source: SnlResolvedSource | null = macro
      ? (mergedHooks.resolveSource?.(macro.source) ?? null)
      : null

    setHoverKey(key)
    clearHoverTimers()
    setTooltip({
      visible: lockImmediately,
      locked: lockImmediately,
      x: tooltipX,
      y: tooltipY,
      loading: true,
      interactionKey: key,
      name,
      kind,
      variableRole,
      bindingHint,
      info: null,
      source,
    })

    if (lockImmediately) {
      beginInfoRequest(key, name, variableRole, bindingHint)
      return activation
    }

    prefetchTimerRef.current = window.setTimeout(() => {
      beginInfoRequest(key, name, variableRole, bindingHint)
    }, 500)

    showTimerRef.current = window.setTimeout(() => {
      activation_controller.dispatch(1, hoverEvent, () => {
        if (!updateActivationPhase(activation, 1)) return
        const container = containerRef.current
        if (container) applyHoverHighlight(target, container, 1)
        invokeHook(mergedHooks.onHover1s, hoverEvent)
        setTooltip((prev) => {
          if (!prev || prev.interactionKey !== key) return prev
          return { ...prev, visible: true }
        })
      })
    }, 1000)

    lockTimerRef.current = window.setTimeout(() => {
      activation_controller.dispatch(2, hoverEvent, () => {
        if (!updateActivationPhase(activation, 2)) return
        const container = containerRef.current
        if (container) applyHoverHighlight(target, container, 2)
        invokeHook(mergedHooks.onHover2s, hoverEvent)
        setTooltip((prev) => {
          if (!prev || prev.interactionKey !== key) return prev
          return { ...prev, visible: true, locked: true }
        })
      })
    }, 2000)
    return activation
  }

  useEffect(() => {
    const previous = interactionIdentityRef.current
    if (previous.tree === tree && previous.driver === macro_data_driver) return
    interactionIdentityRef.current = { tree, driver: macro_data_driver }
    currentActivationRef.current = null
    interactionGenerationRef.current += 1
    infoRequestRef.current = null
    hoverSessionRef.current = null
    clearHoverTimers()
    clearHoverMarks()
    setHasHoverTarget(false)
    setHoverKey('')
    setTooltip(null)
  }, [tree, macro_data_driver])

  /**
   * Delegates to the shared DOM-only implementation so the panel and the
   * static HTML export cannot drift apart — they are literally the same code
   * path now (猫猫 2026-07-29). The ref bookkeeping stays here because it is a
   * React-lifecycle concern the shared helper has no business knowing about.
   */
  const applyHoverHighlight = (
    target: HTMLElement,
    container: HTMLElement,
    phase: 0 | 1 | 2 = 0,
  ) => {
    clearHoverMarks()
    const set = applySnlHoverHighlight(target, container, {
      strategy: mergedHooks.highlightStrategy ?? defaultRenderHooks.highlightStrategy!,
      bvarScopeIndex: bvarScopeIndexRef.current,
      phase,
    })
    const touched = new Set<HTMLElement>()
    if (set.singleHover) touched.add(set.singleHover)
    for (const el of set.bvarScope) touched.add(el)
    for (const el of set.binderDecl) touched.add(el)
    hoverMarkedElsRef.current = [...touched]
  }

  const ensureBindingIndexForTarget = (target: HTMLElement, container: HTMLElement): void => {
    const kind = target.dataset.kind ?? ''
    const bindingKey = readBindingSourceKeyFromDom(target)
    if ((kind !== 'binder' && kind !== 'bvar') || !bindingKey) return
    const entry = bvarScopeIndexRef.current.get(bindingKey)
    const targetIsIndexed = kind === 'bvar'
      ? entry?.bvars.includes(target)
      : entry?.binders.includes(target)
    if (!targetIsIndexed) {
      bvarScopeIndexRef.current = buildBvarScopeIndex(container)
    }
  }

  const handleKaTeXMouseMove: MouseEventHandler<HTMLDivElement> = (event) => {
    const container = containerRef.current
    if (!container) return
    if (tooltip?.locked) return

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
    // findMinimalHoverRoot already skips sub-kind ancestors, but its
    // fallback returns the raw `start` when nothing matches. Guard on both
    // "has data-name" AND "not sub" so hovering into empty space above a
    // sub node clears the highlight instead of latching onto it.
    const hasName =
      hit && hit.hasAttribute('data-name') && hit.dataset.kind !== 'sub' &&
      (!topmost || !hasOwnedInteractionBoundary(topmost, hit))
        ? hit
        : null

    if (!hasName) {
      const active = currentActivationRef.current
      if (active) active.lease.request_deactivate('blank-activation', event.nativeEvent)
      else clearActivationState(true)
      return
    }

    // `applyHoverHighlight` captures `--snl-base-text-color` from the
    // container before marking (see hover-apply.ts), so it is not set here.
    setHasHoverTarget(true)
    activateHoverTarget(hasName, event.clientX, event.clientY, {
      ctrl_key: event.ctrlKey,
      meta_key: event.metaKey,
      shift_key: event.shiftKey,
      alt_key: event.altKey,
    })
  }

  const handleKaTeXMouseLeave = () => {
    invokeLeaveHook(mergedHooks.onLeave)
    if (_interaction_driver) {
      void _interaction_driver.dispatch_leave().catch(() => {})
    }
    if (tooltip?.locked) return
    const active = currentActivationRef.current
    if (active) active.lease.request_deactivate('pointer-leave')
    else clearActivationState(true)
  }

  useEffect(() => {
    const container = containerRef.current
    if (!container || !_interaction_driver?.on_click) return
    const interactive: HTMLElement[] = []
    for (const element of container.querySelectorAll<HTMLElement>('[data-tree-path]')) {
      const path = decodeTreePath(element.getAttribute('data-tree-path') ?? '')
      const node = resolveTreePath(renderTree, path)
      const macro = node ? resolvedMacros[node.macro_name] : undefined
      if (!macro?.source.entries[0]) continue
      element.tabIndex = 0
      element.setAttribute('role', 'button')
      element.dataset.snlKeyboardActivation = 'true'
      interactive.push(element)
    }
    return () => {
      for (const element of interactive) {
        if (element.dataset.snlKeyboardActivation !== 'true') continue
        element.removeAttribute('tabindex')
        element.removeAttribute('role')
        delete element.dataset.snlKeyboardActivation
      }
    }
  }, [_interaction_driver, resolvedMacros, result, renderTree])

  const dispatchElementActivation = (
    el: HTMLElement,
    clientX: number,
    clientY: number,
    modifiers: { ctrl_key: boolean; meta_key: boolean; shift_key: boolean; alt_key: boolean },
  ): void => {
    const container = containerRef.current
    if (!container) return
    const path = decodeTreePath(el.getAttribute('data-tree-path') ?? '')
    const node = resolveTreePath(renderTree, path)
    if (!node) return
    const macro = resolvedMacros[node.macro_name] ?? null
    const activation = activateHoverTarget(el, clientX, clientY, modifiers, true)
    if (!activation) return
    const ctx: SnlInteractionContext = {
      node,
      tree_path: path,
      macro,
      target: el,
      activation,
      client_x: clientX,
      client_y: clientY,
      ctrl_key: modifiers.ctrl_key,
      meta_key: modifiers.meta_key,
      shift_key: modifiers.shift_key,
      alt_key: modifiers.alt_key,
    }
    setHasHoverTarget(true)
    if (_interaction_driver) void _interaction_driver.dispatch_click(ctx).catch(() => {})
  }

  // Delegated click handler — resolves data-tree-path → actual node → dispatch
  const handleClick: MouseEventHandler<HTMLDivElement> = (event) => {
    const container = containerRef.current
    if (!container) return
    let el: HTMLElement | null = event.target as HTMLElement
    while (el && el !== container && !el.hasAttribute('data-tree-path')) el = el.parentElement
    if (!el || !el.hasAttribute('data-tree-path')) {
      const active = currentActivationRef.current
      if (active) active.lease.request_deactivate('blank-activation', event.nativeEvent)
      else clearActivationState()
      return
    }
    const eventTarget = event.target instanceof HTMLElement ? event.target : null
    if (eventTarget && hasOwnedInteractionBoundary(eventTarget, el)) return
    dispatchElementActivation(el, event.clientX, event.clientY, {
      ctrl_key: event.ctrlKey,
      meta_key: event.metaKey,
      shift_key: event.shiftKey,
      alt_key: event.altKey,
    })
  }

  const handleKeyDown: KeyboardEventHandler<HTMLDivElement> = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const target = event.target instanceof HTMLElement
      ? event.target.closest<HTMLElement>('[data-snl-keyboard-activation="true"]')
      : null
    if (!target || !event.currentTarget.contains(target)) return
    if (event.target instanceof HTMLElement && hasOwnedInteractionBoundary(event.target, target)) return
    event.preventDefault()
    const rect = target.getBoundingClientRect()
    dispatchElementActivation(target, rect.left + rect.width / 2, rect.top + rect.height / 2, {
      ctrl_key: event.ctrlKey,
      meta_key: event.metaKey,
      shift_key: event.shiftKey,
      alt_key: event.altKey,
    })
  }

  // Mode-aware React dispatch (used for non-KaTeX roots — text and
  // block — and for children of block / text nodes).
  //
  // Cat 2026-07-10 refactor rule: "只要一个节点的 predecessors 里面没有
  // 出现过 formula, 非必要绝不进 KaTeX. 一旦进了 KaTeX, 走 \text{}
  // 命令，然后我们暂时不支持在外面出现过 formula mode 的子树里面写
  // block mode 的宏."
  //
  // Implementation: renderNode is only invoked when we haven't hit a
  // formula ancestor yet (formula roots + all their descendants go via
  // MathSpan / resolveNodeLatex from the top). So here we can safely
  // treat:
  //   - block  → block renderer (unchanged path)
  //   - text   → React TextRun (was KaTeX \text{}); formula CHILDREN
  //              of a text node cross into KaTeX via MathSpan
  //   - formula descendant of a text parent → MathSpan (from here
  //     down we're in KaTeX; block descendants get the "cannot use
  //     block inside formula" placeholder in resolveNodeLatex)
  const renderNode = (node: SnlSyntaxTree, pathStr = ''): ReactElement => {
    const macro = resolvedMacros[node.macro_name] ?? null
    let selectedStyle: SnlMacro['styles'][number] | undefined
    try {
      selectedStyle = macro ? resolveStyle(node, macro, renderLanguage) : undefined
      if (selectedStyle) assert_valid_style_template(selectedStyle)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      return <span className="katex-error snl-render-error" role="alert">SNL render error: {message}</span>
    }
    const mode = nodeMode(node, macro, renderLanguage)
    if (mode === 'block') {
      const key = selectedStyle?.block_template_name
      const Renderer = key ? mergedHooks.renderers?.[key] : undefined
      const blockKind = resolveNodeKind(node, resolvedMacros, pathStr === '')
      const blockDataAttrs: Record<string, string | undefined> = blockKind === 'sub'
        ? {}
        : {
            'data-name': node.macro_name || undefined,
            'data-kind': blockKind,
            'data-tree-path': pathStr,
            'data-style': node.style_name,
            'data-scope': node.scope,
            'data-bindref': getBindRef(node) ?? undefined,
            'data-src': getSrc(node) ?? undefined,
            'data-source-path': getTreeSourcePath(node),
          }
      if (Renderer) {
        return (
          <div className="snl-block-host" {...blockDataAttrs}>
            <Renderer
              node={node}
              macro_data_driver={macro_data_driver}
              renderChild={(child) => renderNode(child, treePaths.get(child) ?? '')}
            />
          </div>
        )
      }
      return (
        <div className="snl-block" {...blockDataAttrs}>
          {node.children.map((child, index) => (
            <Fragment key={index}>{renderNode(child, pathStr ? `${pathStr}.${index}` : `${index}`)}</Fragment>
          ))}
        </div>
      )
    }
    if (mode === 'text') {
      return (
        <TextRun
          node={node}
          macros={resolvedMacros}
          reader_runtime={reader_runtime}
          language={renderLanguage}
          treePath={pathStr}
          renderChild={(child, idx) => renderNode(child, pathStr ? `${pathStr}.${idx}` : `${idx}`)}
        />
      )
    }
    // formula descendant of a text/block parent: KaTeX pipeline takes over
    return (
      <MathSpan
        node={node}
        driver={macro_data_driver}
        reader_runtime={reader_runtime}
        language={renderLanguage}
        treePath={decodeTreePath(pathStr)}
        katexOptions={katexOptions}
      />
    )
  }

  if (macroStatus === 'pending') {
    return <div className="katex-panel">Loading macro data ...</div>
  }
  if (macroStatus === 'error') {
    return <div className="katex-panel katex-error">Macro query failed: {macroError}</div>
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
      {/*
       * Cat 2026-07-13: use `isKatexRoot` as a KEY so React unmounts the
       * OLD container div (React-rendered TextRun subtree, or KaTeX
       * innerHTML surface) the instant we switch modes. Without this,
       * typing `deff → def` (fvar → macro) left the previous
       * TextRun-rendered `deff` glyph in the DOM while the new KaTeX
       * render was written on top via innerHTML, producing a stacked
       * "text + macro" display. Distinct keys guarantee a fresh DOM node
       * per mode; containerRef binds to whichever branch is mounted.
       */}
      <div
        key={isKatexRoot ? 'katex' : 'react'}
        ref={containerRef}
        className="katex-html"
        style={{ cursor: hasHoverTarget ? 'pointer' : undefined }}
        onMouseMove={handleKaTeXMouseMove}
        onMouseLeave={handleKaTeXMouseLeave}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        {isKatexRoot ? null : renderNode(renderTree)}
      </div>
      {tooltip ? mergedHooks.renderTooltip?.(tooltip) ?? null : null}
    </div>
  )
}
