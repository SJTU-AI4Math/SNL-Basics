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

import type { SnlBlockMacroTemplate, SnlMacro, SnlMacroStyle, SnlMacroTemplate } from '../snl-macro/types'
import { formulaForeignMarkerLatex, type FormulaForeignCandidate, type FormulaForeignResolution } from './formula-foreign-box'
import {
  type I18n,
  type LanguageEnvironment,
  type ReaderM,
  type ReaderRuntime,
  read_localized,
} from '../runtime'
import { MacroDataDriver } from '../snl-macro/macro-data-driver'
import { getBindRef, getSrc, getTreeSourcePath } from '../snl-syntax-tree/binding'
import { escapeLatexText, escapeTextButPreservePlaceholders } from '../snl-syntax-tree/latex-escape'
import { slotContractKey } from '../snl-syntax-tree/slot-contract'
import { analyzeLatexTemplatePlaceholders, fillLatexTemplate } from '../snl-syntax-tree/template'
import { isEmptySnlSyntaxTreeNode, type SnlSyntaxTree } from '../snl-syntax-tree/types'
import { encodeTreePath, type TreePath } from './interaction-driver'
import { resolveRenderedKind } from './kind-behavior'

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
 * Resolve which {@link SnlMacroStyle} renders a node. An explicit parser
 * `[style]` selector wins. Legacy 0.1.x runtime inputs may still select a
 * language default; current persisted data uses the ordered first style.
 */
export function resolveStyle(
  node: SnlSyntaxTree,
  macro: SnlMacro,
  language = 'en',
): SnlMacroStyle {
  assert_valid_macro_templates(macro)
  if (macro.styles.length === 0) {
    throw new Error(`macro "${macro.name}" has no styles`)
  }
  const legacyDefaults = macro.default_style
  const mappedLanguage = legacyDefaults && Object.prototype.hasOwnProperty.call(legacyDefaults, language)
    ? legacyDefaults[language]
    : undefined
  const mappedEnglish = legacyDefaults && Object.prototype.hasOwnProperty.call(legacyDefaults, 'en')
    ? legacyDefaults.en
    : undefined
  const resolvedName = node.style_name ?? mappedLanguage ?? mappedEnglish
  if (resolvedName == null) return macro.styles[0]
  const style = macro.styles.find((s) => s.style_name === resolvedName)
  if (!style) {
    throw new Error(
      `unknown style "${resolvedName}" for macro "${macro.name}" ` +
        `(available: ${macro.styles.map((s) => s.style_name).join(', ') || '(none)'})`,
    )
  }
  return style
}

/** Validate one complete untrusted template projection. */
function assert_valid_template_spec(template: unknown, styleName: string): void {
  if (!template || typeof template !== 'object' || Array.isArray(template)) {
    throw new Error(`style "${styleName}" has a malformed template projection`)
  }
  const value = template as Record<string, unknown>
  if ('type' in value ||
      !['formula_inline', 'formula_display', 'text', 'block'].includes(String(value.mode)) ||
      typeof value.body !== 'string' ||
      analyzeLatexTemplatePlaceholders(value.body as string).invalid ||
      (value.separator !== undefined && typeof value.separator !== 'string') ||
      (value.block_template_name !== undefined &&
        (value.mode !== 'block' || typeof value.block_template_name !== 'string'))) {
    throw new Error(`style "${styleName}" has a malformed template projection`)
  }
}

function template_arity_contract(body: string): string {
  return slotContractKey(analyzeLatexTemplatePlaceholders(body))
}

const RETIRED_STYLE_FIELDS = [
  'tag', 'mode', 'separator', 'block_template_name',
  'variadic_left', 'variadic_join', 'variadic_right', 'react_renderer_key',
] as const
const CURRENT_STYLE_FIELDS = new Set(['style_name', 'tags', 'template'])
const LOCALIZED_TEMPLATE_FIELDS = new Set(['type', 'default_language', 'values'])

