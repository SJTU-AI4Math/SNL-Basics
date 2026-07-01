/**
 * Internal DOM traversal helpers for hover highlighting. NOT part of the public
 * API — used by {@link defaultHighlightStrategy} and `SnlSyntaxTreeView`.
 *
 * @internal
 */
import { readBindRefFromDom } from '../snl-syntax-tree/binding'

/**
 * True only when the path from `el` up to (but excluding) `root` does not cross
 * another `constantSubtree` layer — i.e. `el` belongs to this operator "skin"
 * and not to a nested inner subtree.
 * @internal
 */
export function isDirectConstSymbolUnderContantSubtreeRoot(
  el: HTMLElement,
  root: HTMLElement,
): boolean {
  if (!root.contains(el)) {
    return false
  }
  let cur: HTMLElement | null = el.parentElement
  while (cur !== null && cur !== root) {
    if (cur.dataset.kind === 'constantSubtree') {
      return false
    }
    cur = cur.parentElement
  }
  return cur === root
}

/**
 * Collect the operator-skin `constSymbol` / `constFence` elements that belong
 * directly to a `constantSubtree` root (not to nested inner subtrees).
 * @internal
 */
export function collectDirectConstSymbols(root: HTMLElement): HTMLElement[] {
  const out = new Set<HTMLElement>()

  // 量词：∀ / ∃ 与 binder–body 间逗号在 KaTeX 里是 binderScope 的直接子 constSymbol（与体内 implies 等子树并列）
  for (const bs of root.querySelectorAll<HTMLElement>('[data-kind="binderScope"]')) {
    if (!root.contains(bs)) {
      continue
    }
    const closestCt = bs.closest<HTMLElement>('[data-kind="constantSubtree"]')
    if (closestCt !== root) {
      continue
    }
    for (const child of bs.children) {
      if (child instanceof HTMLElement && child.dataset.kind === 'constSymbol') {
        out.add(child)
      }
    }
  }

  for (const el of root.querySelectorAll<HTMLElement>(
    '[data-kind="constSymbol"],[data-kind="constFence"]',
  )) {
    if (out.has(el)) {
      continue
    }
    if (isDirectConstSymbolUnderContantSubtreeRoot(el, root)) {
      out.add(el)
    }
  }
  return [...out]
}

/**
 * Walk up from `start` to find the nearest `binderScope` ancestor carrying the
 * given `bindRef`.
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

/** @internal */
const HOVER_LEAF_KINDS = new Set(['bvar', 'binder', 'fvar'])

/**
 * From the pointer element, walk up to the minimal semantic hover root.
 * Priority: variable leaf (binder/bvar/fvar) > constantSubtree >
 * const/constSymbol/constFence. Single pass to avoid three separate walks.
 * @internal
 */
export function findMinimalHoverRoot(start: HTMLElement, container: HTMLElement): HTMLElement {
  let leaf: HTMLElement | null = null
  let subtree: HTMLElement | null = null
  let constEl: HTMLElement | null = null
  let cur: HTMLElement | null = start
  while (cur && container.contains(cur)) {
    if (cur.hasAttribute('data-name')) {
      const k = cur.dataset.kind ?? ''
      if (HOVER_LEAF_KINDS.has(k) && !leaf) {
        leaf = cur
      }
      if (k === 'constantSubtree' && !subtree) {
        subtree = cur
      }
      if ((k === 'const' || k === 'constSymbol' || k === 'constFence') && !constEl) {
        constEl = cur
      }
    }
    cur = cur.parentElement
  }
  return leaf ?? subtree ?? constEl ?? start
}
