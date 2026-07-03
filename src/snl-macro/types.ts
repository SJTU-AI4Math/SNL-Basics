/**
 * SnlMacro v1 — the single source of truth for a macro. See Plan.md and
 * Phase 2 spec for design rationale.
 *
 * A macro is a globally-unique named renderer. Multiple macros MAY share the
 * same source entry (e.g. Add.add.infix and Add.add.implicit both refer to the
 * "addition" entry). Consumer-owned output backends (Typst / LaTeX / Markdown /
 * plain text) live in downstream extensions, not in this render-only library.
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
 * A single render style for a macro. All styles of a macro MUST accept the same
 * arity (that hard invariant lives on {@link SnlMacro.arity}); a style only
 * varies the render *output*, never the child count. This is what makes
 * switching styles (via the parser's `[style]` bracket) always safe without
 * spec input.
 */
export interface SnlMacroStyle {
  /** LaTeX-native template. See fillLatexTemplate for placeholders (#0/#1/#*/\#). */
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

  /** Semantic render mode. */
  mode: 'formula' | 'text' | 'block'

  /**
   * When mode === 'formula': controls KaTeX's displayMode for the ROOT
   * node's render. See R5. Ignored for mode !== 'formula'.
   */
  display?: 'inline' | 'block'

  /**
   * The style tag to use when the SNL source does NOT specify `[style]`.
   * Must be a key in `styles`. Required (every macro has a default).
   */
  defaultStyle: string

  /**
   * All render styles keyed by tag. In `foo[bar](x)`, `bar` picks
   * `styles['bar']`. Without brackets, `styles[defaultStyle]` is used.
   * Every macro has at least one style. Style tags are
   * `[A-Za-z_][A-Za-z0-9_]*` (parser IDENT rules).
   */
  styles: Record<string, SnlMacroStyle>
}

/** The flat macro database: name → macro. */
export type SnlMacroDb = Record<string, SnlMacro>
