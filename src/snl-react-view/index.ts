/**
 * `@snl-basics/react` — Structured Natural Language (SNL) base library.
 *
 * Parse a macro DSL to syntax trees and render them to KaTeX-in-React with hover
 * interactions, plus Typst / LaTeX / Markdown / plain-text output backends.
 *
 * Styles: `import '@snl-basics/react/style.css'` and `import 'katex/dist/katex.min.css'`.
 */

// === Core types ===
export type { SnlMacro, SnlMacroDb, SnlMacroSource } from '../snl-macro/types'
export { bundledMacroDb, bundledSampleMacroDb } from '../snl-macro/bundled-db'
export type { SnlSyntaxTree } from '../snl-syntax-tree/types'
export { createSnlSyntaxTreeNode, isSnlSyntaxTree } from '../snl-syntax-tree/types'
export type {
  SnlSyntaxTreeBase,
  SnlSyntaxTreeMathNode,
  SnlSyntaxTreeTextNode,
  SnlSyntaxTreeBlockNode,
} from '../snl-syntax-tree/node-types'

// === Parser ===
export { parseSnlSyntaxTree, tryParseSnlSyntaxTree, SnlSyntaxTreeParseError } from './parse'
export { serializeSnlSyntaxTree } from './serialize'
export { annotateBindings } from '../snl-syntax-tree/annotate-bind'

// === DB loading & template query ===
export {
  loadSnlMacroDb,
  DEFAULT_SNL_MACRO_DB_URL,
  setSnlMacroDbCache,
  clearSnlMacroDbCache,
  createDefaultMacroTemplateQuery,
  createMacroTemplateQueryFromDb,
  type DefaultMacroTemplateQueryOptions,
} from './default-query'
export type { SnlMacroTemplateQuery, SnlMacroTemplateQueryArgs } from '../snl-syntax-tree/query'

// === Rendering ===
export { SnlSyntaxTreeView, type SnlSyntaxTreeViewProps } from '../components/SnlSyntaxTreeView'

// === Hooks & customization ===
export { defaultRenderHooks, defaultHighlightStrategy, defaultRenderers } from './hooks'
export { HTMLDATA_KATEX_DEFAULTS } from './katex-defaults'
export type {
  SnlRenderHooks,
  SnlHoverEvent,
  SnlMacroInfo,
  SnlResolvedSource,
  SnlTooltipState,
  SnlHighlightStrategy,
  SnlHighlightSet,
  SnlRendererRegistry,
  SnlBlockRenderer,
  SnlBlockRendererProps,
} from './hooks'

// === Output backends (Typst / LaTeX / Markdown / text) ===
export {
  toTypst,
  buildTypstPreamble,
  toLatex,
  buildLatexPreamble,
  toMarkdown,
  toText,
} from '../snl-output'
export type { TypstOutputOptions, LatexOutputOptions } from '../snl-output'

// === Advanced / low-level (kept for downstream consumers) ===
export { fillLatexTemplate } from '../snl-syntax-tree/template'

// === Optional demo editor (not part of the core library) ===
export { SnlSyntaxTreeEditor } from '../components/SnlSyntaxTreeEditor/SnlSyntaxTreeEditor'
