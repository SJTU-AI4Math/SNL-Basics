import type { SnlSyntaxTree } from '../snl-syntax-tree/types'
import { parseSnlSyntaxTree } from '../snl-react-view/parse'
import type { EntryDataDriver } from './entry-data-driver'

export function extractExportedBinders(snl: string): Set<string> {
  const out = new Set<string>()
  if (!snl.trim()) return out
  let tree: SnlSyntaxTree
  try { tree = parseSnlSyntaxTree(snl) } catch { return out }
  const visit = (node: SnlSyntaxTree): void => {
    if (node.kind === 'binder') { out.add(node.macro_name); return }
    node.children.forEach(visit)
  }
  visit(tree)
  return out
}

export function applyContextSource(tree: SnlSyntaxTree, source: SnlSyntaxTree | null): void {
  if (!source) return
  const binders = new Set<string>()
  const collect = (node: SnlSyntaxTree): void => { if (node.kind === 'binder') { binders.add(node.macro_name); return }; node.children.forEach(collect) }
  collect(source)
  const visit = (node: SnlSyntaxTree): void => {
    const mdata = node.mdata && typeof node.mdata === 'object' ? node.mdata as Record<string, unknown> : undefined
    const sourceId = node.postfix?.type === 'name' ? node.postfix.name : mdata?.src
    if (typeof sourceId === 'string' && node.kind !== 'binder' && binders.has(node.macro_name)) node.kind = 'bvar'
    node.children.forEach(visit)
  }
  visit(tree)
}

interface SourceNode {
  node: SnlSyntaxTree
  sourceId: string
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
}

/** Resolve every `mdata.src` through the injected query driver and annotate atomically. */
export async function resolveEntryContextSources(
  tree: SnlSyntaxTree,
  driver: EntryDataDriver,
  signal?: AbortSignal,
): Promise<void> {
  abortIfNeeded(signal)
  const referenced: SourceNode[] = []
  const visit = (node: SnlSyntaxTree): void => {
    const mdata = node.mdata && typeof node.mdata === 'object' ? node.mdata as Record<string, unknown> : undefined
    const sourceId = node.postfix?.type === 'name' ? node.postfix.name : mdata?.src
    if (typeof sourceId === 'string' && sourceId) referenced.push({ node, sourceId })
    node.children.forEach(visit)
  }
  visit(tree)

  const ids = [...new Set(referenced.map(({ sourceId }) => sourceId))]
  const queried = await Promise.all(ids.map(async (entryId) => {
    const entry = await driver.query_entry({ entry_id: entryId, signal })
    return [entryId, entry ? extractExportedBinders(entry.content?.snl ?? '') : null] as const
  }))
  abortIfNeeded(signal)
  const bindersBySource = new Map(queried)

  for (const { node, sourceId } of referenced) {
    const binders = bindersBySource.get(sourceId)
    const mdata = node.mdata && typeof node.mdata === 'object'
      ? node.mdata as Record<string, unknown>
      : {}
    if (binders === null) {
      node.kind = 'fvar'
      node.source = undefined
      mdata.srcStatus = 'dangling'
    }
    else if (binders?.has(node.macro_name)) {
      node.kind = 'bvar'
      node.source = { type: 'entry', entry_id: sourceId }
      delete mdata.srcStatus
    } else {
      node.kind = 'fvar'
      node.source = undefined
      mdata.srcStatus = 'srcResolvedNoDecl'
    }
    node.mdata = mdata
  }
}
