import type { SnlSyntaxTree } from '../snl-syntax-tree/types'

/** 将树还原为 Parser 可读的文本（name(children…)） */
export function serializeSnlSyntaxTree(node: SnlSyntaxTree): string {
  const childrenPart =
    node.children.length > 0
      ? `(${node.children.map((child) => serializeSnlSyntaxTree(child)).join(',')})`
      : ''
  return `${node.macro_name}${childrenPart}`
}