/** Validate an untrusted style before renderer-specific dispatch. */
export function assert_valid_style_template(style: SnlMacroStyle, dynamicArity?: boolean): void {
  const rawStyle = style as unknown as Record<string, unknown>
  if (RETIRED_STYLE_FIELDS.some((field) => field in rawStyle)) {
    throw new Error(`style "${style.style_name}" has retired template fields outside template`)
  }
  if (Object.keys(rawStyle).some((field) => !CURRENT_STYLE_FIELDS.has(field))) {
    throw new Error(`style "${style.style_name}" has fields outside the schema v11 Style boundary`)
  }
  const template = (style as { template: unknown }).template
  if (template && typeof template === 'object' && !Array.isArray(template) &&
      (template as Record<string, unknown>).type === 'i18n') {
    const localized = template as Record<string, unknown>
    const values = localized.values
    if (Object.keys(localized).some((field) => !LOCALIZED_TEMPLATE_FIELDS.has(field)) ||
        typeof localized.default_language !== 'string' ||
        !values || typeof values !== 'object' || Array.isArray(values) ||
        !Object.prototype.hasOwnProperty.call(values, localized.default_language)) {
      throw new Error(`style "${style.style_name}" has a malformed localized template`)
    }
    const arityContracts = new Set<string>()
    for (const value of Object.values(values as Record<string, unknown>)) {
      assert_valid_template_spec(value, style.style_name)
      const body = (value as SnlMacroTemplate).body
      arityContracts.add(template_arity_contract(body))
      if (dynamicArity !== undefined &&
          analyzeLatexTemplatePlaceholders(body).variadic !== dynamicArity) {
        throw new Error(`style "${style.style_name}" template variadic marker disagrees with macro arity`)
      }
    }
    if (arityContracts.size !== 1) {
      throw new Error(`style "${style.style_name}" has localized templates with inconsistent arity`)
    }
    return
  }
  assert_valid_template_spec(template, style.style_name)
  if (dynamicArity !== undefined &&
      analyzeLatexTemplatePlaceholders((template as SnlMacroTemplate).body).variadic !== dynamicArity) {
    throw new Error(`style "${style.style_name}" template variadic marker disagrees with macro arity`)
  }
}

/** Validate every Style; localized projections share a contract within each Style. */
export function assert_valid_macro_templates(macro: SnlMacro): void {
  for (const style of macro.styles) {
    assert_valid_style_template(style, macro.dynamic_arity)
  }
}

/** Read one validated complete template projection in the local language environment. */
export function read_style_template(
  style: SnlMacroStyle,
  dynamicArity?: boolean,
): ReaderM<LanguageEnvironment<string>, SnlMacroTemplate> {
  assert_valid_style_template(style, dynamicArity)
  const template = style.template
  if (!('type' in template)) return () => template as SnlMacroTemplate
  return read_localized(template as I18n<string, SnlMacroTemplate>)
}

/** Resolve one complete style template atomically at a renderer boundary. */
export function resolve_style_template(
  style: SnlMacroStyle,
  reader_runtime?: ReaderRuntime<LanguageEnvironment<string>>,
  language?: string,
  dynamicArity?: boolean,
): SnlMacroTemplate {
  const reader = read_style_template(style, dynamicArity)
  if (language !== undefined) return reader({ language })
  if (reader_runtime) return reader_runtime.run_reader(reader)
  return reader({ language: 'en' })
}

function current_language(
  reader_runtime?: ReaderRuntime<LanguageEnvironment<string>>,
): string {
  return reader_runtime?.query_environment().language ?? 'en'
}

/**
 * Auto-wrap a rendered node's latex in a single `\htmlData{name,kind[,style][,bindRef][,treePath]}`.
 * This is the sole place metadata enters the KaTeX output — templates never
 * write `\htmlData` themselves. Accepts resolved macro (or null) for the node.
 * Unclassified roots default to `partial`; unclassified descendants to `fvar`.
 */
