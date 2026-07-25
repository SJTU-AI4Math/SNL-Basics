/**
 * `@sjtu-ai4math/snl-basics` — Structured Natural Language (SNL) base library.
 *
 * Parse a macro DSL to syntax trees and render them to KaTeX-in-React with hover
 * interactions. v0.10.0: single MacroDataDriver backend, injectable interaction.
 *
 * Styles: `import '@sjtu-ai4math/snl-basics/style.css'` and `import 'katex/dist/katex.min.css'`.
 */

// === Runtime environment / ReaderM ===
export {
  ReaderRuntime,
  flat_map_reader,
  is_i18n,
  map_reader,
  pure_reader,
  read_localized,
  write_localized,
  type I18n,
  type LanguageEnvironment,
  type Localized,
  type ReaderM,
  type ReaderRuntimeOptions,
  type ReaderRuntimeQueries,
} from '../runtime'

// === Core types ===
export type {
  SnlInvariantMacroStyle,
  SnlMacro,
  SnlMacroStyle,
  SnlMacroSource,
  SnlTextMacroStyle,
} from '../snl-macro/types'
export type { SnlSyntaxTree } from '../snl-syntax-tree/types'
export {
  createEmptySnlSyntaxTreeNode,
  createSnlSyntaxTreeNode,
  isEmptySnlSyntaxTreeNode,
  isSnlSyntaxTree,
} from '../snl-syntax-tree/types'
export type {
  SnlSyntaxTreeBase,
  SnlSyntaxTreeFormulaNode,
  SnlSyntaxTreeTextNode,
  SnlSyntaxTreeBlockNode,
} from '../snl-syntax-tree/node-types'

// === MacroDataDriver (the single macro data source) ===
export {
  MacroDataDriver,
  type MacroDataQueries,
  type MacroDataDriverOptions,
  type MacroQueryArgs,
} from '../snl-macro/macro-data-driver'

// === InteractionDriver ===
export {
  SnlInteractionDriver,
  encodeTreePath,
  decodeTreePath,
  resolveTreePath,
  type SnlInteractionDriverOptions,
  type SnlInteractionContext,
  type InteractionCallback,
  type LeaveCallback,
  type TreePath,
} from './interaction-driver'

// === Parser / formatter ===
export { parseSnlSyntaxTree, tryParseSnlSyntaxTree, SnlSyntaxTreeParseError } from './parse'
export { serializeSnlSyntaxTree } from './serialize'
export { SnlDslFormatter } from '../snl-syntax-tree/formatter'
export { annotateBindings } from '../snl-syntax-tree/annotate-bind'
export {
  analyzeSnlTreeSources,
  type SnlMacroSourceLookup,
  type SnlSourceMetrics,
} from '../snl-syntax-tree/source-metrics'

// === Rendering ===
export { SnlSyntaxTreeView, type SnlSyntaxTreeViewProps } from '../components/SnlSyntaxTreeView'

// === Hooks & customization ===
export { defaultRenderHooks, defaultHighlightStrategy, defaultRenderers } from './hooks'
export { HTMLDATA_KATEX_DEFAULTS } from './katex-defaults'
export {
  DEFAULT_KIND_PALETTE,
  alpha,
  paletteToCss,
  assertSafeKindName,
  type KindColoring,
  type KindPalette,
} from './kind-palette'
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
export {
  HoverPopoverProvider,
  clampPopoverPosition,
  collectPopoverSubtree,
  expandPopoverAncestors,
  findPopoverBounds,
  useCurrentPopoverId,
  useHoverPopovers,
  type HoverPopover,
  type HoverPopoverApi,
  type HoverPopoverOptions,
  type HoverPopoverProviderProps,
  type PopoverPhase,
  type ViewportBounds,
} from './hover-popovers'

// === Advanced / low-level (kept for downstream consumers) ===
export { fillLatexTemplate } from '../snl-syntax-tree/template'

export {
  modeBucket,
  nodeDisplay,
  nodeMode,
  read_style_template,
  resolveNodeLatex,
  resolveRootLatex,
  resolveStyle,
  resolve_style_template,
  sanitizeHtmlDataAttr,
  wrapForParent,
  wrapHtmlData,
} from './render-source'
