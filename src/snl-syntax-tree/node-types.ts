/**
 * SNL syntax tree node types (v1). Discriminated union on `mode`.
 *
 * The parser produces nodes with `mode` derived from the referenced
 * macro's `katex_react.mode` field. If no macro is found in the DB, the
 * default is 'math' (fallback to fvar/bvar/binder heuristics).
 */

export interface SnlSyntaxTreeBase {
  /** Macro name — key into SnlMacroDb. */
  name: string
  /** Semantic kind: 'const' | 'constSymbol' | 'constantSubtree' | 'binder' | 'bvar' | 'fvar' | ... */
  kind: string
  /** Meta data (bindRef etc). */
  mdata: unknown
  /** Children — semantics depends on mode + macro.arity. */
  children: SnlSyntaxTree[]
}

export interface SnlSyntaxTreeMathNode extends SnlSyntaxTreeBase {
  mode: 'math'
}

export interface SnlSyntaxTreeTextNode extends SnlSyntaxTreeBase {
  mode: 'text'
}

export interface SnlSyntaxTreeBlockNode extends SnlSyntaxTreeBase {
  mode: 'block'
  /** Which block renderer to invoke — matches katex_react.react_renderer_key. */
  block_kind: 'list' | 'table' | 'centered' | 'custom'
}

export type SnlSyntaxTree =
  | SnlSyntaxTreeMathNode
  | SnlSyntaxTreeTextNode
  | SnlSyntaxTreeBlockNode
