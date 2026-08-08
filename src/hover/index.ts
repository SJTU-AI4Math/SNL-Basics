/**
 * DOM-only hover highlighting, importable without the React views.
 *
 * `applySnlHoverHighlight` and friends touch nothing but the DOM, yet reaching
 * them through the package barrel drags in `SnlSyntaxTreeView` and with it
 * React and KaTeX. A consumer that owns already-rendered SNL markup and just
 * wants the panel's hover behaviour — the static HTML export in
 * SNL-Doc-Extension — would ship ~280 KB of unreachable code for a ~10 KB
 * feature.
 *
 * Same reasoning as the `./runtime` and `./core` subpath entries (Cat
 * 2026-07-25, panel startup cost); this one exists for 猫猫's 2026-07-29 report
 * that the export had hand-copied the hover policy instead of reusing it.
 */
export {
  applySnlHoverHighlight,
  clearSnlHoverHighlight,
  SNL_BASE_TEXT_COLOR_VAR,
  SNL_HOVER_CLASS,
  type ApplySnlHoverHighlightOptions,
} from '../snl-react-view/hover-apply'
export { defaultHighlightStrategy } from '../snl-react-view/hooks'
export type { SnlHighlightSet, SnlHighlightStrategy } from '../snl-react-view/hooks'
export { findMinimalHoverRoot, findBinderScopeAncestor } from '../snl-react-view/hover-dom'
export {
  buildBvarScopeIndex,
  readBindingSourceKeyFromDom,
  type BvarScopeEntry,
} from '../snl-syntax-tree/bvar-scope-index'
export { readBindRefFromDom, readSrcFromDom } from '../snl-syntax-tree/binding'
