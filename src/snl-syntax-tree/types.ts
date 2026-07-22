/**
 * Runtime syntax-tree node shape produced by the parser. Flat and mode-agnostic:
 * `{ macro_name, kind, mdata, children }`. Render mode is derived from the resolved
 * `SnlMacroStyle.mode` at render time (see the `node-types` union for the
 * forward-looking discriminated form).
 *
 * Tree v2 renames vs v1:
 *  - `name` → `macro_name` (unambiguous; the parser's token IS a macro name)
 *  - `style` → `style_name` (matches SnlMacroStyle.style_name)
 *  - `envMode` → `env_mode` (snake_case consistency, no camelCase)
 */
export interface SnlSyntaxTree {
  /** Macro name — key into `SnlMacroRecord`. */
  macro_name: string
  /**
   * Style-name override from the parser's `[style]` bracket, e.g. `foo[bar]` sets
   * `style_name = 'bar'`. Undefined when no bracket — the view falls back to the
   * macro's first style (`SnlMacro.styles[0]`).
   */
  style_name?: string
  /**
   * Synthetic-macro environment mode set by the parser for delimited names:
   *   `%…%` → `'text'`
   *   `$…$` → `'formula_inline'`
   *   `$$…$$` → `'formula_display'`
   *   (block env_mode is possible via macro query resolution)
   *
   * When set, the render pipeline treats this node as a TEMPORARY macro:
   *   - The `macro_name` is a literal payload (LaTeX source or raw text) — NOT a
   *     queried macro key.
   *   - `text` → wrapped in `\text{escape(macro_name)}`.
   *   - `formula_inline` → emitted as raw LaTeX.
   *   - `formula_display` → same as formula_inline, but also forces
   *     `katex.displayMode = true` at the root.
   * When `env_mode` is set the macro query backend is NOT consulted for a template.
   *
   * Undefined for regular identifier-form nodes (the vast majority).
   */
  env_mode?: 'formula_inline' | 'formula_display' | 'text' | 'block'
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
  macro_name: string,
  options?: Partial<Pick<SnlSyntaxTree, 'kind' | 'mdata' | 'children'>>,
): SnlSyntaxTree {
  return {
    macro_name,
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
    typeof node.macro_name === 'string' &&
    typeof node.kind === 'string' &&
    Array.isArray(node.children)
  )
}
