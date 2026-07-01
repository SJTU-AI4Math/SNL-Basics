import { OperatorTreeParseError, parseOperatorTree } from '../snl-syntax-tree/parser'
import type { OperatorTree } from '../snl-syntax-tree/types'

/** 解析失败时返回 { ok: false, ... }，不抛异常 */
export function tryParseOperatorTree(
  input: string,
): { ok: true; tree: OperatorTree } | { ok: false; error: string; position?: number } {
  try {
    return { ok: true, tree: parseOperatorTree(input) }
  } catch (e) {
    if (e instanceof OperatorTreeParseError) {
      return { ok: false, error: e.message, position: e.position }
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export { OperatorTreeParseError, parseOperatorTree, parseStyleMeta } from '../snl-syntax-tree/parser'
