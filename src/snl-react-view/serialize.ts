import type { SnlSyntaxTree } from '../snl-syntax-tree/types'
import { SnlDslFormatter } from '../snl-syntax-tree/formatter'

const compactFormatter = new SnlDslFormatter(0, Number.MAX_SAFE_INTEGER)

/**
 * Serialize a tree back to Parser-readable source:
 * `macro_name ('[' style_name ']')? ('(' children ')')?`
 *
 * Round-trips with {@link parseSnlSyntaxTree}: an explicit `[style]` bracket in
 * the source survives parse → serialize. A node with no `style_name` emits no
 * bracket (the view then falls back to the macro's default `styles[0]`).
 */
export function serializeSnlSyntaxTree(node: SnlSyntaxTree): string {
  return compactFormatter.formatTree(node, '')
}
