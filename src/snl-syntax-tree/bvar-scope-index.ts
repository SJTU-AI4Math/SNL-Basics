import { readBindRefFromDom } from './binding'

export interface BvarScopeEntry {
  /** Canonical source subtree (legacy name retained for API compatibility). */
  scopeRoot: HTMLElement
  bvars: HTMLElement[]
  binders: HTMLElement[]
  /** Members may live in other render roots (page-wide binder ids): never reuse a cached copy. */
  crossTree?: boolean
}

/** Canonical local source key. No allocated binder ID exists. */
export function readBindingSourceKeyFromDom(element: HTMLElement): string {
  const kind = element.dataset.kind ?? ''
  // Page-wide binder identity (`@x@##id` / `x@##id`) wins over tree positions.
  if (kind === 'bvar' && element.dataset.sourceId) return `@${element.dataset.sourceId}`
  if (kind === 'binder' && element.dataset.binderId) return `@${element.dataset.binderId}`
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

  // Page-wide binder ids: the binder and its uses may sit in different render
  // roots (context rows, goals, side panels), so they are looked up in the
  // whole document. A binder's in-tree uses (by tree path) belong to the same
  // entry, and that binder's `#path` key shares it.
  const ids = new Set<string>()
  for (const element of container.querySelectorAll<HTMLElement>('[data-binder-id], [data-source-id]')) {
    const id = element.dataset.binderId || element.dataset.sourceId
    if (id) ids.add(id)
  }
  for (const id of ids) {
    const entry = elementIdEntry(container, id)
    if (!entry) continue
    map.set(`@${id}`, entry)
    for (const binder of entry.binders) {
      if (container.contains(binder) && binder.dataset.treePath !== undefined) {
        map.set(`#${binder.dataset.treePath}`, { ...entry, scopeRoot: binder })
      }
    }
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

/** All instances of the binder with page-wide `id`, and all of its uses, anywhere in the document. */
function elementIdEntry(container: HTMLElement, id: string): BvarScopeEntry | undefined {
  const doc = container.ownerDocument
  const binders = Array.from(doc.querySelectorAll<HTMLElement>('[data-binder-id]'))
    .filter((element) => element.dataset.binderId === id && element.dataset.kind === 'binder')
  if (binders.length === 0) return undefined
  const bvars = new Set(Array.from(doc.querySelectorAll<HTMLElement>('[data-source-id]'))
    .filter((element) => element.dataset.sourceId === id && element.dataset.kind === 'bvar'))
  for (const binder of binders) {
    const root = binder.closest<HTMLElement>('[data-snl-render-root]')
    const path = binder.dataset.treePath
    if (!root || path === undefined) continue
    for (const use of root.querySelectorAll<HTMLElement>('[data-kind="bvar"]')) {
      if (use.dataset.sourcePath === path) bvars.add(use)
    }
  }
  const scopeRoot = binders.find((binder) => container.contains(binder)) ?? binders[0]
  return { scopeRoot, bvars: [...bvars], binders, crossTree: true }
}
