/**
 * Pure SNL-tree → KaTeX-source renderer.
 *
 * This module is the "no React, no DOM, no KaTeX runtime" core of the
 * preview pipeline. It walks an annotated SnlSyntaxTree, resolves each
 * node's style via a query, and produces the exact KaTeX source string
 * that SnlSyntaxTreeView would feed into `katex.renderToString`.
 *
 * Extracted from `../components/SnlSyntaxTreeView.tsx` (2026-07-14) so
 * the SNL-Agent-Toolkit's entry linter can compile-check the same
 * source-of-truth without pulling React / KaTeX / the DOM into a
 * command-line tool. `SnlSyntaxTreeView` re-imports these helpers
 * verbatim.
 *
 * Nothing here allocates a DOM node. `wrapHtmlData` emits KaTeX's
 * `\htmlData{…}{…}` command as a string; KaTeX itself decides whether
 * the eventual render will honor it (default HTMLDATA options do), and
 * the string is 100% compilable in a headless `katex.renderToString`
 * regardless.
 */

import type { SnlMacroTemplateQuery } from '../snl-syntax-tree/query'
import type { SnlMacro, SnlMacroDb, SnlMacroStyle } from '../snl-macro/types'
import { getBindRef, getSrc } from '../snl-syntax-tree/binding'
import { escapeLatexText, escapeTextButPreservePlaceholders } from '../snl-syntax-tree/latex-escape'
import { fillLatexTemplate } from '../snl-syntax-tree/template'
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'

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
export function sanitizeHtmlDataAttr(value: string): string {
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
export function resolveStyle(node: SnlSyntaxTree, macro: SnlMacro): SnlMacroStyle {
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
 */
export function wrapHtmlData(
  node: SnlSyntaxTree,
  inner: string,
  macroDb: SnlMacroDb,
  kindOverride?: string,
): string {
  const name = sanitizeHtmlDataAttr(node.name)
  const dbKind = node.name ? macroDb[node.name]?.kind : undefined
  const kind = sanitizeHtmlDataAttr(
    kindOverride || node.kind || dbKind || 'fvar',
  )
  const ref = getBindRef(node)
  const bindRefFragment = ref ? `,bindRef=${sanitizeHtmlDataAttr(ref)}` : ''
  const srcVal = getSrc(node)
  const srcFragment = srcVal ? `,src=${sanitizeHtmlDataAttr(srcVal)}` : ''
  const scopeFragment = node.scope ? `,scope=${sanitizeHtmlDataAttr(node.scope)}` : ''
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
export function wrapForParent(
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
  return childLatex
}

/**
 * Collapse the 4-value mode into the LaTeX-visible bucket used by
 * wrapForParent + resolveRootLatex. Both formula sub-modes behave
 * identically for splicing purposes — only the ROOT render decides
 * KaTeX displayMode.
 */
export function modeBucket(mode: SnlMacroStyle['mode']): 'formula' | 'text' | 'block' {
  if (mode === 'block') return 'block'
  if (mode === 'text') return 'text'
  return 'formula'
}

/**
 * Resolve a node's render mode from its macro's resolved style.
 * envMode (delimited-name form) beats the DB; both formula sub-modes
 * default to `formula_inline` when unknown.
 */
export function nodeMode(node: SnlSyntaxTree, db: SnlMacroDb): SnlMacroStyle['mode'] {
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
 * ROOT-only display axis. In v3 the display axis is folded into the mode
 * itself: `formula_display` → block, everything else → inline. Nested
 * formula nodes' displays are ignored within a single render call.
 */
export function nodeDisplay(node: SnlSyntaxTree, db: SnlMacroDb): 'inline' | 'block' {
  return nodeMode(node, db) === 'formula_display' ? 'block' : 'inline'
}

/**
 * Recursively resolve a node into its KaTeX source. Templates get filled;
 * children get wrapped with `wrapForParent` so text/formula splicing is
 * valid; missing macros use the same fallback the react view uses
 * (`\operatorname{…}` head for applied form, `\mathrm{…}` for leaf).
 *
 * `cache` memoizes the template-fetch call for each `name::style::kind`
 * triple — the query is potentially async / expensive. Callers who want
 * fresh templates should pass a new `Map` each time.
 */
export async function resolveNodeLatex(
  node: SnlSyntaxTree,
  query: SnlMacroTemplateQuery,
  cache: Map<string, string>,
  macroDb: SnlMacroDb,
): Promise<string> {
  const macro = node.name ? macroDb[node.name] : undefined
  const style = macro ? resolveStyle(node, macro) : undefined
  const hasDbTemplate = Boolean(style?.template)

  const selfMode: SnlMacroStyle['mode'] =
    node.envMode ?? style?.mode ?? 'formula_inline'
  const selfBucket = modeBucket(selfMode)

  const childRawList = await Promise.all(
    node.children.map((child) => resolveNodeLatex(child, query, cache, macroDb)),
  )

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

  // Block descendant inside a formula ancestor: emit a visible warning
  // rather than silently rendering empty.
  if (selfBucket === 'block') {
    const body =
      '\\text{\\color{red}\\{block macro `' +
      escapeLatexText(node.name) +
      '` cannot be used inside a formula\\}}'
    return wrapHtmlData(node, body, macroDb)
  }

  // Synthetic-macro path (delimited-name form).
  if (node.envMode) {
    const isText = node.envMode === 'text'
    const templateBody = isText ? escapeTextButPreservePlaceholders(node.name) : node.name
    const childValues = Object.fromEntries(
      wrappedChildren.map((latex, index) => [`child${index}`, latex]),
    )
    const filled = fillLatexTemplate(
      templateBody,
      { ...childValues },
      isText ? 'text' : 'formula',
    )
    const body = isText ? `\\text{${filled}}` : filled
    return wrapHtmlData(node, body, macroDb)
  }

  // macroDb-miss fallback for plain-identifier names.
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
  // Pure pass-through variadic helper (e.g. matrix.row): keep alignment
  // tokens ungrouped for the enclosing environment.
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
export async function resolveRootLatex(
  root: SnlSyntaxTree,
  query: SnlMacroTemplateQuery,
  cache: Map<string, string>,
  macroDb: SnlMacroDb,
): Promise<string> {
  const raw = await resolveNodeLatex(root, query, cache, macroDb)
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
  // envMode 'text' path already emitted its own \text{…}; only the
  // db-driven text root gets wrapped here.
  if (rootMode === 'text' && !root.envMode) {
    return `\\text{${raw}}`
  }
  return raw
}
