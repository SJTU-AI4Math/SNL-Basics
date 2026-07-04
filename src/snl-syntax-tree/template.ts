/**
 * Fill a KaTeX template with substituted child slots.
 *
 * Placeholders (LaTeX-native syntax):
 *   #0 / #1 / ... / #99    → values.child0 / values.child1 / ...
 *   #*                     → values.children_joined (variadic macros)
 *   \#                     → literal `#` character (renders as `\#` in KaTeX, which
 *                            KaTeX renders as `#`)
 *
 * Node metadata (name, kind, bindings) is NO LONGER exposed as template
 * placeholders — every rendered node is auto-wrapped in
 * `\htmlData{name=<macro>,kind=<node.kind>}{...}` by the view layer.
 */
/**
 * A missing child slot renders as a muted, brace-balanced numbered placeholder
 * instead of an empty string. Empty `{}` groups or unbalanced braces make
 * KaTeX (throwOnError:false) render the whole source as red error text, which
 * is exactly the preview bug this guards against during intermediate typing.
 *
 * The exact glyph depends on the surrounding LaTeX context:
 *  - `'formula'` (default): `\square_{N}` — a single KaTeX math glyph.
 *  - `'text'`: `[N]` — pure text tokens, safe inside `\text{...}` where
 *    math commands like `\square` and `_` would otherwise error out.
 * Both variants are wrapped in `\htmlClass{snlMissingArg}` so consumers can
 * style them uniformly.
 */
function missingArgPlaceholder(
  index: number | undefined,
  mode: 'formula' | 'text',
): string {
  if (mode === 'text') {
    const label = index === undefined ? '?' : String(index)
    return `\\htmlClass{snlMissingArg}{[${label}]}`
  }
  // Wrap in `\mathord{...}` so KaTeX's between-atoms spacing (\mspace) is
  // emitted OUTSIDE the placeholder span, not inside its border. Without
  // \mathord, `\htmlClass{snlMissingArg}{\square_{0}} + x` produces a span
  // like `<enclosing snlMissingArg><mord>□</mord><mspace .22em/></enclosing>`,
  // so the placeholder frame visibly extends past its content into empty
  // right-side padding. `\mathord` promotes the wrapper to its own atom,
  // moving the spacing to the outer level. (Same trick applied to the
  // downstream `snlArgPlaceholder` used by the Create Macro preview.)
  const glyph = index === undefined ? '\\square' : `\\square_{${index}}`
  return `\\mathord{\\htmlClass{snlMissingArg}{${glyph}}}`
}

export function fillLatexTemplate(
  template: string,
  values: Record<string, string | number | undefined>,
  mode: 'formula' | 'text' = 'formula',
): string {
  // Sentinel that cannot clash with LaTeX/KaTeX or user content (control chars).
  const ESCAPED_HASH = '\u0001ESCAPED_HASH\u0001'

  // Pass 1: protect template-level `\#` so it survives the #N/#* passes.
  let out = template.replace(/\\#/g, ESCAPED_HASH)

  // Pass 2: `#0`..`#99` → values.child0..child99. A missing slot emits a
  // visible, brace-balanced placeholder (`\htmlClass{snlMissingArg}{...}`)
  // rather than an empty string.
  out = out.replace(/#(\d{1,2})/g, (_, digits: string) => {
    const index = Number(digits)
    const value = values[`child${index}`]
    return value === undefined ? missingArgPlaceholder(index, mode) : String(value)
  })

  // Pass 3: `#*` → values.children_joined (variadic). Missing slot emits the
  // same visible placeholder (unindexed) instead of collapsing to ``.
  out = out.replace(/#\*/g, () => {
    const joined = values['children_joined']
    return joined === undefined ? missingArgPlaceholder(undefined, mode) : String(joined)
  })

  // Pass 4: restore `\#` so KaTeX renders a literal `#`.
  return out.split(ESCAPED_HASH).join('\\#')
}
