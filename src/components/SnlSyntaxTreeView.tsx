import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEventHandler,
  type ReactElement,
  type ReactNode,
} from 'react'
import katex from 'katex'
import type { KatexOptions } from 'katex'
import type { SnlMacroTemplateQuery } from '../snl-syntax-tree/query'
import type { SnlMacro, SnlMacroDb, SnlMacroStyle } from '../snl-macro/types'
import { getBindRef, getSrc, readBindRefFromDom } from '../snl-syntax-tree/binding'
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
  /**
   * Which effect run produced this result. Consumers commit it to the
   * DOM only when it matches the latest reqId, so stale HTML from a
   * superseded async run can never replace a fresher render already on
   * screen — and equally, when a new run starts we clear the DOM up
   * front rather than letting the old render linger for the ~async
   * window it takes KaTeX to resolve.
   */
  reqId: number
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
  // Cross-entry `src` postfix (cat 2026-07-09). Emitted whenever the
  // parser attached one via `x@foo` — extension-side EntryRender wires
  // hover / navigate / warn based on the resolved entry pool. `src` is
  // pure metadata; no styling is applied here so the visual language
  // stays a host-app concern.
  const srcVal = getSrc(node)
  const srcFragment = srcVal ? `,src=${sanitizeHtmlDataAttr(srcVal)}` : ''
  const scopeFragment = node.scope ? `,scope=${sanitizeHtmlDataAttr(node.scope)}` : ''
  // Emit data-style only when a style was explicitly picked via `[style]`
  // (helpful for debugging + CSS if consumers want it).
  const styleFragment = node.style ? `,style=${sanitizeHtmlDataAttr(node.style)}` : ''
  return `\\htmlData{name=${name},kind=${kind}${styleFragment}${scopeFragment}${bindRefFragment}${srcFragment}}{${inner}}`
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

  // --- Block descendant inside a formula ancestor is unsupported ---
  // Cat 2026-07-10: text-mode roots now render via React (TextRun) so
  // block-inside-text works. But once a formula ancestor exists we're
  // committed to the KaTeX pipeline, and KaTeX has no way to embed a
  // React `<ol>` mid-formula. Rather than silently rendering empty,
  // emit a visible warning so the author sees what went wrong.
  if (selfBucket === 'block') {
    const body =
      '\\text{\\color{red}\\{block macro `' +
      escapeLatexText(node.name) +
      '` cannot be used inside a formula\\}}'
    return wrapHtmlData(node, body, macroDb)
  }

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
    selfBucket,
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
  // Cat 2026-07-10 followup2 hover-instability fix: don't use
  // React's `dangerouslySetInnerHTML` — passing a NEW `{__html}`
  // object each render causes React to unconditionally re-assign
  // `.innerHTML`, which tears down the KaTeX DOM subtree and
  // silently drops the .snl-single-hover class that the hover
  // machinery added on the last mousemove. Symptom: hover lit
  // during motion but disappeared the moment the mouse stopped
  // (parent state change → re-render → innerHTML rewrite → class
  // gone; next mousemove re-applies).
  //
  // Fix: render an empty <span>, and manage innerHTML via a ref
  // effect that ONLY writes when the rendered HTML actually
  // changes. React never touches the subtree between writes, so
  // hover marks survive across parent re-renders.
  const spanRef = useRef<HTMLSpanElement | null>(null)
  const currentHtmlRef = useRef<string>('')
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
        if (cancelled) return
        const el = spanRef.current
        if (el && currentHtmlRef.current !== out) {
          currentHtmlRef.current = out
          el.innerHTML = out
        }
      } catch {
        /* leave last-good HTML in place — no destructive reset */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [node, query, macroDb, katexOptions])
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
 * wrapHtmlData's priority: node.kind > macroDb kind > 'fvar'. Kept in
 * sync so TextRun spans hover-highlight exactly like KaTeX \htmlData
 * output. Empty-string kind (createSnlSyntaxTreeNode default) falls
 * through — `||` is deliberate.
 */
function resolveNodeKind(node: SnlSyntaxTree, macroDb: SnlMacroDb): string {
  const dbKind = node.name ? macroDb[node.name]?.kind : undefined
  return node.kind || dbKind || 'fvar'
}

