/**
 * Runtime syntax-tree node shape produced by the parser. Flat and mode-agnostic:
 * `{ name, kind, mdata, children }`. Render mode is derived from the resolved
 * `SnlMacroStyle.mode` at render time (see the `node-types` union for the
 * forward-looking discriminated form).
 */
export interface SnlSyntaxTree {
  /** Macro name — key into `SnlMacroDb`. */
  name: string
  /**
   * Style-tag override from the parser's `[style]` bracket, e.g. `foo[bar]` sets
   * `style = 'bar'`. Undefined when no bracket — the view falls back to the
   * macro's first style (`SnlMacro.styles[0]`).
   */
  style?: string
  /**
   * Synthetic-macro environment mode set by the parser for delimited names:
   *   `%…%` → `'text'`
   *   `$…$` → `'formula_inline'`
   *   `$$…$$` → `'formula_display'`
   *
   * When set, the render pipeline treats this node as a TEMPORARY macro:
   *   - The `name` is a literal payload (LaTeX source or raw text) — NOT a
   *     macroDb key.
   *   - `text` → wrapped in `\text{escape(name)}`.
   *   - `formula_inline` → emitted as raw LaTeX (`name` is expected to be
   *     valid LaTeX; if it contains `$…$` KaTeX handles it normally).
   *   - `formula_display` → same as formula_inline, but also forces
   *     `katex.displayMode = true` at the root.
   * When `envMode` is set the macroDb is NOT consulted for a template.
   *
   * Undefined for regular identifier-form nodes (the vast majority).
   */
  envMode?: 'formula_inline' | 'formula_display' | 'text'
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
