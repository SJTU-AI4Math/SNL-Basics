import type { SnlSyntaxTree } from '../snl-syntax-tree/types'

/**
 * Serialize a tree back to Parser-readable source:
 * `macro_name ('[' style_name ']')? ('(' children ')')?`
 *
 * Round-trips with {@link parseSnlSyntaxTree}: an explicit `[style]` bracket in
 * the source survives parse → serialize. A node with no `style_name` emits no
 * bracket (the view then falls back to the macro's default `styles[0]`).
 */
export function serializeSnlSyntaxTree(node: SnlSyntaxTree): string {
  const stylePart = node.style_name ? `[${node.style_name}]` : ''
  const childrenPart =
    node.children.length > 0
      ? `(${node.children.map((child) => serializeSnlSyntaxTree(child)).join(',')})`
      : ''
  return `${node.macro_name}${stylePart}${childrenPart}`
}
