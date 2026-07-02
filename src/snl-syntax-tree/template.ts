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
export function fillLatexTemplate(
  template: string,
  values: Record<string, string | number | undefined>,
): string {
  // Sentinel that cannot clash with LaTeX/KaTeX or user content (control chars).
  const ESCAPED_HASH = '\u0001ESCAPED_HASH\u0001'

  // Pass 1: protect template-level `\#` so it survives the #N/#* passes.
  let out = template.replace(/\\#/g, ESCAPED_HASH)

  // Pass 2: `#0`..`#99` → values.child0..child99 (missing → empty string).
  out = out.replace(/#(\d{1,2})/g, (_, digits: string) => {
    const value = values[`child${Number(digits)}`]
    return value === undefined ? '' : String(value)
  })

  // Pass 3: `#*` → values.children_joined (variadic; missing → empty string).
  out = out.replace(/#\*/g, () => {
    const joined = values['children_joined']
    return joined === undefined ? '' : String(joined)
  })

  // Pass 4: restore `\#` so KaTeX renders a literal `#`.
  return out.split(ESCAPED_HASH).join('\\#')
}
