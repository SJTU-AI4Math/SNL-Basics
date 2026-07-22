/**
 * SNL syntax tree node types (v2). Discriminated union on `mode`.
 *
 * The parser produces nodes with `mode` derived from the referenced
 * macro's `mode` field. If no macro is found in the DB, the
 * default is 'formula' (fallback to fvar/bvar/binder heuristics).
 */

/** Common fields shared by all node modes. */
export interface SnlSyntaxTreeBase {
  /** Macro name — key into SnlMacroRecord. */
  macro_name: string
  /** Style-name override from the parser's `[style_name]` bracket; picks `SnlMacro.styles[style_name]`. */
  style_name?: string
  /** Semantic kind: 'rule' | 'const' | 'binder' | 'bvar' | 'fvar' | ... */
  kind: string
  /** Structural scope marker (e.g. 'binder'), emitted as `data-scope`. */
  scope?: string
  /** Meta data (bindRef etc). */
  mdata: unknown
  /** Children — semantics depends on mode + macro.arity. */
  children: SnlSyntaxTree[]
}

/** A node rendered as a formula (KaTeX). */
export interface SnlSyntaxTreeFormulaNode extends SnlSyntaxTreeBase {
  mode: 'formula'
}

/** A node rendered as text (React `<span>` wrapping children). */
export interface SnlSyntaxTreeTextNode extends SnlSyntaxTreeBase {
  mode: 'text'
}

/** A node rendered as a block element via a registered block renderer. */
export interface SnlSyntaxTreeBlockNode extends SnlSyntaxTreeBase {
  mode: 'block'
  /** Which block renderer to invoke — matches the resolved style's block_template_name. */
  block_kind: 'list' | 'table' | 'centered' | 'custom'
}

/** Discriminated union of node modes (forward-looking; parser emits the flat form). */
export type SnlSyntaxTree =
  | SnlSyntaxTreeFormulaNode
  | SnlSyntaxTreeTextNode
  | SnlSyntaxTreeBlockNode
