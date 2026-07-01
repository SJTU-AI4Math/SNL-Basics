import type { SnlSyntaxTree } from '../snl-syntax-tree/types'

/** 将树还原为 Parser 可读的文本（name[style](children…)） */
export function serializeSnlSyntaxTree(node: SnlSyntaxTree): string {
  const stylePart = node.style ? `[${node.style}]` : ''
  const childrenPart =
    node.children.length > 0
      ? `(${node.children.map((child) => serializeSnlSyntaxTree(child)).join(',')})`
      : ''
  return `${node.name}${stylePart}${childrenPart}`
}
