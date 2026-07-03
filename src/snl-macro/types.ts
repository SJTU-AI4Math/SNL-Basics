/**
 * SnlMacro v2 — the single source of truth for a macro. See Plan.md and
 * Phase 2 spec for design rationale.
 *
 * A macro is a globally-unique named renderer. Multiple macros MAY share the
 * same source entry (e.g. Add.add.infix and Add.add.implicit both refer to the
 * "addition" entry). Consumer-owned output backends (Typst / LaTeX / Markdown /
 * plain text) live in downstream extensions, not in this render-only library.
 *
 * v2 (v5 on-disk) changes vs v1 (v4 on-disk):
 *  - `SnlMacro.styles` is now an **ordered array** of {@link SnlMacroStyle};
 *    `styles[0]` is the implicit default (no more separate `defaultStyle`).
 *  - `mode` and `display` moved from macro-level onto each style — different
 *    styles of the same macro can render as formula vs text/block (e.g.
 *    `Eq.eq[formula]` → "a = b" vs `Eq.eq[prose]` → "a 与 b 相等").
 *  - Style tag now lives on the style itself (`style.tag`) instead of being
 *    the map key.
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
 * arity (that hard invariant lives on {@link SnlMacro.arity}); a style only
 * varies the render *output*, never the child count. This is what makes
 * switching styles (via the parser's `[style]` bracket) always safe without
 * spec input.
 *
 * `mode` and `display` live per style so a single macro can carry a formula
 * style ("a = b") alongside a prose style ("a 与 b 相等").
 */
export interface SnlMacroStyle {
  /**
   * Style tag — the token used in `foo[tag](…)`. `[A-Za-z_][A-Za-z0-9_]*`
   * (parser IDENT rules). Must be unique within a macro's `styles` array.
   */
  tag: string
  /** Semantic render mode for this style. */
  mode: 'formula' | 'text' | 'block'
  /**
   * When `mode === 'formula'`: controls KaTeX's displayMode for the ROOT
   * node's render. See R5. Ignored for `mode !== 'formula'`.
   */
  display?: 'inline' | 'block'
  /** LaTeX-native template. See fillLatexTemplate for placeholders: #0, #1, #* (variadic), \# (literal). */
  template: string
  /** For arity === 'variadic': separator between children in `#*`. Default ", ". */
  variadic_join?: string
  /**
   * Block/text mode dispatch key — see hooks.tsx / block-renderers.tsx.
   * Only applies when mode !== 'formula'.
   */
  react_renderer_key?: string
}

export interface SnlMacro {
  /** Globally unique name, e.g. "Add.add", "FOL.forall", "FOL.forall.typed" */
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
   * Argument shape: fixed count vs. variadic. All styles must accept the
   * same arity — this is the hard invariant that makes style-switching
   * always safe without spec input.
   */
  arity: 'fixed' | 'variadic'

  /**
   * All render styles in order. `styles[0]` is the **implicit default** used
   * when the SNL source omits `[style]`. In `foo[bar](x)`, the parser picks
   * the style whose `tag === "bar"`; unknown tags are a render-time error.
   * Every macro has at least one style. Style tags follow `[A-Za-z_][A-Za-z0-9_]*`
   * (parser IDENT rules) and must be unique within this array.
   */
  styles: SnlMacroStyle[]
}

/** The flat macro database: name → macro. */
export type SnlMacroDb = Record<string, SnlMacro>
