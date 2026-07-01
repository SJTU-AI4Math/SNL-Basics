import type { SnlMacro, SnlMacroDb } from '../snl-macro/types'
import type { SnlSyntaxTree } from '../snl-syntax-tree/node-types'

/** Options for {@link toTypst}. */
export interface TypstOutputOptions {
  strategy?: 'built_in' | 'synthesis'  // default 'built_in'
  include_preamble?: boolean            // default true
}

/** Stub: returns "TODO(typst): <macro-name-tree>". Real impl in Phase 2.5+. */
export function toTypst(
  tree: SnlSyntaxTree,
  macroDb: SnlMacroDb,
  opts?: TypstOutputOptions,
): string {
  void macroDb
  void opts
  return `TODO(typst): ${serializeNodeName(tree)}`
}

/** Collect all built_in declarations for macros referenced by tree. Stub returns concatenation. */
export function buildTypstPreamble(macros: SnlMacro[]): string {
  return macros
    .map((m) => m.typst.built_in)
    .filter((s) => s.length > 0)
    .join('\n')
}

function serializeNodeName(tree: SnlSyntaxTree): string {
  if (tree.children.length === 0) return tree.name
  return `${tree.name}(${tree.children.map(serializeNodeName).join(', ')})`
}
