import type { I18n } from '../runtime'

/**
 * SnlMacro v9 (on-disk) — the single source of truth for a macro.
 *
 * The first style is the single implicit default. Text styles may localize their
 * template inside that style; formula and block render programs remain invariant.
 * Explicit `[style]` always wins and never depends on the current language.
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
   * Style name — the token used in `foo[style_name](…)`. Must satisfy the shared
   * {@link isSnlIdentifier} policy and be unique within a macro's `styles` array.
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

/** Formula templates are language-invariant render programs. */
export interface SnlFormulaMacroStyle extends SnlMacroStyleBase {
  mode: 'formula_inline' | 'formula_display'
  template: string
  block_template_name?: never
}

/** Block templates are invariant and may select a block renderer. */
export interface SnlBlockMacroStyle extends SnlMacroStyleBase {
  mode: 'block'
  template: string
  block_template_name?: string
}

/** Formula and block templates are language-invariant render programs. */
export type SnlInvariantMacroStyle = SnlFormulaMacroStyle | SnlBlockMacroStyle

/** Text styles keep language projections inside one semantic style. */
export interface SnlTextMacroStyle extends SnlMacroStyleBase {
  mode: 'text'
  template: string | I18n<string, string>
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
   * Display kind preserved in rendered metadata and palette lookup. `sub` is
   * structurally transparent; every other non-built-in string uses const
   * behavior while retaining its own presentation identity.
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
   * @deprecated 0.1.x runtime compatibility only. Current persisted documents
   * localize inside one text style and use styles[0] as the implicit default.
   * Schema migration removes this map.
   */
  default_style?: Record<string, string>

  /**
   * All render styles in order. `styles[0]` is the single implicit default.
   * In `foo[bar](x)`, the parser picks
   * the style whose `style_name === "bar"`; unknown names are a render-time error.
   * Every macro has at least one style. Style names follow the shared
   * {@link isSnlIdentifier} policy and must be unique within this array.
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
