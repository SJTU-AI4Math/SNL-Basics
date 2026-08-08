import type { SnlMacro } from '../snl-macro/types'
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'

/** Resolve the one persisted kind field without introducing a separate role. */
export function resolveRenderedKind(
  node: SnlSyntaxTree,
  macro: SnlMacro | null | undefined,
  isRoot: boolean,
): string {
  if (isRoot && node.env_mode === 'text') return 'sub'
  if (macro?.kind === 'sub') return 'sub'
  if (node.kind) return node.kind
  if (macro?.kind) return macro.kind
  if (macro) return 'const'
  return 'fvar'
}

/** Only these strings select special behavior; every other kind is a const skin. */
export function behaviorKind(kind: string): 'sub' | 'binder' | 'bvar' | 'fvar' | 'const' {
  if (kind === 'sub' || kind === 'binder' || kind === 'bvar' || kind === 'fvar') return kind
  return 'const'
}
