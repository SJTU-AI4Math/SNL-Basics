import { readBindRefFromDom } from './binding'

export interface BvarScopeEntry {
  /** Canonical source subtree (legacy name retained for API compatibility). */
  scopeRoot: HTMLElement
  bvars: HTMLElement[]
  binders: HTMLElement[]
}

/** Canonical local source key. No allocated binder ID exists. */
export function readBindingSourceKeyFromDom(element: HTMLElement): string {
  const kind = element.dataset.kind ?? ''
  if (kind === 'bvar' && element.dataset.sourcePath !== undefined) {
    return `#${element.dataset.sourcePath}`
  }
  if (kind === 'binder' && element.dataset.treePath !== undefined) {
    return `#${element.dataset.treePath}`
  }
  return readBindRefFromDom(element)
}

/** Build source-tree-path → source subtree + all bvar references. */
export function buildBvarScopeIndex(container: HTMLElement): Map<string, BvarScopeEntry> {
  const map = new Map<string, BvarScopeEntry>()
  const allBinders = Array.from(container.querySelectorAll<HTMLElement>('[data-kind="binder"]'))
  const allBvars = Array.from(container.querySelectorAll<HTMLElement>('[data-kind="bvar"]'))

  const sourcePaths = new Set(
    allBvars
      .map((element) => element.dataset.sourcePath)
      .filter((value): value is string => value !== undefined),
  )
  for (const sourcePath of sourcePaths) {
    const source = Array.from(container.querySelectorAll<HTMLElement>('[data-tree-path]'))
      .find((element) => element.dataset.treePath === sourcePath)
    if (!source) continue
    const bvars = allBvars.filter((element) => element.dataset.sourcePath === sourcePath)
    const binders = source.dataset.kind === 'binder' ? [source] : []
    map.set(`#${sourcePath}`, { scopeRoot: source, bvars, binders })
  }

  // Tree2 compatibility only. Tree3 never allocates bindRef.
  const scopeRoots = Array.from(container.querySelectorAll<HTMLElement>('[data-scope="binder"]'))
  const refs = new Set<string>()
  for (const element of [...scopeRoots, ...allBinders, ...allBvars]) {
    const ref = readBindRefFromDom(element)
    if (ref) refs.add(ref)
  }
  for (const ref of refs) {
    if (map.has(ref)) continue
    const binders = allBinders.filter((element) => readBindRefFromDom(element) === ref)
    const bvars = allBvars.filter((element) => readBindRefFromDom(element) === ref)
    const members = [...binders, ...bvars]
    const candidates = scopeRoots.filter((root) =>
      members.length > 0
        ? members.every((member) => root.contains(member))
        : readBindRefFromDom(root) === ref,
    )
    const scopeRoot = candidates.find((candidate) =>
      !candidates.some((other) => other !== candidate && candidate.contains(other)),
    )
    if (scopeRoot) map.set(ref, { scopeRoot, bvars, binders })
  }
  return map
}
