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

import type { SnlMacro, SnlMacroStyle } from '../snl-macro/types'
import {
  is_i18n,
  read_localized,
  type LanguageEnvironment,
  type ReaderM,
  type ReaderRuntime,
} from '../runtime'
import { MacroDataDriver } from '../snl-macro/macro-data-driver'
import { getBindRef, getSrc } from '../snl-syntax-tree/binding'
import { escapeLatexText, escapeTextButPreservePlaceholders } from '../snl-syntax-tree/latex-escape'
import { fillLatexTemplate } from '../snl-syntax-tree/template'
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'
import { encodeTreePath, type TreePath } from './interaction-driver'

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
 * the parser's `[style]` bracket (`node.style_name`); when missing, `styles[0]` is
 * the implicit default. Throws if the resolved tag isn't in `macro.styles`.
 */
export function resolveStyle(node: SnlSyntaxTree, macro: SnlMacro): SnlMacroStyle {
  if (macro.styles.length === 0) {
    throw new Error(`macro "${macro.name}" has no styles`)
  }
  if (node.style_name == null) {
    return macro.styles[0]
  }
  const style = macro.styles.find((s) => s.style_name === node.style_name)
  if (!style) {
    throw new Error(
      `unknown style "${node.style_name}" for macro "${macro.name}" ` +
        `(available: ${macro.styles.map((s) => s.style_name).join(', ') || '(none)'})`,
    )
  }
  return style
}

/** Resolve a style template from consumer-supplied language preferences. */
export function read_style_template(
  style: SnlMacroStyle,
): ReaderM<LanguageEnvironment<string>, string> {
  return read_localized<string, string>(style.template)
}

/** Run a style-template Reader at a renderer boundary. */
export function resolve_style_template(
  style: SnlMacroStyle,
  reader_runtime?: ReaderRuntime<LanguageEnvironment<string>>,
): string {
  if (!is_i18n(style.template)) return style.template
  if (!reader_runtime) {
    throw new Error('localized text Macro template requires reader_runtime')
  }
  return reader_runtime.run_reader(read_style_template(style))
}

/**
 * Auto-wrap a rendered node's latex in a single `\htmlData{name,kind[,style][,bindRef][,treePath]}`.
 * This is the sole place metadata enters the KaTeX output — templates never
 * write `\htmlData` themselves. Accepts resolved macro (or null) for the node.
 */
