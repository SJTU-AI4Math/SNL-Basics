import { SnlSyntaxTreeParseError, parseSnlSyntaxTree } from '../snl-syntax-tree/parser'
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'

/** 解析失败时返回 { ok: false, ... }，不抛异常 */
export function tryParseSnlSyntaxTree(
  input: string,
): { ok: true; tree: SnlSyntaxTree } | { ok: false; error: string; position?: number } {
  try {
    return { ok: true, tree: parseSnlSyntaxTree(input) }
  } catch (e) {
    if (e instanceof SnlSyntaxTreeParseError) {
      return { ok: false, error: e.message, position: e.position }
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export { SnlSyntaxTreeParseError, parseSnlSyntaxTree, parseStyleMeta } from '../snl-syntax-tree/parser'
