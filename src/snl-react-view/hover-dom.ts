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
 * `kind="sub"` nodes are TRANSPARENT for hover purposes — they represent
 * subtrees that are not complete syntactic nodes (e.g. matrix rows / cells)
 * and should not attract hover feedback themselves. Walk past them to find
 * the nearest non-sub ancestor. (Fulcrum 2026-07-04.)
 *
 */
export function findMinimalHoverRoot(start: HTMLElement, container: HTMLElement): HTMLElement {
  let cur: HTMLElement | null = start
  while (cur && container.contains(cur)) {
    if (cur.hasAttribute('data-name') && cur.dataset.kind !== 'sub') {
      return cur
    }
    cur = cur.parentElement
  }
  return start
}

/**
 * Resolve a semantic target from the complete front-to-back hit stack.
 *
 * KaTeX vlist descendants can escape the line box of their semantic wrapper.
 * At those coordinates an outer layout primitive may be the topmost hit even
 * though a later hit belongs to a deeper semantic child. Looking only at the
 * first element therefore promotes the pointer to the parent. Prefer the
 * deepest eligible semantic descendant represented anywhere in the hit stack;
 * preserve front-to-back order for unrelated branches.
 */
export interface HoverStackResolution {
  root: HTMLElement
  /** Exact stack member whose ancestry yielded `root`; used for control ownership. */
  hit: Element
}

export function resolveDeepestHoverHitFromStack(
  stack: Iterable<Element>,
  container: HTMLElement,
): HoverStackResolution | null {
  let best: HTMLElement | null = null
  let bestHit: Element | null = null

  const pathOf = (element: HTMLElement): string[] | null => {
    const raw = element.getAttribute('data-tree-path')
    if (raw === null) return null
    if (raw === '') return []
    const parts = raw.split('.')
    return parts.every((part) => /^(0|[1-9]\d*)$/.test(part)) ? parts : null
  }
  const isStrictDescendantPath = (ancestor: string[] | null, descendant: string[] | null): boolean =>
    ancestor !== null && descendant !== null && descendant.length > ancestor.length &&
    ancestor.every((part, index) => descendant[index] === part)

  for (const element of stack) {
    if (!container.contains(element)) continue
    const start = element instanceof HTMLElement ? element : element.parentElement
    if (!start) continue
    const candidate = findMinimalHoverRoot(start, container)
    if (!candidate.hasAttribute('data-name') || candidate.dataset.kind === 'sub') continue

    if (
      best === null ||
      (best !== candidate && best.contains(candidate)) ||
      (!candidate.contains(best) && isStrictDescendantPath(pathOf(best), pathOf(candidate)))
    ) {
      best = candidate
      bestHit = element
    }
  }

  return best && bestHit ? { root: best, hit: bestHit } : null
}

export function findDeepestHoverRootFromStack(
  stack: Iterable<Element>,
  container: HTMLElement,
): HTMLElement | null {
  return resolveDeepestHoverHitFromStack(stack, container)?.root ?? null
}

export interface SemanticHighlightRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/** Measure the complete rendered subtree rather than KaTeX's undersized inline wrapper. */
export function measureSemanticHighlightRect(target: HTMLElement): SemanticHighlightRect | null {
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  const elements = [target, ...Array.from(target.querySelectorAll<HTMLElement>('*'))]

  for (const element of elements) {
    for (const rect of Array.from(element.getClientRects())) {
      if (rect.width <= 0 || rect.height <= 0) continue
      left = Math.min(left, rect.left)
      top = Math.min(top, rect.top)
      right = Math.max(right, rect.right)
      bottom = Math.max(bottom, rect.bottom)
    }
  }

  if (!Number.isFinite(left) || !Number.isFinite(top) || right <= left || bottom <= top) return null
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}
