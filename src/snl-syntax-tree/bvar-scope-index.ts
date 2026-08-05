import { readBindRefFromDom } from './binding'

/** 与 annotate-bind 的 bindRef 一致：每个 binder scope 对应一块作用域，域内同 ref 的 bvar/binder 节点 */
export interface BvarScopeEntry {
  /** 该 bindRef 的最小 binder-scope 子树根 */
  scopeRoot: HTMLElement
  bvars: HTMLElement[]
  binders: HTMLElement[]
}

/**
 * KaTeX 注入 innerHTML 后调用：为每个 bindRef 选择能包含其全部 binder/bvar
 * 节点的最小 data-scope="binder" 根。嵌套 scope 可共享 ref，也可拥有不同 ref。
 */
export function buildBvarScopeIndex(container: HTMLElement): Map<string, BvarScopeEntry> {
  const map = new Map<string, BvarScopeEntry>()
  const scopeRoots = Array.from(
    container.querySelectorAll<HTMLElement>('[data-scope="binder"]'),
  )
  const allBinders = Array.from(container.querySelectorAll<HTMLElement>('[data-kind="binder"]'))
  const allBvars = Array.from(container.querySelectorAll<HTMLElement>('[data-kind="bvar"]'))
  const refs = new Set<string>()
  for (const element of [...scopeRoots, ...allBinders, ...allBvars]) {
    const ref = readBindRefFromDom(element)
    if (ref) refs.add(ref)
  }

  for (const ref of refs) {
    const binders = allBinders.filter((element) => readBindRefFromDom(element) === ref)
    const bvars = allBvars.filter((element) => readBindRefFromDom(element) === ref)
    const members = [...binders, ...bvars]
    const candidates = scopeRoots.filter((root) =>
      members.length > 0
        ? members.every((member) => root.contains(member))
        : readBindRefFromDom(root) === ref,
    )
    // Any two candidates containing all members are nested in a valid syntax
    // tree. Choose the deepest one, i.e. the minimal containing scope.
    const scopeRoot = candidates.find((candidate) =>
      !candidates.some((other) => other !== candidate && candidate.contains(other)),
    )
    if (scopeRoot) map.set(ref, { scopeRoot, bvars, binders })
  }
  return map
}