export function wrapHtmlData(
  node: SnlSyntaxTree,
  inner: string,
  macro: SnlMacro | null,
  treePath?: TreePath,
  kindOverride?: string,
): string {
  const name = sanitizeHtmlDataAttr(node.macro_name)
  const dbKind = macro?.kind
  const kind = sanitizeHtmlDataAttr(
    kindOverride || node.kind || dbKind || 'fvar',
  )
  const ref = getBindRef(node)
  const bindRefFragment = ref ? `,bindRef=${sanitizeHtmlDataAttr(ref)}` : ''
  const srcVal = getSrc(node)
  const srcFragment = srcVal ? `,src=${sanitizeHtmlDataAttr(srcVal)}` : ''
  const scopeFragment = node.scope ? `,scope=${sanitizeHtmlDataAttr(node.scope)}` : ''
  const styleFragment = node.style_name ? `,style=${sanitizeHtmlDataAttr(node.style_name)}` : ''
  const pathFragment = treePath ? `,tree-path=${encodeTreePath(treePath)}` : ''
  return `\\htmlData{name=${name},kind=${kind}${styleFragment}${scopeFragment}${bindRefFragment}${srcFragment}${pathFragment}}{${inner}}`
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
 * env_mode (delimited-name form) beats queried macro data; both formula sub-modes
 * default to `formula_inline` when unknown.
 * Accepts a pre-resolved macro (null if not found or not queried yet).
 */
export function nodeMode(node: SnlSyntaxTree, macro: SnlMacro | null): SnlMacroStyle['mode'] {
  if (node.env_mode) return node.env_mode
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
export function nodeDisplay(node: SnlSyntaxTree, macro: SnlMacro | null): 'inline' | 'block' {
  return nodeMode(node, macro) === 'formula_display' ? 'block' : 'inline'
}

/**
 * Recursively resolve a node into its KaTeX source. Templates get filled;
 * children get wrapped with `wrapForParent` so text/formula splicing is
 * valid; missing macros use the same fallback the react view uses
 * (`\operatorname{…}` head for applied form, `\mathrm{…}` for leaf).
 *
 * `driver` is queried for each unique macro_name encountered. The driver's
 * internal cache avoids redundant queries.
 */
export async function resolveNodeLatex(
  node: SnlSyntaxTree,
  driver: MacroDataDriver,
  treePath: TreePath = [],
  signal?: AbortSignal,
  reader_runtime?: ReaderRuntime<LanguageEnvironment<string>>,
): Promise<string> {
  const macro = node.env_mode ? null : await driver.query_macro({ macro_name: node.macro_name, signal })
  const style = macro ? resolveStyle(node, macro) : undefined
  const hasDbMacro = Boolean(macro)

  const selfMode: SnlMacroStyle['mode'] =
    node.env_mode ?? style?.mode ?? 'formula_inline'
  const selfBucket = modeBucket(selfMode)

  const childRawList = await Promise.all(
    node.children.map((child, i) => resolveNodeLatex(child, driver, [...treePath, i], signal, reader_runtime)),
  )

  const wrappedChildren = await Promise.all(childRawList.map(async (latex, index) => {
    const child = node.children[index]
    let cMode: SnlMacroStyle['mode'] = 'formula_inline'
    if (child?.env_mode) {
      cMode = child.env_mode
    } else {
      const childMacro = await driver.query_macro({ macro_name: child.macro_name, signal })
      if (childMacro) {
        try {
          cMode = resolveStyle(child, childMacro).mode
        } catch {
          cMode = 'formula_inline'
        }
      }
    }
    return wrapForParent(latex, cMode, selfMode)
  }))

  // Block descendant inside a formula ancestor: emit a visible warning
  if (selfBucket === 'block') {
    const body =
      '\\text{\\color{red}\\{block macro `' +
      escapeLatexText(node.macro_name) +
      '` cannot be used inside a formula\\}}'
    return wrapHtmlData(node, body, macro, treePath)
  }

  // Synthetic-macro path (delimited-name form).
  if (node.env_mode) {
    const isText = node.env_mode === 'text'
    const templateBody = isText ? escapeTextButPreservePlaceholders(node.macro_name) : node.macro_name
    const childValues = Object.fromEntries(
      wrappedChildren.map((latex, index) => [`child${index}`, latex]),
    )
    const filled = fillLatexTemplate(
      templateBody,
      { ...childValues },
      isText ? 'text' : 'formula',
    )
    const body = isText ? `\\text{${filled}}` : filled
    return wrapHtmlData(node, body, macro, treePath)
  }

  // Query-miss fallback for plain-identifier names.
  if (!hasDbMacro) {
    const bs = node.macro_name.startsWith('\\')
    if (node.children.length > 0) {
      const stem = bs ? node.macro_name.slice(1) : node.macro_name
      const head = bs
        ? `\\operatorname{${escapeLatexText(stem)}}`
        : node.macro_name
      const argList = wrappedChildren.join(', ')
      return wrapHtmlData(node, `${head}(${argList})`, macro, treePath)
    }
    if (bs) {
      const stem = node.macro_name.slice(1)
      return wrapHtmlData(node, `\\mathrm{${escapeLatexText(stem)}}`, macro, treePath)
    }
  }

  const template = style ? resolve_style_template(style, reader_runtime) : node.macro_name

  const childValues = Object.fromEntries(
    wrappedChildren.map((latex, index) => [`child${index}`, latex]),
  )
  const defaultSep = selfBucket === 'text' ? '' : ', '
  const separator = style?.separator ?? defaultSep
  const children_joined = wrappedChildren.join(separator)

  // Dynamic-arity macro handling
  if (macro?.dynamic_arity) {
    // If template contains #*, fill it (this handles \begin{pmatrix}#*\end{pmatrix} etc.)
    if (template.includes('#*')) {
      const filled = fillLatexTemplate(
        template,
        { ...childValues, children_joined },
        selfBucket,
      )
      // KaTeX environments (\begin{...}...\end{...}) and alignment tokens
      // (& or \\) cannot be nested inside \htmlData{}{...}, so skip wrapping.
      if (/\\begin\{/.test(filled) || /(?:^|[^\\])&|\\\\/.test(separator)) {
        return filled
      }
      return wrapHtmlData(node, filled, macro, treePath)
    }
    throw new Error(`dynamic macro "${macro.name}" requires #* in its template`)
  }

  const filled = fillLatexTemplate(
    template,
    { ...childValues, children_joined },
    selfBucket,
  )
  return wrapHtmlData(node, filled, macro, treePath)
}

/**
 * Render the ROOT node's LaTeX for a KaTeX render. If the root is text-mode,
 * wrap its raw LaTeX in `\text{...}` so KaTeX renders it as text.
 */
export async function resolveRootLatex(
  root: SnlSyntaxTree,
  driver: MacroDataDriver,
  signal?: AbortSignal,
  treePath: TreePath = [],
  reader_runtime?: ReaderRuntime<LanguageEnvironment<string>>,
): Promise<string> {
  const raw = await resolveNodeLatex(root, driver, treePath, signal, reader_runtime)
  const macro = root.env_mode ? null : await driver.query_macro({ macro_name: root.macro_name, signal })
  let rootMode: SnlMacroStyle['mode'] = 'formula_inline'
  if (root.env_mode) {
    rootMode = root.env_mode
  } else if (macro) {
    try {
      rootMode = resolveStyle(root, macro).mode
    } catch {
      rootMode = 'formula_inline'
    }
  }
  // env_mode 'text' path already emitted its own \text{…}; only a queried
  // text root gets wrapped here.
  if (rootMode === 'text' && !root.env_mode) {
    return `\\text{${raw}}`
  }
  return raw
}
