/**
 * The default hover-highlight policy, in its own React-free module.
 *
 * It used to live in `hooks.tsx`, which also imports the block renderers and
 * therefore React. Anything reaching for the policy alone — the DOM-only
 * `hover-apply`, and through it the static HTML export in SNL-Doc-Extension —
 * pulled the whole React tree along with it. Splitting the file lets the
 * `./hover` subpath entry stay small; `hooks.tsx` re-exports from here so its
 * public surface is unchanged.
 */
import { buildBvarScopeIndex, type BvarScopeEntry } from '../snl-syntax-tree/bvar-scope-index'
import { readBindRefFromDom } from '../snl-syntax-tree/binding'

/**
 * The set of DOM elements a hover interaction should decorate. The view applies
 * one CSS class per bucket, uniformly:
 *   singleHover → `.snl-single-hover`, bvarScope → `.snl-bvar-scope`,
 *   binderDecl → `.snl-binder-decl`.
 *
 * `singleHover` is the element directly under the pointer (the minimal hover
 * root); CSS colors all TEXT inside it via inheritance, so nested subtrees no
 * longer need their own bulk-highlight classes.
 */
export interface SnlHighlightSet {
  /** Gets `.snl-single-hover` — the one element directly under the pointer. */
  singleHover: HTMLElement | null
  /** Gets `.snl-bvar-scope` — bound-variable occurrences in scope. */
  bvarScope: HTMLElement[]
  /** Gets `.snl-binder-decl` — binder declaration sites. */
  binderDecl: HTMLElement[]
}

/**
 * Pluggable hover-highlight policy. Given the pointer target, the render
 * container, and the current bvar-scope index, compute which elements light up.
 * Override to change highlight behavior without touching class application.
 */
export interface SnlHighlightStrategy {
  /**
   * @param target - the semantic element under the pointer (already resolved to
   *   its minimal hover root by the view).
   * @param container - the render root that owns the KaTeX/React output.
   * @param bvarScopeIndex - `bindRef → { bvars, binders }` built from the DOM.
   * @returns the buckets of elements to decorate.
   */
  computeHighlightSet(
    target: HTMLElement,
    container: HTMLElement,
    bvarScopeIndex: Map<string, BvarScopeEntry>,
  ): SnlHighlightSet
}

/**
 * Default highlight policy. Colour is scoped by subtree:
 * `singleHover` (the element under the pointer) gets `.snl-single-hover`, and
 * CSS turns all TEXT inside it a highlight colour via inheritance — a deeper
 * subtree wins when it becomes the pointer target. Binder/bvar hovers also
 * light up the whole binding scope (`.snl-bvar-scope` / `.snl-binder-decl`),
 * the one interaction that spans siblings rather than nested ancestors.
 */
export const defaultHighlightStrategy: SnlHighlightStrategy = {
  computeHighlightSet(target, container, bvarScopeIndex) {
    const kind = target.dataset.kind ?? ''
    const bindRef = readBindRefFromDom(target)

    const bvarScope: HTMLElement[] = []
    const binderDecl: HTMLElement[] = []
    // The pointer target IS the minimal hover root (resolved by the view); its
    // text colours via inheritance, so no bulk `hovered` set is needed.
    const singleHover: HTMLElement | null = target

    if ((kind === 'bvar' || kind === 'binder') && bindRef) {
      const cachedEntry = bvarScopeIndex.get(bindRef)
      const targetIsIndexed = kind === 'bvar'
        ? cachedEntry?.bvars.includes(target)
        : cachedEntry?.binders.includes(target)
      // A supplied cache can predate async MathSpan descendants. Rebuild only
      // when it cannot account for the current target; never fall back to the
      // scope root's single scalar data-bindref, which represents only b1 in a
      // multi-binder scope.
      const entry = targetIsIndexed
        ? cachedEntry
        : buildBvarScopeIndex(container).get(bindRef)
      let bvars: HTMLElement[]
      let binders: HTMLElement[]
      if (entry) {
        bvars = entry.bvars
        binders = entry.binders
      } else {
        bvars = []
        binders = []
      }
      for (const el of bvars) {
        bvarScope.push(el)
      }
      for (const el of binders) {
        binderDecl.push(el)
      }
    }

    return { singleHover, bvarScope, binderDecl }
  },
}
