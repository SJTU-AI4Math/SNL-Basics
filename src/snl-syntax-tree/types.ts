/**
 * Runtime syntax-tree node shape produced by the parser. Flat and mode-agnostic:
 * `{ name, kind, mdata, children }`. Render mode is derived from the referenced
 * macro's `katex_react.mode` at render time (see the `node-types` union for the
 * forward-looking discriminated form).
 */
export interface SnlSyntaxTree {
  /** Macro name — key into `SnlMacroDb`. */
  name: string
  /** Semantic kind (rule / const / binder / bvar / fvar / …). */
  kind: string
  /**
   * Structural scope marker (out of the kind namespace). annotate-bind sets
   * `scope = 'binder'` on quantifier nodes; the view emits `data-scope` from it.
   */
  scope?: string
  /** Meta data (e.g. `{ bindRef }`) written by binding annotation. */
  mdata: unknown
  /** Child nodes. */
  children: SnlSyntaxTree[]
}

/** Construct a {@link SnlSyntaxTree} node with sensible defaults for omitted fields. */
export function createSnlSyntaxTreeNode(
  name: string,
  options?: Partial<Pick<SnlSyntaxTree, 'kind' | 'mdata' | 'children'>>,
): SnlSyntaxTree {
  return {
    name,
    kind: options?.kind ?? '',
    mdata: options?.mdata ?? null,
    children: options?.children ?? [],
  }
}

/** Runtime type guard for {@link SnlSyntaxTree}. */
export function isSnlSyntaxTree(value: unknown): value is SnlSyntaxTree {
  if (!value || typeof value !== 'object') {
    return false
  }

  const node = value as Partial<SnlSyntaxTree>
  return (
    typeof node.name === 'string' &&
    typeof node.kind === 'string' &&
    Array.isArray(node.children)
  )
}
