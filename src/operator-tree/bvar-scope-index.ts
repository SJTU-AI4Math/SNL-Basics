import { readBindRefFromDom } from './binding'

/** 与 annotate-bind 的 bindRef 一致：每个 binderScope 对应一块作用域，域内同 ref 的 bvar/binder 节点 */
export interface BvarScopeEntry {
  /** 该 bindRef 的最小 binderScope 子树根 */
  scopeRoot: HTMLElement
  bvars: HTMLElement[]
  binders: HTMLElement[]
}

/**
 * KaTeX 注入 innerHTML 后调用：按 binderScope 划分，只收录各 scope 内的 bvar/binder（嵌套量词不会串 ref）。
 * bindRef 在 DOM 上为 data-bindRef，不能用 [data-bind-ref] 选择器。
 */
export function buildBvarScopeIndex(container: HTMLElement): Map<string, BvarScopeEntry> {
  const map = new Map<string, BvarScopeEntry>()
  for (const scopeRoot of container.querySelectorAll<HTMLElement>('[data-kind="binderScope"]')) {
    const ref = readBindRefFromDom(scopeRoot)
    if (!ref) {
      continue
    }
    const bvars = Array.from(scopeRoot.querySelectorAll<HTMLElement>('[data-kind="bvar"]')).filter(
      (el) => readBindRefFromDom(el) === ref,
    )
    const binders = Array.from(scopeRoot.querySelectorAll<HTMLElement>('[data-kind="binder"]')).filter(
      (el) => readBindRefFromDom(el) === ref,
    )
    map.set(ref, { scopeRoot, bvars, binders })
  }
  return map
}
