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
  DEFAULT_CONTEXT_READER,
  type I18n,
  type LanguageEnvironment,
  type Localized,
  type ReaderM,
  type ReaderRuntimeOptions,
  type ReaderRuntimeQueries,
  type ColorScheme,
  type ContextReader,
  type RenderContext,
} from '../runtime'

// === Core types ===
export type {
  SnlBlockMacroTemplate,
  SnlFormulaMacroTemplate,
  SnlMacro,
  SnlMacroRecord,
  SnlMacroStyle,
  SnlMacroSource,
  SnlMacroTemplate,
  SnlTextMacroTemplate,
} from '../snl-macro/types'
export type { SnlPostfix, SnlResolvedSource as SnlTreeResolvedSource, SnlSyntaxTree } from '../snl-syntax-tree/types'
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

// === Schema migrations ===
export {
  MACRO_SCHEMA_VERSION,
  PACKAGE_VERSION,
  TREE_SCHEMA_VERSION,
  isMacroDocumentV7,
  isMacroDocumentV8,
  isMacroDocumentV9,
  isMacroDocumentV10,
  isMacroDocumentV11,
  migrateMacroDocument,
  migrateMacroV6toV7,
  migrateMacroV7toV8,
  migrateMacroV7toV9,
  migrateMacroV9toV10,
  migrateMacroV10toV11,
  migrateMacroV8toV11,
  migrateStyleV6toV7,
  migrateSyntaxTreeDocument,
  migrateTreeNodeV1toV2,
  migrateTreeNodeV2toV3,
  isSyntaxTreeDocumentV2,
  isSyntaxTreeDocumentV3,
  type SyntaxTreeNodeV1,
  type SyntaxTreeNodeV2,
  type SyntaxTreeNodeV3,
  type MacroV6,
  type MacroV7,
  type MacroV8,
  type MacroV9,
  type MacroV10,
  type MacroV11,
  type MacroV8Style,
  type MacroStyleV6,
  type MacroStyleV7Base,
  type MacroV7ToV8Options,
  type MacroV7ToV9Options,
} from '../schema'

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
  resolveSnlSemantics,
  type SnlDiagnostic,
  type SnlSemanticResolution,
} from '../snl-syntax-tree/semantic-resolver'
export { isSnlIdentifier } from '../snl-syntax-tree/identifier'
export {
  analyzeSnlTreeSources,
  type SnlMacroSourceLookup,
  type SnlSourceMetrics,
} from '../snl-syntax-tree/source-metrics'
export {
  analyzeOrderedSlotIndices,
  createSlotContract,
  slotContractKey,
  type SnlSlotContract,
} from '../snl-syntax-tree/slot-contract'

// === Rendering ===
export { SnlSyntaxTreeView, type SnlSyntaxTreeViewProps } from '../components/SnlSyntaxTreeView'

// === Hooks & customization ===
export { defaultRenderHooks, defaultHighlightStrategy, defaultRenderers } from './hooks'
export {
  DEFAULT_SNL_ACTIVATION_CONTROLLER,
  SnlActivationController,
  type SnlActivationControllerOptions,
  type SnlActivationDispatch,
  type SnlActivationDispatcher,
  type SnlActivationHandler,
  type SnlActivationPhase,
} from './activation-controller'
export {
  DEFAULT_SNL_DEACTIVATION_CONTROLLER,
  SnlDeactivationController,
  type SnlActivationLease,
  type SnlActivationSnapshot,
  type SnlDeactivationControllerOptions,
  type SnlDeactivationDispatch,
  type SnlDeactivationHandler,
  type SnlDeactivationReason,
} from './deactivation-controller'
export {
  DEFAULT_HOVER_POPOVER_DISMISS_CONTROLLER,
  HoverPopoverDismissController,
  type HoverPopoverDismissControllerOptions,
  type HoverPopoverDismissDispatch,
  type HoverPopoverDismissReason,
  type HoverPopoverDismissRequest,
  type HoverPopoverDismissScope,
  type HoverPopoverDismissTarget,
} from './popover-dismiss-controller'
export { HTMLDATA_KATEX_DEFAULTS } from './katex-defaults'

// === Hover highlighting against already-rendered DOM ===
//
// `SnlSyntaxTreeView` drives hover through these. They are exported so a
// consumer that owns rendered SNL markup but NOT the React tree — the static
// HTML export in SNL-Doc-Extension is the motivating case — can reproduce the
// exact panel behaviour instead of reimplementing it. 猫猫 2026-07-29: "这应该
// 是 SNL-Basics 里就确定的行为，你到底有没有复用代码?" — it was hand-copied,
// and the copy drifted (missing `--snl-base-text-color`, so nested subtrees
// inside a hovered node never reverted to the base colour).
export {
  buildBvarScopeIndex,
  readBindingSourceKeyFromDom,
  type BvarScopeEntry,
} from '../snl-syntax-tree/bvar-scope-index'
export { findMinimalHoverRoot, findBinderScopeAncestor } from './hover-dom'
export { readBindRefFromDom, readSrcFromDom } from '../snl-syntax-tree/binding'
export {
  applySnlHoverHighlight,
  clearSnlHoverHighlight,
  SNL_BASE_TEXT_COLOR_VAR,
  SNL_HOVER_CLASS,
  type ApplySnlHoverHighlightOptions,
} from './hover-apply'
export {
  DEFAULT_KIND_PALETTE,
  alpha,
  paletteToCss,
  resolveKindColoring,
  assertSafeKindName,
  type KindColoring,
  type CompatibleKindColoring,
  type FlatKindColoring,
  type LegacyKindColoring,
  type KindColoringVariant,
  type ThemedKindColoring,
  type KindPalette,
} from './kind-palette'
export type {
  SnlRenderHooks,
  SnlHoverEvent,
  SnlHoverPhaseEvent,
  SnlHoverSession,
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
  type HoverPopoverBoundsPolicy,
  type HoverPopoverOrigin,
  type HoverPopoverOriginInput,
  type HoverPopoverOptions,
  type HoverPopoverOwner,
  type HoverPopoverProviderProps,
  type PopoverPhase,
  type ViewportBounds,
} from './hover-popovers'

// === Advanced / low-level (kept for downstream consumers) ===
export { analyzeLatexTemplatePlaceholders, fillLatexTemplate } from '../snl-syntax-tree/template'

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
export {
  bindSvgTemplateChildren,
  instantiateSvgTemplate,
  parseSanitizedSvgTemplate,
  type ParsedSvgTemplate,
  type ParseSanitizedSvgTemplateOptions,
  type SvgTemplateSlot,
} from './svg-template'
export {
  ReleasedSvgTemplateAssetError,
  StaleSvgTemplateAssetError,
  SvgTemplateAssetRegistry,
  type SvgTemplateAssetHandle,
  type SvgTemplateAssetIdentity,
  type SvgTemplateAssetLoader,
  type SvgTemplateAssetRegistryOptions,
  type SvgTemplateAssetResult,
} from './svg-template-asset-registry'
