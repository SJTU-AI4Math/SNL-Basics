/**
 * DOM traversal helpers shared by hover highlighting consumers. These are
 * public through the lean `./hover` entry as well as the root package.
 */
import { readBindRefFromDom } from '../snl-syntax-tree/binding'

/**
 * Walk up from `start` to find the nearest binder-scope ancestor (a quantifier node marked
 * data-scope="binder" by annotate-bind) carrying the given `bindRef`.
 */
export function findBinderScopeAncestor(
  start: HTMLElement,
  container: HTMLElement,
  bindRef: string,
): HTMLElement | null {
  let el: HTMLElement | null = start
  while (el && container.contains(el)) {
    if (el.dataset.scope === 'binder' && readBindRefFromDom(el) === bindRef) {
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
 *
 * `kind="partial"` nodes are TRANSPARENT for hover purposes — they represent
 * subtrees that are not complete syntactic nodes (e.g. matrix rows / cells)
 * and should not attract hover feedback themselves. Walk past them to find
 * the nearest non-partial ancestor. (Fulcrum 2026-07-04.)
 *
 */
export function findMinimalHoverRoot(start: HTMLElement, container: HTMLElement): HTMLElement {
  let cur: HTMLElement | null = start
  while (cur && container.contains(cur)) {
    if (cur.hasAttribute('data-name') && cur.dataset.kind !== 'partial') {
      return cur
    }
    cur = cur.parentElement
  }
  return start
}
