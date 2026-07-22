/**
 * Migrate syntax tree document from v1 to v2.
 *
 * v1 node fields: name, style?, envMode?, kind?, mdata?, children
 * v2 node fields: macro_name, style_name?, env_mode?, kind?, mdata?, children
 *
 * Mapping:
 *   - name → macro_name
 *   - style → style_name
 *   - envMode → env_mode
 *   - Recursive through children
 */
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'

/** v1 tree node shape */
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

/** Detect whether a tree node is already v2 */
export function isTreeNodeV2(node: Record<string, unknown>): boolean {
  if (!('macro_name' in node) || 'name' in node) return false
  const children = node.children
  return !Array.isArray(children) || children.every(
    (child) => child != null && typeof child === 'object' && isTreeNodeV2(child as Record<string, unknown>),
  )
}

/** Detect whether a tree document is v2 (checks root) */
export function isSyntaxTreeDocumentV2(node: Record<string, unknown>): boolean {
  return isTreeNodeV2(node)
}

/** Migrate a single tree node from v1 to v2, recursively */
export function migrateTreeNodeV1toV2(node: SyntaxTreeNodeV1): SnlSyntaxTree {
  const { name, style, envMode, children, ...preserved } = node
  const result: SnlSyntaxTree = {
    ...preserved,
    macro_name: name,
    kind: node.kind ?? '',
    mdata: node.mdata ?? null,
    children: children.map(migrateTreeNodeV1toV2),
  }
  if (style) {
    result.style_name = style
  }
  if (envMode) {
    result.env_mode = envMode as SnlSyntaxTree['env_mode']
  }
  return result
}

/** Migrate a full syntax tree document from v1 to v2 */
export function migrateSyntaxTreeDocument(root: SyntaxTreeNodeV1): SnlSyntaxTree {
  return migrateTreeNodeV1toV2(root)
}