export function wrapHtmlData(
  node: SnlSyntaxTree,
  inner: string,
  macro: SnlMacro | null,
  treePath?: TreePath,
  kindOverride?: string,
): string {
  const resolvedKind = kindOverride || resolveRenderedKind(node, macro, treePath?.length === 0)
  if (resolvedKind === 'sub') return inner
  const name = sanitizeHtmlDataAttr(node.macro_name)
  const kind = sanitizeHtmlDataAttr(resolvedKind)
  const ref = getBindRef(node)
  const bindRefFragment = ref ? `,bindRef=${sanitizeHtmlDataAttr(ref)}` : ''
  const srcVal = getSrc(node)
  const srcFragment = srcVal ? `,src=${sanitizeHtmlDataAttr(srcVal)}` : ''
  const sourcePath = getTreeSourcePath(node)
  const sourcePathFragment = sourcePath !== undefined
    ? `,source-path=${sanitizeHtmlDataAttr(sourcePath)}`
    : ''
  const scopeFragment = node.scope ? `,scope=${sanitizeHtmlDataAttr(node.scope)}` : ''
  const styleFragment = node.style_name ? `,style=${sanitizeHtmlDataAttr(node.style_name)}` : ''
  const pathFragment = treePath ? `,tree-path=${encodeTreePath(treePath)}` : ''
  return `\\htmlData{name=${name},kind=${kind}${styleFragment}${scopeFragment}${bindRefFragment}${srcFragment}${sourcePathFragment}${pathFragment}}{${inner}}`
}

function readBalancedBracedEnd(source: string, openAt: number): number {
  let depth = 0
  for (let i = openAt; i < source.length; i += 1) {
    if (source[i] === '\\') {
      i += 1
      continue
    }
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function makeUrlWrapperSafe(source: string): string | null {
  let escaped = ''
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '%') {
      let precedingBackslashes = 0
      for (let j = i - 1; j >= 0 && source[j] === '\\'; j -= 1) precedingBackslashes += 1
      if (precedingBackslashes === 0) escaped += '\\'
      else if (precedingBackslashes % 2 === 0) return null
    }
    escaped += source[i]
  }
  return escaped
}

interface OpaqueTexToken {
  readonly rawLength: number
  readonly rawSource: string
  readonly wrapperSafeSource: string | null
}

/** Read KaTeX constructs whose payload gives `%` literal semantics. */
function readOpaqueTexToken(source: string, start: number): OpaqueTexToken | null {
  if (source.startsWith('\\verb', start)) {
    let delimiterAt = start + '\\verb'.length
    if (source[delimiterAt] === '*') delimiterAt += 1
    const delimiter = source[delimiterAt]
    if (delimiter && !/\s/.test(delimiter)) {
      const closeAt = source.indexOf(delimiter, delimiterAt + 1)
      if (closeAt >= 0) {
        const raw = source.slice(start, closeAt + 1)
        return { rawLength: raw.length, rawSource: raw, wrapperSafeSource: raw }
      }
    }
  }

  for (const command of ['\\url', '\\href']) {
    if (!source.startsWith(command, start)) continue
    if (/[A-Za-z]/.test(source[start + command.length] ?? '')) continue
    let openAt = start + command.length
    while (/\s/.test(source[openAt] ?? '')) openAt += 1
    if (source[openAt] !== '{') continue
    const closeAt = readBalancedBracedEnd(source, openAt)
    if (closeAt >= 0) {
      const raw = source.slice(start, closeAt + 1)
      return {
        rawLength: raw.length,
        rawSource: raw,
        // A raw `%` is literal to KaTeX's URL parser, but becomes a comment
        // while the enclosing htmlData argument is tokenized. `\%` has the
        // same rendered URL/href and remains safe inside that outer argument.
        wrapperSafeSource: makeUrlWrapperSafe(raw),
      }
    }
  }
  return null
}

