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

export interface SnlMacro {
  /** Globally unique name, e.g. "Add.add.infix" / "FOL.forall" / "pmatrix" */
  name: string
  /** Human-readable description shown in tooltips / docs. */
  description: string

  /** Source-of-truth binding. Resolver: entries[0..] first valid, else urls[0], else null. */
  source: SnlMacroSource

  /** KaTeX-in-React output — the core render path. */
  katex_react: {
    /** Argument shape: fixed count vs. variadic. */
    arity: 'fixed' | 'variadic'

    /** Semantic mode — dispatches to a renderer family. */
    mode: 'formula' | 'text' | 'block'
    // formula: render to a latex string, feed to katex.renderToString; the view
    //        layer auto-wraps the result in \htmlData{name,kind,bindRef}
    // text:  render to a React <span>, children may be formula or text or block
    // block: render to a React block element (<div>/<ul>/<table>)

    /**
     * KaTeX template string for formula mode (LaTeX-native placeholders):
     *   #0 / #1 / ...    fixed-arity children by index
     *   #*               variadic children joined by variadic_join
     *   \#               literal `#` character
     * Node metadata (name / kind / bindings) is NOT written here — the view
     * layer auto-wraps every node in \htmlData{name=<macro>,kind=<node.kind>}.
     * Ignored for mode !== 'formula' unless react_renderer_key is unset.
     */
    template: string

    /** For arity === 'variadic': separator between children in `#*`. Default ", ". */
    variadic_join?: string

    /**
     * Block/text mode dispatch key — looks up a React renderer in the
     * registry (SnlRenderHooks.renderers or built-in fallback). Common keys:
     *   "list"     variadic → <ul><li>{child}</li></ul>
     *   "table"    variadic → <table> with header row detection
     *   "centered" variadic → <div style="text-align:center">
     * Undefined = fall through to template + katex.renderToString (formula mode).
     */
    react_renderer_key?: string
  }
}

/** The flat macro database: name → macro. */
export type SnlMacroDb = Record<string, SnlMacro>
