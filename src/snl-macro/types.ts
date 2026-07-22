import type { Localized } from '../runtime'

/**
 * SnlMacro v7 (on-disk) — the single source of truth for a macro.
 *
 * A macro is a globally-unique named renderer. Multiple macros MAY share the
 * same source entry (e.g. FOL.implies.infix and FOL.implies.double both refer to the
 * "implication" entry). Consumer-owned output backends (Typst / LaTeX / Markdown /
 * plain text) live in downstream extensions, not in this render-only library.
 *
 * v7 on-disk changes vs v6:
 *  - `SnlMacroStyle.tag` renamed to `style_name` — consistent with tree-node
 *    field and unambiguous (no more "tag" vs "name" confusion).
 *  - `SnlMacroStyle.react_renderer_key` renamed to `block_template_name` —
 *    only meaningful for `mode === 'block'` styles.
 *  - Removed `variadic_left`, `variadic_join`, `variadic_right` —
 *    replaced by `separator?: string`. Dynamic templates use `#*`.
 *  - `SnlMacro.tags` and `SnlMacroStyle.tags` are now required `string[]`.
 *  - `SnlMacro.name` stays as `name` (NOT renamed).
 *  - No runtime legacy aliases — all consumers must use the new field names.
 */
/**
 * Source-of-truth binding for a macro. Resolver order: `entries[0..]` first
 * valid, else `urls[0]`, else null. SNL-Basics doesn't interpret entry ids —
 * consumers resolve them via the interaction driver.
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
interface SnlMacroStyleBase {
  /**
   * Style name — the token used in `foo[style_name](…)`. `[A-Za-z_][A-Za-z0-9_]*`
   * (parser IDENT rules). Must be unique within a macro's `styles` array.
   */
  style_name: string
  /**
   * Separator string for `#*` expansion in dynamic-arity macros.
   * Defaults to `', '` for formula modes, `''` for text mode.
   * Ignored when the macro is not dynamic_arity.
   */
  separator?: string
  /** Free-text labels used by downstream search indices. */
  tags: string[]
}

/** Formula and block templates are language-invariant render programs. */
export interface SnlInvariantMacroStyle extends SnlMacroStyleBase {
  mode: 'formula_inline' | 'formula_display' | 'block'
  template: string
  /** Block renderer dispatch key; only applies when mode is `block`. */
  block_template_name?: string
}

/** Text templates may be invariant strings or serializable language maps. */
export interface SnlTextMacroStyle extends SnlMacroStyleBase {
  mode: 'text'
  template: Localized<string, string>
  block_template_name?: never
}

export type SnlMacroStyle = SnlInvariantMacroStyle | SnlTextMacroStyle

export interface SnlMacro {
  /** Globally unique macro name, e.g. "FOL.eq", "FOL.forall", "FOL.forall.typed" */
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
   * the style whose `style_name === "bar"`; unknown names are a render-time error.
   * Every macro has at least one style. Style names follow `[A-Za-z_][A-Za-z0-9_]*`
   * (parser IDENT rules) and must be unique within this array.
   */
  styles: SnlMacroStyle[]

  /**
   * Free-text labels attached to the macro itself — used by downstream
   * search indices. Backslashes are forbidden.
   */
  tags: string[]
}

/** The flat macro database: name → macro. */
export type SnlMacroRecord = Record<string, SnlMacro>
