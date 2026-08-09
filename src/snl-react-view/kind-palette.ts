import type { ColorScheme } from '../runtime/render-context'

/** Colors for one theme variant of a semantic kind. */
export interface KindColoringVariant {
  /** Macro text color. */
  stroke: string
  /** Macro surface fill color. */
  background: string
}

/** Legacy Entry Kind input allowed either flat field to be omitted. */
export interface LegacyKindColoring {
  stroke?: string
  background?: string
  light?: never
  dark?: never
}

/** Complete legacy palette pair, excluding theme keys. */
export type FlatKindColoring = KindColoringVariant & { light?: never; dark?: never }

/** Theme-aware colors for a semantic kind. */
export interface ThemedKindColoring {
  light: KindColoringVariant
  dark: KindColoringVariant
  stroke?: never
  background?: never
}

/** Legacy flat colors remain a supported input and apply to both themes. */
export type KindColoring = FlatKindColoring | ThemedKindColoring
export type CompatibleKindColoring = LegacyKindColoring | ThemedKindColoring

export type KindPalette = Record<string, KindColoring>

const themed = (stroke: string, background: string): ThemedKindColoring => ({
  light: { stroke, background },
  dark: { stroke, background },
})

export const DEFAULT_KIND_PALETTE: Record<string, ThemedKindColoring> = {
  rule: themed('#009C27', '#D6FEE0'),
  const: themed('#005B9C', '#DAF0FF'),
  bvar: themed('#7700E4', '#EFDFFF'),
  binder: themed('#E07B00', '#FFEBD2'),
  fvar: themed('#D20022', '#FFD6DC'),
  sub: themed('inherit', 'transparent'),
}

export function alpha(color: string, a: number): string {
  const c = color.trim()
  const hexMatch = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(c)
  if (hexMatch) {
    const hex = hexMatch[1]
    const r = parseInt(hex.length === 3 ? hex[0] + hex[0] : hex.slice(0, 2), 16)
    const g = parseInt(hex.length === 3 ? hex[1] + hex[1] : hex.slice(2, 4), 16)
    const b = parseInt(hex.length === 3 ? hex[2] + hex[2] : hex.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${a})`
  }
  const rgbMatch = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*(?:,\s*[0-9.]+\s*)?\)$/.exec(c)
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch
    return `rgba(${r}, ${g}, ${b}, ${a})`
  }
  if (c === 'transparent' || c === 'inherit') return c
  return `color-mix(in srgb, ${color} ${a * 100}%, transparent)`
}

const KIND_NAME_RE = /^[A-Za-z0-9_-]+$/
export function assertSafeKindName(name: string): void {
  if (!KIND_NAME_RE.test(name)) {
    throw new Error(`invalid kind name for CSS generation (allowed: [A-Za-z0-9_-]): ${JSON.stringify(name)}`)
  }
}

export function resolveKindColoring(
  coloring: KindColoring,
  colorScheme: ColorScheme,
): KindColoringVariant
export function resolveKindColoring(
  coloring: CompatibleKindColoring,
  colorScheme: ColorScheme,
): LegacyKindColoring | KindColoringVariant
export function resolveKindColoring(
  coloring: CompatibleKindColoring,
  colorScheme: ColorScheme,
): LegacyKindColoring | KindColoringVariant {
  const hasTheme = 'light' in coloring || 'dark' in coloring
  const hasFlat = 'stroke' in coloring || 'background' in coloring
  if (hasTheme && hasFlat) {
    throw new Error('kind coloring cannot mix flat and theme-aware fields')
  }
  if (hasTheme) {
    const light = coloring.light
    const dark = coloring.dark
    if (!isCompleteColoringVariant(light) || !isCompleteColoringVariant(dark)) {
      throw new Error('theme-aware kind coloring requires complete light and dark variants')
    }
    return colorScheme === 'light' ? light : dark
  }
  return coloring
}

function isCompleteColoringVariant(value: unknown): value is KindColoringVariant {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).stroke === 'string' &&
    typeof (value as Record<string, unknown>).background === 'string'
}

/** Macro CSS: stroke border and background are 50% alpha; text uses solid stroke. */
export function paletteToCss(palette: KindPalette, colorScheme: ColorScheme = 'light'): string {
  const blocks = Object.entries(palette).map(([kind, variants]) => {
    assertSafeKindName(kind)
    const colors = resolveKindColoring(variants, colorScheme)
    return `.katex-html .snl-single-hover[data-kind="${kind}"] {
  color: ${colors.stroke};
  background: ${alpha(colors.background, 0.5)};
  box-shadow: 0 0 0 1px ${alpha(colors.stroke, 0.5)};
  border-radius: 5px;
}`
  })
  const bvar = palette.bvar ? resolveKindColoring(palette.bvar, colorScheme) : undefined
  if (bvar) blocks.push(`.katex-html [data-kind="bvar"].snl-bvar-scope {
  color: ${bvar.stroke};
  background: ${alpha(bvar.background, 0.5)};
}`)
  const binder = palette.binder ? resolveKindColoring(palette.binder, colorScheme) : undefined
  if (binder) blocks.push(`.katex-html [data-kind="binder"].snl-binder-decl,
.katex-html [data-kind="binder"].snl-binder-decl.snl-single-hover {
  color: ${binder.stroke};
  background: ${alpha(binder.background, 0.5)};
}`)
  return blocks.join('\n')
}
