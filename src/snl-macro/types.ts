/**
 * SnlMacro v3 (v6 on-disk) — the single source of truth for a macro.
 *
 * A macro is a globally-unique named renderer. Multiple macros MAY share the
 * same source entry (e.g. FOL.implies.infix and FOL.implies.double both refer to the
 * "implication" entry). Consumer-owned output backends (Typst / LaTeX / Markdown /
 * plain text) live in downstream extensions, not in this render-only library.
 *
 * v3 (v6 on-disk) changes vs v2 (v5 on-disk):
 *  - `SnlMacroStyle.mode` is flattened to 4 parallel values:
 *    `'formula_inline' | 'formula_display' | 'text' | 'block'`.
 *    The old `display` axis (only meaningful for the ROOT of a KaTeX render)
 *    is folded into the formula mode itself — this removes a fake-orthogonal
 *    axis that only had two visible states in the entire product.
 *  - `SnlMacro.arity: 'fixed' | 'variadic'` is replaced by a boolean
 *    `SnlMacro.dynamic_arity: boolean` (default false). "Variadic" was a
 *    LaTeX-jargon word for what the user experiences as "argument count is
 *    dynamic" — the name matches the checkbox in the editor.
 *  - `SnlMacroStyle.variadic_join` is split into three: `variadic_left`,
 *    `variadic_join`, `variadic_right` (all optional strings, default ''),
 *    so a macro like `matrix.row` can spell out the surrounding delimiters
 *    without embedding them awkwardly in the template.
 *  - `SnlMacro.tags?: string[]` and `SnlMacroStyle.tags?: string[]` — free
 *    text labels for search / bookkeeping. Backslashes are forbidden (they'd
 *    interfere with any downstream LaTeX/text search).
 */
/**
 * Source-of-truth binding for a macro. Resolver order: `entries[0..]` first
 * valid, else `urls[0]`, else null. SNL-Basics doesn't interpret entry ids —
 * consumers resolve them via {@link SnlRenderHooks.resolveSource}.
 */
export interface SnlMacroSource {
  entries: string[] // opaque entry ids (SNL-Basics doesn't interpret; consumer resolves via hook)
  urls: string[] // fallback URLs (wikipedia, mathlib docs, etc.)
}

/**
 * A single render style of a macro. All styles of a macro MUST accept the same
 * arity (that hard invariant lives on {@link SnlMacro.dynamic_arity}); a style
 * only varies the render *output*, never the child count. This is what makes
 * switching styles (via the parser's `[style]` bracket) always safe without
 * spec input.
 *
 * `mode` lives per style so a single macro can carry a formula style
 * ("a = b") alongside a prose style ("a 与 b 相等").
 */
export interface SnlMacroStyle {
  /**
   * Style tag — the token used in `foo[tag](…)`. `[A-Za-z_][A-Za-z0-9_]*`
   * (parser IDENT rules). Must be unique within a macro's `styles` array.
   */
  tag: string
  /**
   * Semantic render mode. Four flat parallel values (v3):
   *   - `formula_inline`  — KaTeX inline math ($...$)
   *   - `formula_display` — KaTeX display math ($$...$$)
   *   - `text`            — KaTeX `\text{...}`; may host formulas via `$...$`
   *   - `block`           — React-rendered block (list / table / centered / …)
   */
  mode: 'formula_inline' | 'formula_display' | 'text' | 'block'
  /** LaTeX-native template. See fillLatexTemplate for placeholders: #0, #1, #* (variadic), \# (literal). */
  template: string
  /**
   * Delimiters + separator for `#*` in a dynamic-arity macro. Ignored when
   * {@link SnlMacro.dynamic_arity} is false. Defaults: `''` / `', '` (formula)
   * or `''` (text) / `''`. Rendered as `variadic_left + children.join(variadic_join) + variadic_right`.
   */
  variadic_left?: string
  variadic_join?: string
  variadic_right?: string
  /**
   * Block/text mode dispatch key — see hooks.tsx / block-renderers.tsx.
   * Only applies when mode is 'block' or 'text'.
   */
  react_renderer_key?: string
  /**
   * Free-text labels attached to this style — used by downstream search
   * indices. Backslashes are forbidden. Optional.
   */
  tags?: string[]
}

export interface SnlMacro {
  /** Globally unique name, e.g. "FOL.eq", "FOL.forall", "FOL.forall.typed" */
  name: string
  /** Human-readable description shown in tooltips / docs. */
  description: string

  /** Source-of-truth binding. Resolver: entries[0..] first valid, else urls[0], else null. */
  source: SnlMacroSource

  /**
   * Semantic kind (rule / const / bvar / binder / fvar / custom).
   * If unset, nodes rendered for this macro get `data-kind="fvar"`.
   * (There is no more `'default'` kind — un-classified = fvar.)
   */
  kind?: string

  /**
   * True when the macro's child count is not fixed by its template — its
   * default (styles[0]) template must contain `#*`. All styles must agree
   * on this flag; it's a macro-level invariant so switching styles never
   * changes the arity contract at the call site.
   */
  dynamic_arity: boolean

  /**
   * All render styles in order. `styles[0]` is the **implicit default** used
   * when the SNL source omits `[style]`. In `foo[bar](x)`, the parser picks
   * the style whose `tag === "bar"`; unknown tags are a render-time error.
   * Every macro has at least one style. Style tags follow `[A-Za-z_][A-Za-z0-9_]*`
   * (parser IDENT rules) and must be unique within this array.
   */
  styles: SnlMacroStyle[]

  /**
   * Free-text labels attached to the macro itself — used by downstream
   * search indices. Backslashes are forbidden. Optional.
   */
  tags?: string[]
}

/** The flat macro database: name → macro. */
export type SnlMacroDb = Record<string, SnlMacro>
