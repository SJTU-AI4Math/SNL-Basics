import type { I18n } from '../runtime'

/**
 * SnlMacro v11 (on-disk) — the single source of truth for a macro.
 *
 * The first style is the single implicit default. Every style may localize one
 * complete render template atomically; style identity and tags remain invariant.
 * Explicit `[style]` always wins and never depends on the current language.
 *
 * A macro is a globally-unique named renderer. Multiple macros MAY share the
 * same source entry (e.g. FOL.implies.infix and FOL.implies.double both refer to the
 * Consumer-owned output backends (Typst / LaTeX / Markdown / plain text) remain
 * opaque extension fields on the complete template projection.
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
 * One complete render template. Localization selects this object atomically:
 * mode, body, separator and block renderer can never come from different
 * language projections.
 */
interface SnlMacroTemplateBase {
  /** Opaque consumer-owned render extensions travel with this projection.
   * `type` is reserved by the enclosing localization discriminator.
   */
  [key: string]: unknown
  /** Reserved for `Localized` envelopes; never valid inside a projection. */
  type?: never
  /** Render program containing positional placeholders (`#0`, `#1`, `#*`). */
  body: string
  /** Separator used when expanding `#*`; ignored for fixed-arity macros. */
  separator?: string
}

export interface SnlFormulaMacroTemplate extends SnlMacroTemplateBase {
  mode: 'formula_inline' | 'formula_display'
  block_template_name?: never
}

export interface SnlTextMacroTemplate extends SnlMacroTemplateBase {
  mode: 'text'
  block_template_name?: never
}

export interface SnlBlockMacroTemplate extends SnlMacroTemplateBase {
  mode: 'block'
  block_template_name?: string
}

export type SnlMacroTemplate =
  | SnlFormulaMacroTemplate
  | SnlTextMacroTemplate
  | SnlBlockMacroTemplate

/**
 * A semantic style identity selected by `foo[style_name](…)`. Its complete
 * render template may be invariant or localized; tags and identity never vary
 * with language.
 */
export interface SnlMacroStyle {
  style_name: string
  tags: string[]
  template: SnlMacroTemplate | I18n<string, SnlMacroTemplate>
}

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
   * localize the complete template inside one style and use styles[0] as default.
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
