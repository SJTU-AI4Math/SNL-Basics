import type { SnlMacroRecord } from '../snl-macro/types'
import type { SnlResolvedSource, SnlSyntaxTree } from './types'

export interface SnlDiagnostic {
  code: string
  severity: 'warning' | 'error'
  tree_path: number[]
  message: string
}

export interface SnlSemanticResolution {
  tree: SnlSyntaxTree
  diagnostics: SnlDiagnostic[]
}

interface LocatedNode {
  node: SnlSyntaxTree
  path: number[]
  order: number
}

interface LocatedSource extends LocatedNode {
  binderName: string
}

function cleanDerivedMetadata(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const copy = { ...(value as Record<string, unknown>) }
  delete copy.bindRef

  return Object.keys(copy).length > 0 ? copy : null
}

function cloneTree(node: SnlSyntaxTree): SnlSyntaxTree {
  return {
    ...node,
    mdata: cleanDerivedMetadata(node.mdata),
    postfix: node.postfix?.type === 'tree_path'
      ? { type: 'tree_path', path: [...node.postfix.path] }
      : node.postfix ? { ...node.postfix } : undefined,
    source: undefined,
    children: node.children.map(cloneTree),
  }
}

function equalPath(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function commonPrefixLength(left: readonly number[], right: readonly number[]): number {
  let length = 0
  while (length < left.length && length < right.length && left[length] === right[length]) length += 1
  return length
}

function chooseSource(
  candidates: readonly LocatedSource[],
  use: LocatedNode,
  priorOnly: boolean,
): LocatedSource | undefined {
  return candidates
    .filter((candidate) => !priorOnly || candidate.order < use.order)
    .sort((left, right) =>
      commonPrefixLength(right.path, use.path) - commonPrefixLength(left.path, use.path) ||
      right.order - left.order,
    )[0]
}

function lookupName(node: SnlSyntaxTree): string {
  return node.temporary_source ?? node.macro_name
}

/**
 * Resolve the one `kind` field after all Macro point-lookups have completed.
 * The input tree is never mutated; driver swaps can therefore recompute safely.
 */
export function resolveSnlSemantics(
  input: SnlSyntaxTree,
  macros: SnlMacroRecord,
): SnlSemanticResolution {
  const tree = cloneTree(input)
  const diagnostics: SnlDiagnostic[] = []
  const located: LocatedNode[] = []
  let order = 0

  const visit = (node: SnlSyntaxTree, path: number[]): void => {
    located.push({ node, path, order: order++ })
    node.scope = undefined
    const macro = node.env_mode ? undefined : macros[node.macro_name]
    const rootTemporaryText = path.length === 0 && node.env_mode === 'text'
    const macroSub = macro?.kind === 'sub'

    if (rootTemporaryText || macroSub || node.kind === 'sub') {
      node.kind = 'sub'
      node.binder_name = undefined
      node.source = undefined
      if (node.postfix || node.binder_explicit) {
        diagnostics.push({
          code: 'SNL_SUB_IGNORES_BINDER_SUFFIX',
          severity: 'warning',
          tree_path: [...path],
          message: 'sub nodes ignore binder declarations and postfix sources',
        })
      }
    } else if (node.binder_explicit) {
      node.kind = 'binder'
      node.binder_name ??= node.macro_name
    } else if (macro) {
      node.kind = macro.kind || 'const'
      if (node.postfix?.type === 'name') node.binder_name = node.postfix.name
      node.source = undefined
      if (node.mdata && typeof node.mdata === 'object') {
        const data = { ...(node.mdata as Record<string, unknown>) }
        delete data.src
        node.mdata = Object.keys(data).length > 0 ? data : null
      }
    } else if (node.kind && node.kind !== 'bvar' && node.kind !== 'fvar') {
      // Consumer/custom occurrence kinds retain their presentation skin and
      // use const behavior. Only parser-time bvar/fvar guesses are recomputed.
    } else {
      // Discard parser-time name-stack guesses. This pass has authoritative
      // Macro hit/miss information and resolves all unknown nodes below.
      node.kind = ''
      node.binder_name = undefined
    }

    node.children.forEach((child, index) => visit(child, [...path, index]))
  }
  visit(tree, [])

  const sources: LocatedSource[] = located.flatMap((item) => {
    const binderName = item.node.binder_name
    return binderName && (item.node.kind === 'binder' || item.node.kind !== '' && item.node.source === undefined)
      ? [{ ...item, binderName }]
      : []
  })

  for (const item of located) {
    const { node, path } = item
    if (node.kind !== '') continue

    let resolved: SnlResolvedSource | undefined
    if (node.postfix?.type === 'name') {
      const status = node.mdata && typeof node.mdata === 'object'
        ? (node.mdata as Record<string, unknown>).srcStatus
        : undefined
      if (status === 'dangling' || status === 'srcResolvedNoDecl') {
        diagnostics.push({
          code: status === 'dangling' ? 'SNL_ENTRY_SOURCE_NOT_FOUND' : 'SNL_ENTRY_SOURCE_NO_DECL',
          severity: 'warning',
          tree_path: [...path],
          message: `Entry source ${JSON.stringify(node.postfix.name)} did not export this reference`,
        })
      } else {
        resolved = { type: 'entry', entry_id: node.postfix.name }
      }
    } else if (node.postfix?.type === 'tree_path') {
      const target = sources.find((source) => equalPath(source.path, node.postfix!.type === 'tree_path' ? node.postfix!.path : []))
      if (target) resolved = { type: 'tree_path', path: [...target.path] }
      else diagnostics.push({
        code: 'SNL_DANGLING_TREE_SOURCE', severity: 'warning', tree_path: [...path],
        message: `tree source #${node.postfix.path.join('.')} does not name a binder source`,
      })
    } else {
      const requestedName = node.postfix?.type === 'binder_name'
        ? node.postfix.name
        : lookupName(node)
      const target = chooseSource(
        sources.filter((source) => source.binderName === requestedName),
        item,
        true,
      )
      if (target) resolved = { type: 'tree_path', path: [...target.path] }
      else if (node.postfix?.type === 'binder_name') diagnostics.push({
        code: 'SNL_BINDER_NAME_NOT_FOUND', severity: 'warning', tree_path: [...path],
        message: `binder source ${JSON.stringify(requestedName)} was not found in the current context`,
      })
    }

    if (resolved) {
      node.kind = 'bvar'
      node.source = resolved
    } else {
      node.kind = 'fvar'
      node.source = undefined
    }
  }

  return { tree, diagnostics }
}
