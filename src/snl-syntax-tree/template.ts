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
 * A missing child slot renders as a muted, boxed, numbered placeholder instead
 * of an empty string. This keeps braces balanced (KaTeX with throwOnError:false
 * would otherwise paint the whole source red on an empty `{}` group) and gives
 * consumers a `.snlMissingArg` hook to style. `\square` is a single KaTeX-safe
 * glyph, so the expansion is never `` or ` ` alone.
 */
function missingArgPlaceholder(index?: number): string {
  const glyph = index === undefined ? '\\square' : `\\square_{${index}}`
  return `\\htmlClass{snlMissingArg}{${glyph}}`
}

export function fillLatexTemplate(
  template: string,
  values: Record<string, string | number | undefined>,
): string {
  // Sentinel that cannot clash with LaTeX/KaTeX or user content (control chars).
  const ESCAPED_HASH = '\u0001ESCAPED_HASH\u0001'

  // Pass 1: protect template-level `\#` so it survives the #N/#* passes.
  let out = template.replace(/\\#/g, ESCAPED_HASH)

  // Pass 2: `#0`..`#99` → values.child0..child99. A missing slot emits a
  // visible, brace-balanced placeholder (`\htmlClass{snlMissingArg}{\square_{N}}`)
  // rather than an empty string. Empty `{}` groups or unbalanced braces make
  // KaTeX (throwOnError:false) render the whole source as red error text, which
  // is exactly the preview bug this guards against during intermediate typing.
  out = out.replace(/#(\d{1,2})/g, (_, digits: string) => {
    const index = Number(digits)
    const value = values[`child${index}`]
    return value === undefined ? missingArgPlaceholder(index) : String(value)
  })

  // Pass 3: `#*` → values.children_joined (variadic). A missing joined value
  // emits the same visible placeholder (unindexed) instead of collapsing to ``.
  out = out.replace(/#\*/g, () => {
    const joined = values['children_joined']
    return joined === undefined ? missingArgPlaceholder() : String(joined)
  })

  // Pass 4: restore `\#` so KaTeX renders a literal `#`.
  return out.split(ESCAPED_HASH).join('\\#')
}
