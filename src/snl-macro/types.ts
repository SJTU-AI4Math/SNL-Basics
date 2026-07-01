/**
 * SnlMacro v1 — the single source of truth for a macro. See Plan.md and
 * Phase 2 spec for design rationale.
 *
 * A macro is a globally-unique named renderer + output strategies. Multiple
 * macros MAY share the same source entry (e.g. Add.add.infix and
 * Add.add.implicit both refer to the "addition" entry).
 */
export interface SnlMacro {
  /** Globally unique name, e.g. "Add.add.infix" / "FOL.forall" / "pmatrix" */
  name: string
  /** Human-readable description shown in tooltips / docs. */
  description: string

  /** Source-of-truth binding. Resolver: entries[0..] first valid, else urls[0], else null. */
  source: {
    entries: string[]    // opaque entry ids (SNL-Basics doesn't interpret; consumer resolves via hook)
    urls: string[]       // fallback URLs (wikipedia, mathlib docs, etc.)
  }

  /** Typst output strategies. */
  typst: {
    built_in: string                                 // e.g. "#let mymacro(a, b) = a + b" — pasted into preamble
    synthesis: {
      output_type: 'formula' | 'text'
      macro: string                                  // string-substitution template (same DSL as latex.synthesis)
    }
  }

  /** LaTeX output strategies. */
  latex: {
    built_in: string                                 // e.g. "\\newcommand{\\mymacro}[2]{...}"
    synthesis: {
      output_type: 'formula' | 'text'
      macro: string
    }
  }

  /** Markdown output — direct string substitution, no native macro system. */
  markdown: string                                   // e.g. "@CHILD0@ + @CHILD1@" or "@CHILDREN@"

  /** Plain text output — for search / degraded display. */
  text: string

  /** KaTeX-in-React output — the core render path. */
  katex_react: {
    /** Argument shape: fixed count vs. variadic. */
    arity: 'fixed' | 'variadic'

    /** Semantic mode — dispatches to a renderer family. */
    mode: 'math' | 'text' | 'block'
    // math:  render to a latex string, feed to katex.renderToString, wrap in \htmlData
    // text:  render to a React <span>, children may be math or text or block
    // block: render to a React block element (<div>/<ul>/<table>)

    /**
     * KaTeX template string for math mode. Placeholders:
     *   @CHILD0@ / @CHILD1@ / ...    fixed-arity children by index
     *   @CHILDREN@                    variadic children joined by variadic_join
     *   @NAME@                        macro name (for \htmlData attrs)
     *   @KIND@                        semantic kind (e.g. "const" / "constSymbol" / "constantSubtree")
     *   @BIND_REF@ / @BIND_REF_ATTR@  binding metadata for bvar/binder
     * Ignored for mode !== 'math' unless react_renderer_key is unset.
     */
    template: string

    /** For arity === 'variadic': separator between children in @CHILDREN@. Default ", ". */
    variadic_join?: string

    /**
     * Block/text mode dispatch key — looks up a React renderer in the
     * registry (SnlRenderHooks.renderers or built-in fallback). Common keys:
     *   "list"     variadic → <ul><li>{child}</li></ul>
     *   "table"    variadic → <table> with header row detection
     *   "centered" variadic → <div style="text-align:center">
     * Undefined = fall through to template + katex.renderToString (math mode).
     */
    react_renderer_key?: string
  }
}

/** The flat macro database: name → macro. */
export type SnlMacroDb = Record<string, SnlMacro>
