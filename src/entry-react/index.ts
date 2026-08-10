/** Tree-shakeable `@sjtu-ai4math/snl-basics/entry` Entry rendering route. */
export {
  EntryDataDriver,
  read_entry_content,
  resolve_entry_content,
  type EntryContent,
  type ResolvedEntryContent,
  type EntryData,
  type EntryKind,
  type EntrySummary,
  type EntryQueryArgs,
  type EntryKindQueryArgs,
  type EntryDataQueries,
  type EntryDataDriverOptions,
} from './entry-data-driver'
export {
  EntrySurface,
  EntryView,
  EntryPreviewProvider,
  escapeForKatexText,
  titleToKatexSource,
  type EntryBlockInteractionContext,
  type EntryInteractionPorts,
  type EntrySurfaceProps,
  type EntryViewProps,
  type EntryPreviewProviderProps,
} from './entry-render'
export { MarkdownBody, type MarkdownBodyProps } from './markdown-body'
export { LatexBody, type LatexBodyProps } from './latex-body'
export { MacroDataDriver, type MacroDataDriverOptions, type MacroQueryArgs, type MacroDataQueries } from '../snl-macro/macro-data-driver'
export {
  SnlInteractionDriver,
  type SnlInteractionContext,
  type SnlInteractionDriverOptions,
  type InteractionCallback,
  type LeaveCallback,
  type TreePath,
} from '../snl-react-view/interaction-driver'
export type { SnlRenderHooks } from '../snl-react-view/hooks'
export {
  DEFAULT_SNL_DEACTIVATION_CONTROLLER,
  SnlDeactivationController,
  type SnlActivationLease,
  type SnlActivationSnapshot,
  type SnlDeactivationControllerOptions,
  type SnlDeactivationDispatch,
  type SnlDeactivationHandler,
  type SnlDeactivationReason,
} from '../snl-react-view/deactivation-controller'
export {
  DEFAULT_HOVER_POPOVER_DISMISS_CONTROLLER,
  HoverPopoverDismissController,
  type HoverPopoverDismissControllerOptions,
  type HoverPopoverDismissDispatch,
  type HoverPopoverDismissReason,
  type HoverPopoverDismissRequest,
  type HoverPopoverDismissScope,
  type HoverPopoverDismissTarget,
} from '../snl-react-view/popover-dismiss-controller'
export {
  resolveKindColoring,
  type KindColoring,
  type CompatibleKindColoring,
  type FlatKindColoring,
  type LegacyKindColoring,
  type KindColoringVariant,
  type ThemedKindColoring,
  type KindPalette,
} from '../snl-react-view/kind-palette'
export type { ColorScheme, ContextReader, RenderContext } from '../runtime'
export { extractExportedBinders, applyContextSource, resolveEntryContextSources } from './context-source'
