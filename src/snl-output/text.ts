import type { SnlMacroDb } from '../snl-macro/types'
import type { SnlSyntaxTree } from '../snl-syntax-tree/node-types'

/** Plain nested-call notation is a reasonable default for degraded/search display. */
export function toText(tree: SnlSyntaxTree, macroDb: SnlMacroDb): string {
  void macroDb
  return serializeNodeName(tree)
}

function serializeNodeName(tree: SnlSyntaxTree): string {
  if (tree.children.length === 0) return tree.name
  return `${tree.name}(${tree.children.map(serializeNodeName).join(', ')})`
}