/** Wrap each top-level alignment segment without crossing `&` / `\\` boundaries. */
function wrapTopLevelAlignmentSegments(
  latex: string,
  wrap: (segment: string) => string,
): string {
  const segments: string[] = []
  const segmentWrappable: boolean[] = []
  const separators: string[] = []
  let current = ''
  let currentWrappable = true
  let braceDepth = 0
  let environmentDepth = 0
  for (let i = 0; i < latex.length; i += 1) {
    const char = latex[i]
    if (char === '%') {
      // TeX ignores every token through the next line break. Keep the source
      // verbatim for KaTeX, but do not let fake environments or separators in
      // the comment mutate scanner state. Escaped `\%` is consumed by the
      // backslash branch below and therefore never enters this branch.
      const commentToken = latex.slice(i).match(/^%[^\r\n]*(?:\r\n?|\n|$)/)?.[0] ?? '%'
      current += commentToken
      i += commentToken.length - 1
      continue
    }
    if (char === '\\') {
      const opaqueToken = readOpaqueTexToken(latex, i)
      if (opaqueToken) {
        if (opaqueToken.wrapperSafeSource == null) {
          current += opaqueToken.rawSource
          currentWrappable = false
        } else {
          current += opaqueToken.wrapperSafeSource
        }
        i += opaqueToken.rawLength - 1
        continue
      }
      const environmentToken = latex.slice(i).match(
        /^\\(begin|end)(?:(?:[ \t\r\n]+)|(?:%[^\r\n]*(?:\r\n?|\n)))*\{[^{}]+\}/,
      )?.[0]
      if (environmentToken) {
        current += environmentToken
        if (environmentToken.startsWith('\\begin')) environmentDepth += 1
        else environmentDepth = Math.max(0, environmentDepth - 1)
        i += environmentToken.length - 1
        continue
      }
      const next = latex[i + 1]
      if (next === '\\' && braceDepth === 0 && environmentDepth === 0) {
        segments.push(current)
        segmentWrappable.push(currentWrappable)
        separators.push('\\\\')
        current = ''
        currentWrappable = true
        i += 1
      } else {
        current += char
        if (next !== undefined) {
          current += next
          i += 1
        }
      }
      continue
    }
    if (char === '{') braceDepth += 1
    else if (char === '}') braceDepth = Math.max(0, braceDepth - 1)
    if (char === '&' && braceDepth === 0 && environmentDepth === 0) {
      segments.push(current)
      segmentWrappable.push(currentWrappable)
      separators.push('&')
      current = ''
      currentWrappable = true
    } else {
      current += char
    }
  }
  segments.push(current)
  segmentWrappable.push(currentWrappable)
  return segments.map((segment, index) => (
    segmentWrappable[index] ? wrap(segment) : `${wrap('')}${segment}`
  )).map((segment, index) => (
    index < separators.length ? `${segment}${separators[index]}` : segment
  )).join('')
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
  childMode: SnlMacroTemplate['mode'],
  parentMode: SnlMacroTemplate['mode'],
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
export function modeBucket(mode: SnlMacroTemplate['mode']): 'formula' | 'text' | 'block' {
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
export function nodeMode(
  node: SnlSyntaxTree,
  macro: SnlMacro | null,
  language = 'en',
): SnlMacroTemplate['mode'] {
  if (node.env_mode) return node.env_mode
  if (!macro) return 'formula_inline'
  try {
    return resolve_style_template(
      resolveStyle(node, macro, language), undefined, language, macro.dynamic_arity,
    ).mode
  } catch {
    return 'formula_inline'
  }
}

/**
 * ROOT-only display axis. In v3 the display axis is folded into the mode
 * itself: `formula_display` → block, everything else → inline. Nested
 * formula nodes' displays are ignored within a single render call.
 */
export function nodeDisplay(
  node: SnlSyntaxTree,
  macro: SnlMacro | null,
  language = 'en',
): 'inline' | 'block' {
  return nodeMode(node, macro, language) === 'formula_display' ? 'block' : 'inline'
}

export interface FormulaForeignPlan extends FormulaForeignResolution {
  readonly node: SnlSyntaxTree
  readonly template: SnlBlockMacroTemplate
  readonly treePath: TreePath
}

export interface FormulaForeignResolverOptions {
  readonly resolveBlock: (candidate: FormulaForeignCandidate) => Promise<FormulaForeignResolution | null>
}

export interface FormulaRenderPlan {
  readonly latex: string
  readonly foreignBoxes: readonly FormulaForeignPlan[]
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
  language?: string,
  formulaForeign?: FormulaForeignResolverOptions,
  foreignCollector?: FormulaForeignPlan[],
): Promise<string> {
  const sampled_language = language ?? current_language(reader_runtime)
  // An unfilled argument slot renders as the same numbered placeholder the
  // Create Macro preview uses, indexed by its position in the parent's
  // argument list. Cat 2026-07-25. It never reaches the macro backend —
  // there is no macro named ''.
  if (isEmptySnlSyntaxTreeNode(node)) {
    const slotIndex = treePath.length > 0 ? treePath[treePath.length - 1] : 0
    return wrapHtmlData(
      node,
      `\\mathord{\\htmlClass{snlArgPlaceholder}{${slotIndex}}}`,
      null,
      treePath,
    )
  }
  const macro = node.env_mode ? null : await driver.query_macro({ macro_name: node.macro_name, signal })
  const style = macro ? resolveStyle(node, macro, sampled_language) : undefined
  const resolvedTemplate = style
    ? resolve_style_template(style, reader_runtime, sampled_language, macro?.dynamic_arity)
    : undefined
  const hasDbMacro = Boolean(macro)

  const selfMode: SnlMacroTemplate['mode'] =
    node.env_mode ?? resolvedTemplate?.mode ?? 'formula_inline'
  const selfBucket = modeBucket(selfMode)

  // Each async child owns an isolated plan collector. Siblings may resolve out
  // of order, so sharing a mutable array here would let one block's rollback
  // splice plans already committed by another subtree.
  const childResults = await Promise.all(
    node.children.map(async (child, i) => {
      // A block owns its whole foreign subtree. Do not prepare nested block
      // capabilities only to discard them when the ancestor is rejected.
      const childCollector = foreignCollector && selfBucket !== 'block' ? [] as FormulaForeignPlan[] : undefined
      const latex = await resolveNodeLatex(
        child,
        driver,
        [...treePath, i],
        signal,
        reader_runtime,
        sampled_language,
        selfBucket === 'block' ? undefined : formulaForeign,
        childCollector,
      )
      return { latex, foreignBoxes: childCollector ?? [] }
    }),
  )
  const childRawList = childResults.map(result => result.latex)

  const wrappedChildren = await Promise.all(childRawList.map(async (latex, index) => {
    const child = node.children[index]
    let cMode: SnlMacroTemplate['mode'] = 'formula_inline'
    if (child?.env_mode) {
      cMode = child.env_mode
    } else {
      const childMacro = await driver.query_macro({ macro_name: child.macro_name, signal })
      if (childMacro) {
        try {
          cMode = resolve_style_template(
            resolveStyle(child, childMacro, sampled_language),
            reader_runtime,
            sampled_language,
            childMacro.dynamic_arity,
          ).mode
        } catch {
          cMode = 'formula_inline'
        }
      }
    }
    return wrapForParent(latex, cMode, selfMode)
  }))

  // A block descendant may enter formula layout only through an explicit,
  // consumer-owned capability resolved from its complete selected projection.
  if (selfBucket === 'block') {
    // Child marker plans are subtree-local and are intentionally discarded:
    // a block node's final marker/warning owns the complete selected subtree.
    if (formulaForeign && foreignCollector && resolvedTemplate?.mode === 'block') {
      const resolution = await formulaForeign.resolveBlock({
        node,
        template: resolvedTemplate,
        treePath,
        dynamicArity: macro?.dynamic_arity ?? false,
        signal,
      })
      if (resolution) {
        foreignCollector.push({ ...resolution, node, template: resolvedTemplate, treePath: [...treePath] })
        return wrapHtmlData(node, formulaForeignMarkerLatex(resolution.identity, resolution.metrics, resolution.accessibilityLabel), macro, treePath)
      }
    }
    const body =
      '\\text{\\color{red}\\{block macro `' +
      escapeLatexText(node.macro_name) +
      '` cannot be used inside a formula\\}}'
    return wrapHtmlData(node, body, macro, treePath)
  }

  // Merge only after every sibling has resolved, preserving tree/source order
  // regardless of async completion order.
  foreignCollector?.push(...childResults.flatMap(result => result.foreignBoxes))

  // Synthetic-macro path (delimited-name form).
  if (node.env_mode) {
    const isText = node.env_mode === 'text'
    const temporarySource = node.temporary_source ?? node.macro_name
    const templateBody = node.temporary_format === 'texttt'
      ? `\\texttt{${escapeLatexText(temporarySource)}}`
      : isText
        ? escapeTextButPreservePlaceholders(temporarySource)
        : temporarySource
    const childValues = Object.fromEntries(
      wrappedChildren.map((latex, index) => [`child${index}`, latex]),
    )
    const filled = fillLatexTemplate(
      templateBody,
      { ...childValues },
      isText ? 'text' : 'formula',
    )
    const body = isText ? `\\text{${filled}}` : filled
    return isText
      ? wrapHtmlData(node, body, macro, treePath)
      : wrapTopLevelAlignmentSegments(
        body,
        (segment) => wrapHtmlData(node, segment, macro, treePath),
      )
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

  const template = resolvedTemplate?.body ?? node.macro_name

  const childValues = Object.fromEntries(
    wrappedChildren.map((latex, index) => [`child${index}`, latex]),
  )
  const defaultSep = selfBucket === 'text' ? '' : ', '
  const separator = resolvedTemplate?.separator ?? defaultSep
  const children_joined = wrappedChildren.join(separator)

  // Dynamic-arity macro handling
  if (macro?.dynamic_arity) {
    // If template contains #*, fill it (this handles \\begin{pmatrix}#*\\end{pmatrix} etc.)
    if (template.includes('#*')) {
      const filled = fillLatexTemplate(
        template,
        { ...childValues, children_joined },
        selfBucket,
      )
      if (selfBucket === 'formula') {
        return wrapTopLevelAlignmentSegments(
          filled,
          (segment) => wrapHtmlData(node, segment, macro, treePath),
        )
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
  return selfBucket === 'formula'
    ? wrapTopLevelAlignmentSegments(
      filled,
      (segment) => wrapHtmlData(node, segment, macro, treePath),
    )
    : wrapHtmlData(node, filled, macro, treePath)
}

export async function resolveRootFormulaRender(
  root: SnlSyntaxTree,
  driver: MacroDataDriver,
  formulaForeign: FormulaForeignResolverOptions,
  signal?: AbortSignal,
  treePath: TreePath = [],
  reader_runtime?: ReaderRuntime<LanguageEnvironment<string>>,
  language?: string,
): Promise<FormulaRenderPlan> {
  const foreignBoxes: FormulaForeignPlan[] = []
  const sampled_language = language ?? current_language(reader_runtime)
  const latex = await resolveNodeLatex(
    root, driver, treePath, signal, reader_runtime, sampled_language,
    formulaForeign, foreignBoxes,
  )
  return Object.freeze({ latex, foreignBoxes: Object.freeze(foreignBoxes) })
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
  language?: string,
): Promise<string> {
  const sampled_language = language ?? current_language(reader_runtime)
  const raw = await resolveNodeLatex(
    root,
    driver,
    treePath,
    signal,
    reader_runtime,
    sampled_language,
  )
  const macro = root.env_mode ? null : await driver.query_macro({ macro_name: root.macro_name, signal })
  let rootMode: SnlMacroTemplate['mode'] = 'formula_inline'
  if (root.env_mode) {
    rootMode = root.env_mode
  } else if (macro) {
    try {
      rootMode = resolve_style_template(
        resolveStyle(root, macro, sampled_language),
        reader_runtime,
        sampled_language,
        macro.dynamic_arity,
      ).mode
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
