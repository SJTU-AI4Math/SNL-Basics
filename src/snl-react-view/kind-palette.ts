/**
 * Customizable kind registry. Each semantic `data-kind` maps to a
 * {@link KindColoring}; the view generates per-kind CSS from the resolved
 * palette and injects it inline (see `SnlSyntaxTreeView`). Consumers override
 * any subset via the `kindPalette` prop — their entries win, defaults fill the
 * rest.
 */

/** Colors for a single kind. */
export interface KindColoring {
  /** Border + hover text color (also the base text color). */
  stroke: string
  /** Background base + hover border; hover background = this color @ 50% alpha. */
  background: string
}

/** A registry mapping `data-kind` strings to their colors. */
export type KindPalette = Record<string, KindColoring>

/**
 * The 5 default kinds, mapped to Lean Expr semantics (colors from Doc-Ext's
 * `fulcrum-math-notes` ENTRY_KIND_PRESETS):
 * - `rule`   — meta-mathematical rule symbols (∀, ∃, `:`, `def`, `variable`…)
 * - `const`  — mathematical constants (defined terms)
 * - `bvar`   — bound variables (occurrences)
 * - `binder` — binding sites (∀-`x`, λ's parameter, informal `dx`…)
 * - `fvar`   — free variables (undefined, effectively `sorry`s)
 */
export const DEFAULT_KIND_PALETTE: KindPalette = {
  rule: { stroke: '#009C27', background: '#D6FEE0' }, // definition green
  const: { stroke: '#005B9C', background: '#DAF0FF' }, // theorem blue
  bvar: { stroke: '#7700E4', background: '#EFDFFF' }, // example purple
  binder: { stroke: '#E07B00', background: '#FFEBD2' }, // remark orange
  fvar: { stroke: '#D20022', background: '#FFD6DC' }, // counterexample red
  // Partial: subtree that is NOT a complete syntactic node (e.g. matrix rows,
  // implementation-only helper macros). Palette entry exists so the base
  // (un-hovered) text color inherits from the parent — but the hover
  // machinery in `findMinimalHoverRoot` skips sub-kind nodes, so a
  // sub never highlights or shows a tooltip on its own.
  sub: { stroke: 'inherit', background: 'transparent' },
}

/**
 * Compute `color` at alpha `a` (0..1) as an `rgba(...)` string. Handles
 * `#RRGGBB`, `#RGB`, and `rgb()/rgba()` inputs. Unrecognized inputs are
 * returned unchanged (best-effort — a consumer may pass a CSS keyword).
 */
export function alpha(color: string, a: number): string {
  const c = color.trim()

  const hexMatch = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(c)
  if (hexMatch) {
    const hex = hexMatch[1]
    let r: number
    let g: number
    let b: number
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16)
      g = parseInt(hex[1] + hex[1], 16)
      b = parseInt(hex[2] + hex[2], 16)
    } else {
      r = parseInt(hex.slice(0, 2), 16)
      g = parseInt(hex.slice(2, 4), 16)
      b = parseInt(hex.slice(4, 6), 16)
    }
    return `rgba(${r}, ${g}, ${b}, ${a})`
  }

  const rgbMatch = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*(?:,\s*[0-9.]+\s*)?\)$/.exec(
    c,
  )
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch
    return `rgba(${r}, ${g}, ${b}, ${a})`
  }

  return color
}

/**
 * Kind names are interpolated into a CSS attribute selector, so they must be
 * restricted to a safe character set to prevent CSS injection.
 */
const KIND_NAME_RE = /^[A-Za-z0-9_-]+$/

/** Throw if `name` is not a safe CSS `data-kind` value. */
export function assertSafeKindName(name: string): void {
  if (!KIND_NAME_RE.test(name)) {
    throw new Error(
      `invalid kind name for CSS generation (allowed: [A-Za-z0-9_-]): ${JSON.stringify(name)}`,
    )
  }
}

/**
 * Generate the per-kind CSS from a resolved palette. Emits, for each kind:
 * a `.snl-single-hover` treatment (kind stroke text, background-colored
 * border, background @ 50% alpha, rounded). Base (un-hovered) text color
 * is NOT changed — the tree keeps its native (usually black) color until
 * hovered. Additionally emits the binding-scope highlight rules
 * (`.snl-bvar-scope` / `.snl-binder-decl`) from the `bvar` / `binder`
 * entries when present.
 *
 * Throws if any kind name is unsafe for a CSS selector.
 */
export function paletteToCss(palette: KindPalette): string {
  const blocks = Object.entries(palette).map(([k, c]) => {
    assertSafeKindName(k)
    // NOTE: the "border" is drawn with `box-shadow`, not the CSS `border`
    // property, so hovering never reflows the surrounding math layout.
    // `box-shadow` + `background-color` are paint-only and don't change the
    // element's box size — everything around the hovered subtree stays still.
    return `.katex-html .snl-single-hover[data-kind="${k}"] {
  color: ${c.stroke};
  background: ${alpha(c.background, 0.5)};
  box-shadow: 0 0 0 1px ${c.background};
  border-radius: 5px;
}`
  })

  // Binding-scope highlight spans siblings (not just nested ancestors), so it
  // stays class-driven — colored from the bvar/binder entries.
  const bvar = palette.bvar
  if (bvar) {
    blocks.push(`.katex-html [data-kind="bvar"].snl-bvar-scope {
  color: ${bvar.stroke};
  background: ${alpha(bvar.background, 0.5)};
}`)
  }
  const binder = palette.binder
  if (binder) {
    blocks.push(`.katex-html [data-kind="binder"].snl-binder-decl,
.katex-html [data-kind="binder"].snl-binder-decl.snl-single-hover {
  color: ${binder.stroke};
  background: ${alpha(binder.background, 0.5)};
}`)
  }

  return blocks.join('\n')
}
