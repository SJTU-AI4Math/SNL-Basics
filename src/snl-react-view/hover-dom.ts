/**
 * Internal DOM traversal helpers for hover highlighting. NOT part of the public
 * API — used by {@link defaultHighlightStrategy} and `SnlSyntaxTreeView`.
 *
 * @internal
 */
import { readBindRefFromDom } from '../snl-syntax-tree/binding'

/**
 * Walk up from `start` to find the nearest binder-scope ancestor (a quantifier node marked
 * data-kind="binderScope" by annotate-bind) carrying the given `bindRef`.
 * @internal
 */
export function findBinderScopeAncestor(
  start: HTMLElement,
  container: HTMLElement,
  bindRef: string,
): HTMLElement | null {
  let el: HTMLElement | null = start
  while (el && container.contains(el)) {
    if (el.dataset.kind === 'binderScope' && readBindRefFromDom(el) === bindRef) {
      return el
    }
    el = el.parentElement
  }
  return null
}

/**
 * From the pointer element, walk up to the minimal semantic hover root: the
 * first ancestor (inclusive) carrying a `data-name`. Post-bracket-syntax there
 * is a single kind per node, so no priority lookup is needed.
 * @internal
 */
export function findMinimalHoverRoot(start: HTMLElement, container: HTMLElement): HTMLElement {
  let cur: HTMLElement | null = start
  while (cur && container.contains(cur)) {
    if (cur.hasAttribute('data-name')) {
      return cur
    }
    cur = cur.parentElement
  }
  return start
}