function TextRun({
  node,
  macroDb,
  renderChild,
}: {
  node: SnlSyntaxTree
  macroDb: SnlMacroDb
  renderChild: (child: SnlSyntaxTree) => ReactElement
}): ReactElement {
  // Envelope semantics — see the block comment below.
  const envIsText = node.envMode === 'text'
  const nameHasPlaceholder = /#(\*|\d{1,2})/.test(node.name ?? '')
  const isSyntheticTemplate = envIsText && nameHasPlaceholder

  // DOM attribute payload — mirrors wrapHtmlData so hover / palette /
  // popover machinery treats a TextRun span exactly like a KaTeX
  // \htmlData-wrapped node. `data-name` drives hover-root discovery,
  // `data-kind` drives the palette CSS.
  const kind = resolveNodeKind(node, macroDb)
  const dataAttrs: Record<string, string | undefined> = {
    'data-name': node.name || undefined,
    'data-kind': kind,
  }
  if (node.style) dataAttrs['data-style'] = node.style
  if (node.scope) dataAttrs['data-scope'] = node.scope
  const bindRef = getBindRef(node)
  if (bindRef) dataAttrs['data-bindref'] = bindRef
  const srcVal = getSrc(node)
  if (srcVal) dataAttrs['data-src'] = srcVal

  const wrap = (children: ReactNode): ReactElement => (
    <span className="snl-text snl-hoverable" {...dataAttrs}>
      {children}
    </span>
  )

  // (a) envMode text leaf with no #N placeholder → literal text (with
  // `$…$` math-island escapes handled by renderTextWithMathIslands).
  if (envIsText && !isSyntheticTemplate && node.children.length === 0) {
    return wrap(renderTextWithMathIslands(node.name ?? ''))
  }
  // (d) plain leaf (no macro) → literal name.
  if (!envIsText && node.children.length === 0 && !macroDb[node.name]) {
    return wrap(renderTextWithMathIslands(node.name ?? ''))
  }

  const macro = macroDb[node.name]
  const style = macro ? resolveStyle(node, macro) : undefined
  const template = isSyntheticTemplate ? node.name : (style?.template ?? '')
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
    const sep = style?.variadic_join ?? ''
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
        const sep = style?.variadic_join ?? ''
        return (
          <Fragment key={i}>
            {children.map((child, ci) => (
              <Fragment key={ci}>
                {ci > 0 && sep ? <span>{sep}</span> : null}
                {renderChild(child)}
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
      return <Fragment key={i}>{renderChild(child)}</Fragment>
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
    // Strip \$ → $ AFTER we've decided this is literal (we still needed
    // the backslash to prevent math opening earlier in the scan).
    const withDollar = piece.replace(/\\\$/g, '$')
    parts.push(
      <Fragment key={`t-${keyOffset}`}>{unescapeTextLiterals(withDollar)}</Fragment>,
    )
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
  query: SnlMacroTemplateQuery,
  macroDb: SnlMacroDb,
  katexOptions: KatexOptions | undefined,
  enabled: boolean,
) {
  const [result, setResult] = useState<RenderResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const reqIdRef = useRef(0)
  const cache = useMemo(() => new Map<string, string>(), [query, macroDb])

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
          // Stamp the result with its reqId so the consumer can refuse to
          // commit stale HTML to the DOM. Without this, a rapidly-typing
          // user sees the PREVIOUS successful render remain in innerHTML
          // until the new async run resolves — i.e. typing `d → de → def`
          // (where `def` is a macro) briefly shows the `de` fvar render
          // before flipping to the `def` macro render. Cat 2026-07-13.
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
    }
  }, [cache, enabled, katexOptions, query, macroDb, tree])

  return { loading, error, result, reqIdRef }
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
  // Cat 2026-07-10 refactor: a node goes through the KaTeX pipeline
  // ONLY when it's rooted in FORMULA mode. Text roots (and text
  // subtrees free of any formula ancestor) render via React so a text
  // macro can contain block-mode children (enumerate, list, table…).
  // Block roots keep their React path. resolveNodeLatex still exists
  // for the "text inside formula" case (\text{...} splicing) but is
  // no longer entered from the top for text roots.
  const rootBucket = modeBucket(nodeMode(tree, macroDb))
  const isKatexRoot = rootBucket === 'formula'
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
  }, [isKatexRoot, tree])

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
    if (mode === 'text') {
      // Consumer-declared React renderer wins if a text macro asks for one.
      const macro = macroDb[node.name]
      const style = macro ? resolveStyle(node, macro) : undefined
      const key = style?.react_renderer_key
      const Renderer = key ? mergedHooks.renderers?.[key] : undefined
      if (Renderer) {
        return <Renderer node={node} macroDb={macroDb} renderChild={renderNode} />
      }
      return (
        <TextRun
          node={node}
          macroDb={macroDb}
          renderChild={renderNode}
        />
      )
    }
    // formula descendant of a text/block parent: KaTeX pipeline takes
    // over from HERE down. resolveNodeLatex handles the "\text{...}"
    // wrapping of any text child re-entering formula context.
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
        onMouseMove={handleKaTeXMouseMove}
        onMouseLeave={handleKaTeXMouseLeave}
      >
        {isKatexRoot ? null : renderNode(tree)}
      </div>
      {tooltip ? mergedHooks.renderTooltip?.(tooltip) ?? null : null}
    </div>
  )
}
