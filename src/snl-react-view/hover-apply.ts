/**
 * Applying a hover highlight to already-rendered SNL DOM.
 *
 * `SnlSyntaxTreeView` owns the React tree and drives hover from pointer events;
 * this module owns what happens AFTER a target is chosen — computing the
 * highlight set and putting the classes on. It is deliberately React-free and
 * DOM-only so a consumer holding nothing but rendered markup (the static HTML
 * export in SNL-Doc-Extension) gets identical behaviour by calling the same
 * function, rather than reimplementing the policy.
 *
 * 猫猫 2026-07-29: "这应该是 SNL-Basics 里就确定的行为，你到底有没有复用代码?"
 * The export had hand-copied this logic and the copy drifted: it never set
 * `--snl-base-text-color`, so `.snl-single-hover [data-kind] { color: var(...) }`
 * resolved to an empty value and nested subtrees inside a hovered node failed
 * to keep their base colour.
 */
import type { SnlHighlightSet, SnlHighlightStrategy } from './hooks'
import { defaultHighlightStrategy } from './hooks'
import { buildBvarScopeIndex, type BvarScopeEntry } from '../snl-syntax-tree/bvar-scope-index'

/** CSS custom property holding the container's pre-hover computed text colour. */
export const SNL_BASE_TEXT_COLOR_VAR = '--snl-base-text-color'

/** The three classes a hover interaction applies. */
export const SNL_HOVER_CLASS = {
  singleHover: 'snl-single-hover',
  bvarScope: 'snl-bvar-scope',
  binderDecl: 'snl-binder-decl',
} as const

const ALL_HOVER_CLASSES = [
  SNL_HOVER_CLASS.singleHover,
  SNL_HOVER_CLASS.bvarScope,
  SNL_HOVER_CLASS.binderDecl,
]

/**
 * Remove every hover mark inside `container`.
 *
 * Queries rather than replaying a remembered list, so it is correct even when
 * called against DOM this module never marked (e.g. after a re-render).
 */
export function clearSnlHoverHighlight(container: HTMLElement): void {
  const selector = ALL_HOVER_CLASSES.map((c) => `.${c}`).join(',')
  for (const el of Array.from(container.querySelectorAll<HTMLElement>(selector))) {
    el.classList.remove(...ALL_HOVER_CLASSES)
  }
}

export interface ApplySnlHoverHighlightOptions {
  /** Override the highlight policy. Defaults to {@link defaultHighlightStrategy}. */
  strategy?: SnlHighlightStrategy
  /**
   * Prebuilt `bindRef -> scope` index. Omit to build one from the container on
   * the fly — correct but O(n) per call, so long-lived callers should cache it
   * and pass it in (that is what `SnlSyntaxTreeView` does).
   */
  bvarScopeIndex?: Map<string, BvarScopeEntry>
  phase?: 0 | 1 | 2
}

/**
 * Clear existing marks, compute the highlight set for `target`, and apply it to
 * every rendered fragment of that semantic node.
 *
 * Also captures the container's computed text colour into
 * {@link SNL_BASE_TEXT_COLOR_VAR} BEFORE marking. The stylesheet uses it to
 * keep nested `[data-kind]` subtrees at the base colour inside a hovered node;
 * without it that rule resolves to nothing and the whole hovered subtree takes
 * the highlight colour. Capturing after marking would read the highlight
 * colour instead, so ordering here is load-bearing.
 *
 * @returns the set that was applied, for callers that need to inspect it.
 */
export function applySnlHoverHighlight(
  target: HTMLElement,
  container: HTMLElement,
  options: ApplySnlHoverHighlightOptions = {},
): SnlHighlightSet {
  clearSnlHoverHighlight(container)

  const view = container.ownerDocument?.defaultView
  const baseTextColor = view ? view.getComputedStyle(container).color : ''
  if (baseTextColor) {
    container.style.setProperty(SNL_BASE_TEXT_COLOR_VAR, baseTextColor)
  }

  const strategy = options.strategy ?? defaultHighlightStrategy
  const index = options.bvarScopeIndex ?? buildBvarScopeIndex(container)
  const set = strategy.computeHighlightSet(target, container, index, options.phase)

  const singleHoverFragments = set.singleHoverFragments
    ?? (set.singleHover ? [set.singleHover] : [])
  for (const fragment of singleHoverFragments) {
    fragment.classList.add(SNL_HOVER_CLASS.singleHover)
  }
  for (const el of set.bvarScope) {
    el.classList.add(SNL_HOVER_CLASS.bvarScope)
  }
  for (const el of set.binderDecl) {
    el.classList.add(SNL_HOVER_CLASS.binderDecl)
  }
  return set
}
