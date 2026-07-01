import type { SnlMacroDb } from './template-db'
import type { SnlSyntaxTree } from './types'

/** 方括号为空时：选第一个 childCount 与当前节点子节点个数一致的 style，否则取该 SNL 宏第一个 style */
export function getEffectiveStyle(node: SnlSyntaxTree, db: SnlMacroDb): string {
  if (node.style?.trim()) {
    return node.style
  }
  const op = db[node.name]
  if (!op?.styles) {
    return ''
  }
  const entries = Object.entries(op.styles)
  const hit = entries.find(([, t]) => t.childCount === node.children.length)
  return hit?.[0] ?? entries[0]?.[0] ?? ''
}
