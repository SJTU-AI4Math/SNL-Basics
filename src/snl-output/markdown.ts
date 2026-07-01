import type { SnlMacroDb } from '../snl-macro/types'
import type { SnlSyntaxTree } from '../snl-syntax-tree/node-types'

/** Stub: returns "TODO(markdown): <macro-name-tree>". Real impl in Phase 2.5+. */
export function toMarkdown(tree: SnlSyntaxTree, macroDb: SnlMacroDb): string {
  void macroDb
  return `TODO(markdown): ${serializeNodeName(tree)}`
}

function serializeNodeName(tree: SnlSyntaxTree): string {
  if (tree.children.length === 0) return tree.name
  return `${tree.name}(${tree.children.map(serializeNodeName).join(', ')})`
}
