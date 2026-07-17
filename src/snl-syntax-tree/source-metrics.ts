import type { SnlMacroSource } from '../snl-macro/types'
import type { SnlSyntaxTree } from './types'

export interface SnlSourceMetrics {
  totalNodes: number
  sourcedNodes: number
  /** Number of nodes that do not satisfy any source rule. */
  semanticFreedom: number
  /** `sourcedNodes / totalNodes`, or 0 for an absent tree. */
  structuredRatio: number
}

/** Minimal macro catalog needed by the source metric (render styles omitted). */
export type SnlMacroSourceLookup = Record<string, { source: SnlMacroSource }>

function metadata(node: SnlSyntaxTree): Record<string, unknown> {
  return node.mdata && typeof node.mdata === 'object'
    ? (node.mdata as Record<string, unknown>)
    : {}
}

/**
 * Count source-backed nodes in one parsed SNL tree.
 *
 * A node is sourced when it is:
 * - a macro whose source has a resolvable entry id or at least one URL;
 * - a binder; or
 * - a bvar whose metadata points to a binder (`bindRef` / binder name) or a
 *   resolvable entry id.
 */
export function analyzeSnlTreeSources(
  root: SnlSyntaxTree | null | undefined,
  macroDb: SnlMacroSourceLookup,
  accessibleEntryIds: ReadonlySet<string>,
): SnlSourceMetrics {
  if (!root) {
    return { totalNodes: 0, sourcedNodes: 0, semanticFreedom: 0, structuredRatio: 0 }
  }

  const binderNames = new Set<string>()
  const collectBinders = (node: SnlSyntaxTree): void => {
    if (node.kind === 'binder') binderNames.add(node.name)
    for (const child of node.children) collectBinders(child)
  }
  collectBinders(root)

  let totalNodes = 0
  let sourcedNodes = 0
  const walk = (node: SnlSyntaxTree): void => {
    totalNodes += 1
    let sourced = false

    if (node.kind === 'binder') {
      sourced = true
    } else if (node.kind === 'bvar') {
      const meta = metadata(node)
      const bindRef = typeof meta.bindRef === 'string' ? meta.bindRef : ''
      const src = typeof meta.src === 'string' ? meta.src : ''
      sourced =
        (bindRef.length > 0 && binderNames.has(node.name)) ||
        (src.length > 0 && (binderNames.has(src) || accessibleEntryIds.has(src)))
    } else {
      const macro = macroDb[node.name]
      if (macro) {
        const entries = Array.isArray(macro.source?.entries) ? macro.source.entries : []
        const urls = Array.isArray(macro.source?.urls) ? macro.source.urls : []
        sourced = urls.some((url) => typeof url === 'string' && url.length > 0)
          || entries.some((id) => accessibleEntryIds.has(id))
      }
    }

    if (sourced) sourcedNodes += 1
    for (const child of node.children) walk(child)
  }
  walk(root)

  return {
    totalNodes,
    sourcedNodes,
    semanticFreedom: totalNodes - sourcedNodes,
    structuredRatio: totalNodes === 0 ? 0 : sourcedNodes / totalNodes,
  }
}
