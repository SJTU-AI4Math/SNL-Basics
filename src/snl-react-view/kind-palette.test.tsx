import { describe, expect, it } from 'vitest'
import {
  DEFAULT_KIND_PALETTE,
  alpha,
  assertSafeKindName,
  paletteToCss,
  type KindPalette,
} from './kind-palette'

describe('DEFAULT_KIND_PALETTE', () => {
  it('has the 5 Lean-Expr defaults with the specified hex pairs', () => {
    expect(DEFAULT_KIND_PALETTE).toMatchObject({
      rule: { stroke: '#009C27', background: '#D6FEE0' },
      const: { stroke: '#005B9C', background: '#DAF0FF' },
      bvar: { stroke: '#7700E4', background: '#EFDFFF' },
      binder: { stroke: '#E07B00', background: '#FFEBD2' },
      fvar: { stroke: '#D20022', background: '#FFD6DC' },
    })
    expect(Object.keys(DEFAULT_KIND_PALETTE)).toHaveLength(5)
  })
})

describe('alpha', () => {
  it('converts #RRGGBB to rgba at the given alpha', () => {
    expect(alpha('#D6FEE0', 0.5)).toBe('rgba(214, 254, 224, 0.5)')
  })

  it('expands #RGB shorthand', () => {
    expect(alpha('#0f8', 0.5)).toBe('rgba(0, 255, 136, 0.5)')
  })

  it('re-alphas an existing rgb()/rgba()', () => {
    expect(alpha('rgb(1, 2, 3)', 0.25)).toBe('rgba(1, 2, 3, 0.25)')
    expect(alpha('rgba(10, 20, 30, 0.9)', 0.5)).toBe('rgba(10, 20, 30, 0.5)')
  })
})

describe('paletteToCss', () => {
  it('emits each kind stroke color as base + hover treatment', () => {
    const css = paletteToCss(DEFAULT_KIND_PALETTE)
    for (const [kind, coloring] of Object.entries(DEFAULT_KIND_PALETTE)) {
      expect(css).toContain(`.katex-html [data-kind="${kind}"] { color: ${coloring.stroke}; }`)
      expect(css).toContain(`.katex-html .snl-single-hover[data-kind="${kind}"]`)
      expect(css).toContain(`border: 1px solid ${coloring.background};`)
    }
    // Hover background is the kind background at 50% alpha.
    expect(css).toContain('rgba(214, 254, 224, 0.5)') // rule background @ 50%
    // Binding-scope highlight rules from bvar / binder entries.
    expect(css).toContain('.snl-bvar-scope')
    expect(css).toContain('.snl-binder-decl')
  })

  it('lets a consumer palette override defaults while defaults fill the rest', () => {
    const merged: KindPalette = { ...DEFAULT_KIND_PALETTE, const: { stroke: '#123456', background: '#abcdef' } }
    const css = paletteToCss(merged)
    expect(css).toContain('.katex-html [data-kind="const"] { color: #123456; }')
    // A default kind is still present.
    expect(css).toContain('.katex-html [data-kind="rule"] { color: #009C27; }')
  })

  it('throws on an unsafe kind name (CSS-injection guard)', () => {
    expect(() => paletteToCss({ 'x"] { evil': { stroke: '#000', background: '#fff' } })).toThrow()
    expect(() => assertSafeKindName('bad name')).toThrow()
    expect(() => assertSafeKindName('good-Name_1')).not.toThrow()
  })
})
