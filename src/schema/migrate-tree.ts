/**
 * Syntax-tree schema migrations.
 *
 * v2 renamed the v1 camelCase fields. v3 separates temporary literal payloads
 * from deterministic whole-tree coordinate identity.
 */
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'

/** v1 tree node shape. */
export interface SyntaxTreeNodeV1 {
  [key: string]: unknown
  name: string
  style?: string
  envMode?: string
  kind?: string
  mdata?: unknown
  scope?: string
  children: SyntaxTreeNodeV1[]
}

/** Published v2 shape. Kinds remain open for consumer presentation skins. */
export interface SyntaxTreeNodeV2 extends Omit<SnlSyntaxTree, 'children'> {
  [key: string]: unknown
  children: SyntaxTreeNodeV2[]
}

/** Current v3 shape. */
export type SyntaxTreeNodeV3 = SnlSyntaxTree

/** Detect whether a tree node is already v2. */
export function isTreeNodeV2(node: Record<string, unknown>): boolean {
  if (!('macro_name' in node) || 'name' in node) return false
  const children = node.children
  return !Array.isArray(children) || children.every(
    (child) => child != null && typeof child === 'object' && isTreeNodeV2(child as Record<string, unknown>),
  )
}

/** Detect whether a tree document is v2 (checks the full tree). */
export function isSyntaxTreeDocumentV2(node: Record<string, unknown>): boolean {
  return isTreeNodeV2(node)
}

function coordinate(path: number[]): string {
  return path.length === 0 ? '#' : `#${path.join('.')}`
}

function isTreeNodeV3(node: Record<string, unknown>, path: number[]): boolean {
  if (typeof node.macro_name !== 'string' || typeof node.kind !== 'string' ||
      !Object.prototype.hasOwnProperty.call(node, 'mdata') || !Array.isArray(node.children)) return false
  if (node.temporary_format !== undefined && node.temporary_format !== 'texttt') return false
  if (node.env_mode !== undefined) {
    if (!['formula_inline', 'formula_display', 'text', 'block'].includes(String(node.env_mode)) ||
        typeof node.temporary_source !== 'string' || node.macro_name !== coordinate(path)) return false
  } else if (node.temporary_source !== undefined || node.temporary_format !== undefined) {
    return false
  }
  return node.children.every((child, index) =>
    child != null && typeof child === 'object' && !Array.isArray(child) &&
    isTreeNodeV3(child as Record<string, unknown>, [...path, index]))
}

/** Validate current schema v3 as one coordinate-aware document. */
export function isSyntaxTreeDocumentV3(node: Record<string, unknown>): boolean {
  return isTreeNodeV3(node, [])
}

/** Migrate a single tree node from v1 to v2, recursively. */
export function migrateTreeNodeV1toV2(node: SyntaxTreeNodeV1): SnlSyntaxTree {
  const { name, style, envMode, children, ...preserved } = node
  const result: SnlSyntaxTree = {
    ...preserved,
    macro_name: name,
    kind: node.kind ?? '',
    mdata: node.mdata ?? null,
    children: children.map(migrateTreeNodeV1toV2),
  }
  if (style) result.style_name = style
  if (envMode) result.env_mode = envMode as SnlSyntaxTree['env_mode']
  return result
}

function migrateTreeNodeV2toV3AtPath(node: SyntaxTreeNodeV2, path: number[]): SnlSyntaxTree {
  const { children, ...preserved } = node
  const temporary = node.env_mode !== undefined
  const metadata = node.mdata && typeof node.mdata === 'object' && !Array.isArray(node.mdata)
    ? { ...(node.mdata as Record<string, unknown>) }
    : null
  const legacySrc = typeof metadata?.src === 'string' ? metadata.src : undefined
  if (metadata) { delete metadata.src; delete metadata.bindRef }
  const mdata = metadata && Object.keys(metadata).length > 0 ? metadata : null
  return {
    ...preserved,
    mdata,
    ...(legacySrc && node.postfix === undefined ? { postfix: { type: 'name' as const, name: legacySrc } } : {}),
    macro_name: temporary ? coordinate(path) : node.macro_name,
    ...(temporary ? { temporary_source: node.temporary_source ?? node.macro_name } : {}),
    ...(node.kind === 'binder' && node.binder_name === undefined
      ? { binder_name: node.temporary_source ?? node.macro_name }
      : {}),
    children: children.map((child, index) => migrateTreeNodeV2toV3AtPath(child, [...path, index])),
  }
}

/**
 * Migrate a whole v2 tree to v3. Coordinates are document-relative, so callers
 * must pass the root rather than migrating detached nodes independently.
 */
export function migrateTreeNodeV2toV3(root: SyntaxTreeNodeV2): SnlSyntaxTree {
  return migrateTreeNodeV2toV3AtPath(root, [])
}

/** Migrate a full v1, v2, or v3 syntax-tree document to v3. */
export function migrateSyntaxTreeDocument(root: SyntaxTreeNodeV1 | SyntaxTreeNodeV2): SnlSyntaxTree {
  if (isSyntaxTreeDocumentV3(root as unknown as Record<string, unknown>)) {
    return root as SyntaxTreeNodeV2 as SnlSyntaxTree
  }
  const v2 = isSyntaxTreeDocumentV2(root as unknown as Record<string, unknown>)
    ? root as SyntaxTreeNodeV2
    : migrateTreeNodeV1toV2(root as SyntaxTreeNodeV1) as SyntaxTreeNodeV2
  return migrateTreeNodeV2toV3(v2)
}
