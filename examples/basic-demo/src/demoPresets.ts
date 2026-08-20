type DemoTemplate =
  | { mode: 'formula_inline' | 'text'; body: string }
  | {
      mode: 'block'
      body: string
      block_template_name: 'svg_template'
      svg_template: {
        asset: { source: string; base_identity: string; revision: string; request_epoch: number }
        generation: number
        producer_revision: string
        accessibility: { label: string }
        formula_embed: { total_height_em: number; baseline_ratio: number }
      }
    }

interface DemoMacro {
  name: string
  description: string
  source: { entries: string[]; urls: string[] }
  dynamic_arity: false
  kind: string
  tags: string[]
  styles: Array<{ style_name: string; tags: string[]; template: DemoTemplate }>
}

export interface DemoPreset {
  id: 'higher-category' | 'derived-cube' | 'topology-cover' | 'projective-geometry' | 'function-plot'
  label: string
  description: string
  source: string
  rootMacro: string
  diagramMacro: string
  slotCount: number
}

const svg = (viewBox: string, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`

export const DEMO_SVG_SOURCES: Record<string, string> = {
  'higher-category.svg': svg('0 0 720 360',
    '<rect x="8" y="8" width="704" height="344" rx="24" fill="none" stroke="#3b82f6" stroke-width="3"/>' +
    '<path d="M135 72 C210 8 285 8 330 72" fill="none" stroke="currentColor" stroke-width="3"/>' +
    '<path d="M135 92 C210 154 285 154 330 92" fill="none" stroke="currentColor" stroke-width="3"/>' +
    '<path d="M390 72 C465 8 540 8 585 72" fill="none" stroke="currentColor" stroke-width="3"/>' +
    '<path d="M390 92 C465 154 540 154 585 92" fill="none" stroke="currentColor" stroke-width="3"/>' +
    '<path d="M330 74 l-15 -5 l7 14 z M330 90 l-15 -7 l5 15 z M585 74 l-15 -5 l7 14 z M585 90 l-15 -7 l5 15 z" fill="currentColor"/>' +
    '<path d="M222 62 C240 42 265 42 282 62 M282 62 l-11 -3 l5 10 z" fill="none" stroke="#a855f7" stroke-width="3"/>' +
    '<path d="M477 102 C495 122 520 122 537 102 M537 102 l-11 3 l5 -10 z" fill="none" stroke="#a855f7" stroke-width="3"/>' +
    '<path d="M110 130 C165 340 555 340 610 130" fill="none" stroke="#0ea5e9" stroke-width="3" stroke-dasharray="10 8"/>' +
    '<path d="M610 130 l-14 2 l10 10 z" fill="#0ea5e9"/>' +
    '<path d="M275 230 C305 185 415 185 445 230 C415 278 305 278 275 230Z" fill="none" stroke="#f59e0b" stroke-width="3"/>' +
    '<path d="M360 270 l-7 -13 l14 0 z" fill="#f59e0b"/>' +
    '<g data-snl-slot="0" transform="translate(92 82)"/><g data-snl-slot="1" transform="translate(360 82)"/><g data-snl-slot="2" transform="translate(628 82)"/>' +
    '<g data-snl-slot="3" transform="translate(220 35)"/><g data-snl-slot="4" transform="translate(220 195)"/><g data-snl-slot="5" transform="translate(500 35)"/>' +
    '<g data-snl-slot="6" transform="translate(252 115)"/><g data-snl-slot="7" transform="translate(508 115)"/><g data-snl-slot="8" transform="translate(360 232)"/>'),

  'derived-cube.svg': svg('0 0 720 420',
    '<rect x="8" y="8" width="704" height="404" rx="24" fill="none" stroke="#2563eb" stroke-width="3"/>' +
    '<path d="M120 100 H360 V300 H120 Z M260 45 H500 V245 H260 Z" fill="none" stroke="currentColor" stroke-width="3"/>' +
    '<path d="M120 100 L260 45 M360 100 L500 45 M360 300 L500 245 M120 300 L260 245" fill="none" stroke="currentColor" stroke-width="3"/>' +
    '<path d="M142 100 l-14 -7 v14 z M282 45 l-14 -7 v14 z M360 122 l-7 -14 h14 z M500 67 l-7 -14 h14 z" fill="currentColor"/>' +
    '<path d="M120 300 C80 245 80 155 120 100" fill="none" stroke="#a855f7" stroke-width="4"/>' +
    '<path d="M120 100 l-4 15 l13 -6 z" fill="#a855f7"/>' +
    '<path d="M260 245 L500 45" fill="none" stroke="#f97316" stroke-width="3" stroke-dasharray="12 8"/>' +
    '<path d="M500 45 l-15 2 l9 11 z" fill="#f97316"/>' +
    '<path d="M374 287 H478 M374 295 H478" fill="none" stroke="#0ea5e9" stroke-width="3"/>' +
    '<path d="M478 291 l-15 -9 v18 z" fill="#0ea5e9"/>' +
    '<path d="M270 245 q20 -30 40 0 q20 30 40 0" fill="none" stroke="#22c55e" stroke-width="3"/>' +
    '<path d="M350 245 l-14 -5 l7 13 z" fill="#22c55e"/>' +
    '<g data-snl-slot="0" transform="translate(92 100)"/><g data-snl-slot="1" transform="translate(378 100)"/><g data-snl-slot="2" transform="translate(92 300)"/><g data-snl-slot="3" transform="translate(378 300)"/>' +
    '<g data-snl-slot="4" transform="translate(238 45)"/><g data-snl-slot="5" transform="translate(520 45)"/><g data-snl-slot="6" transform="translate(238 245)"/><g data-snl-slot="7" transform="translate(520 245)"/>'),

  'topology-cover.svg': svg('0 0 720 390',
    '<rect x="8" y="8" width="704" height="374" rx="24" fill="none" stroke="#0ea5e9" stroke-width="3"/>' +
    '<ellipse cx="170" cy="210" rx="125" ry="70" fill="none" stroke="currentColor" stroke-width="3"/>' +
    '<ellipse cx="170" cy="210" rx="44" ry="70" fill="none" stroke="currentColor" stroke-width="3"/>' +
    '<path d="M45 210 C90 155 250 155 295 210 C250 265 90 265 45 210Z" fill="none" stroke="#3b82f6" stroke-width="3"/>' +
    '<path d="M390 70 C450 25 555 25 615 70 C555 115 450 115 390 70Z M390 160 C450 115 555 115 615 160 C555 205 450 205 390 160Z M390 250 C450 205 555 205 615 250 C555 295 450 295 390 250Z" fill="none" stroke="currentColor" stroke-width="3"/>' +
    '<path d="M505 75 V150 M505 165 V240" fill="none" stroke="#a855f7" stroke-width="4" stroke-dasharray="8 7"/>' +
    '<path d="M505 240 l-8 -14 h16 z" fill="#a855f7"/>' +
    '<path d="M370 185 C320 165 300 175 280 205" fill="none" stroke="#f59e0b" stroke-width="4"/>' +
    '<path d="M280 205 l3 -15 l11 10 z" fill="#f59e0b"/>' +
    '<path d="M330 350 H590" fill="none" stroke="#22c55e" stroke-width="3"/>' +
    '<path d="M590 350 l-15 -8 v16 z" fill="#22c55e"/>' +
    '<path d="M330 366 H590" fill="none" stroke="#22c55e" stroke-width="2" stroke-dasharray="5 6"/>' +
    '<g data-snl-slot="0" transform="translate(170 105)"/><g data-snl-slot="1" transform="translate(170 315)"/><g data-snl-slot="2" transform="translate(505 70)"/>' +
    '<g data-snl-slot="3" transform="translate(505 160)"/><g data-snl-slot="4" transform="translate(505 250)"/><g data-snl-slot="5" transform="translate(330 175)"/><g data-snl-slot="6" transform="translate(460 315)"/>'),

  'projective-geometry.svg': svg('0 0 720 420',
    '<rect x="8" y="8" width="704" height="404" rx="24" fill="none" stroke="#8b5cf6" stroke-width="3"/>' +
    '<circle cx="360" cy="210" r="150" fill="none" stroke="currentColor" stroke-width="3"/>' +
    '<path d="M237.128 296.036 L360 60 L489.904 285 Z" fill="none" stroke="#3b82f6" stroke-width="4"/>' +
    '<path d="M237.128 296.036 L424.952 172.5 M360 60 L363.516 290.518 M489.904 285 L298.564 178.018" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="9 7"/>' +
    '<path d="M120 335 C250 260 470 260 600 335" fill="none" stroke="#f97316" stroke-width="4"/>' +
    '<path d="M600 335 l-15 -2 l8 13 z" fill="#f97316"/>' +
    '<path d="M360 210 m-18 0 a18 18 0 1 0 36 0 a18 18 0 1 0 -36 0" fill="none" stroke="#22c55e" stroke-width="3"/>' +
    '<path d="M360 210 L460 210" fill="none" stroke="#22c55e" stroke-width="3"/>' +
    '<path d="M460 210 l-14 -7 v14 z" fill="#22c55e"/>' +
    '<path d="M255 145 Q360 260 470 135" fill="none" stroke="#ec4899" stroke-width="3"/>' +
    '<path d="M470 135 l-15 1 l9 11 z" fill="#ec4899"/>' +
    '<g data-snl-slot="0" transform="translate(360 35)"/><g data-snl-slot="1" transform="translate(210 315)"/><g data-snl-slot="2" transform="translate(520 305)"/>' +
    '<g data-snl-slot="3" transform="translate(345 210)"/><g data-snl-slot="4" transform="translate(390 238)"/><g data-snl-slot="5" transform="translate(220 120)"/><g data-snl-slot="6" transform="translate(510 120)"/>'),

  'function-plot.svg': svg('0 0 720 410',
    '<rect x="8" y="8" width="704" height="394" rx="24" fill="none" stroke="#14b8a6" stroke-width="3"/>' +
    '<path d="M70 210 H655 M360 355 V45" fill="none" stroke="currentColor" stroke-width="3"/>' +
    '<path d="M655 210 l-15 -8 v16 z M360 45 l-8 15 h16 z" fill="currentColor"/>' +
    '<path d="M85 330 C145 365 185 250 230 100 C275 65 320 170 360 210 C400 250 445 355 490 320 C535 170 580 55 635 90" fill="none" stroke="#3b82f6" stroke-width="5"/>' +
    '<path d="M90 120 Q360 350 630 120" fill="none" stroke="#f97316" stroke-width="4" stroke-dasharray="11 8"/>' +
    '<path d="M630 120 l-15 -2 l8 13 z" fill="#f97316"/>' +
    '<path d="M230 100 V210 M490 210 V320" fill="none" stroke="#a855f7" stroke-width="2" stroke-dasharray="6 6"/>' +
    '<path d="M230 100 l-7 14 h14 z M490 320 l-7 -14 h14 z" fill="#a855f7"/>' +
    '<circle cx="230" cy="100" r="7" fill="#22c55e"/><circle cx="490" cy="320" r="7" fill="#22c55e"/>' +
    '<path d="M145 165 Q215 95 285 165" fill="none" stroke="#ec4899" stroke-width="3"/>' +
    '<path d="M285 165 l-14 -5 l7 13 z" fill="#ec4899"/>' +
    '<g data-snl-slot="0" transform="translate(360 325)"/><g data-snl-slot="1" transform="translate(555 70)"/><g data-snl-slot="2" transform="translate(230 245)"/>' +
    '<g data-snl-slot="3" transform="translate(490 245)"/><g data-snl-slot="4" transform="translate(190 70)"/><g data-snl-slot="5" transform="translate(540 330)"/><g data-snl-slot="6" transform="translate(360 175)"/>'),
}

const leaf = (name: string, body: string, mode: 'formula_inline' | 'text' = 'formula_inline'): DemoMacro => ({
  name,
  description: `Preset label ${body}`,
  source: { entries: [], urls: [] },
  dynamic_arity: false,
  kind: 'const',
  tags: ['demo-preset'],
  styles: [{ style_name: 'default', tags: [], template: { mode, body } }],
})

const diagram = (name: string, asset: string, slotCount: number, label: string): DemoMacro => ({
  name,
  description: label,
  source: { entries: [], urls: [] },
  dynamic_arity: false,
  kind: 'diagram',
  tags: ['demo-preset', 'svg-template'],
  styles: [{ style_name: 'default', tags: [], template: {
    mode: 'block',
    body: Array.from({ length: slotCount }, (_, index) => `#${index}`).join(''),
    block_template_name: 'svg_template',
    svg_template: {
      asset: { source: asset, base_identity: 'basic-demo-presets', revision: `${asset}-v1`, request_epoch: 1 },
      generation: 1,
      producer_revision: 'basic-demo-presets-v1',
      accessibility: { label },
      formula_embed: { total_height_em: 5.5, baseline_ratio: 0.72 },
    },
  } }],
})

export const DEMO_MACROS: Record<string, DemoMacro> = {
  'Diagram.higher': diagram('Diagram.higher', 'higher-category.svg', 9, 'Curved higher-category diagram with natural transformations and a two-cell'),
  'Diagram.cube': diagram('Diagram.cube', 'derived-cube.svg', 8, 'Derived cube with diagonal, dashed, hooked, wavy, and double arrows'),
  'Diagram.cover': diagram('Diagram.cover', 'topology-cover.svg', 7, 'Covering-space and fundamental-group topology diagram'),
  'Diagram.geometry': diagram('Diagram.geometry', 'projective-geometry.svg', 7, 'Projective triangle, conic, center, and incidence diagram'),
  'Diagram.plot': diagram('Diagram.plot', 'function-plot.svg', 7, 'Function and derivative plot with critical-point annotations'),

  'Cat.C': leaf('Cat.C', '\\mathcal{C}'), 'Cat.D': leaf('Cat.D', '\\mathcal{D}'), 'Cat.E': leaf('Cat.E', '\\mathcal{E}'),
  'Functor.F': leaf('Functor.F', 'F'), 'Functor.G': leaf('Functor.G', 'G'), 'Functor.H': leaf('Functor.H', 'H'),
  'Nat.eta': leaf('Nat.eta', '\\eta'), 'Nat.theta': leaf('Nat.theta', '\\theta'), 'TwoCell.alpha': leaf('TwoCell.alpha', '\\alpha'),

  'Cube.X0': leaf('Cube.X0', 'X_0'), 'Cube.X1': leaf('Cube.X1', 'X_1'), 'Cube.X2': leaf('Cube.X2', 'X_2'), 'Cube.X3': leaf('Cube.X3', 'X_3'),
  'Cube.Y0': leaf('Cube.Y0', 'Y_0'), 'Cube.Y1': leaf('Cube.Y1', 'Y_1'), 'Cube.Y2': leaf('Cube.Y2', 'Y_2'), 'Cube.Y3': leaf('Cube.Y3', 'Y_3'),

  'Top.Universal': leaf('Top.Universal', '\\widetilde X'), 'Top.Space': leaf('Top.Space', 'X'), 'Top.Sphere': leaf('Top.Sphere', 'S^1'),
  'Top.Loop': leaf('Top.Loop', '\\Omega X'), 'Top.Pi': leaf('Top.Pi', '\\pi_1(X)'), 'Top.Cover': leaf('Top.Cover', 'p'), 'Top.Action': leaf('Top.Action', '\\pi_1(X)\\curvearrowright\\widetilde X'),

  'Geo.A': leaf('Geo.A', 'A'), 'Geo.B': leaf('Geo.B', 'B'), 'Geo.C': leaf('Geo.C', 'C'), 'Geo.O': leaf('Geo.O', 'O'),
  'Geo.H': leaf('Geo.H', 'H'), 'Geo.Angle': leaf('Geo.Angle', '\\angle BAC'), 'Geo.Polar': leaf('Geo.Polar', '\\ell_P'),

  'Plot.F': leaf('Plot.F', 'f(x)=x^3-3x'), 'Plot.DF': leaf('Plot.DF', "f'(x)"), 'Plot.Minus': leaf('Plot.Minus', 'x_-'),
  'Plot.Plus': leaf('Plot.Plus', 'x_+'), 'Plot.Max': leaf('Plot.Max', '\\operatorname{max}f'), 'Plot.Min': leaf('Plot.Min', '\\operatorname{min}f'),
  'Plot.Zero': leaf('Plot.Zero', 'f(0)=0'),
}

export const DEMO_PRESETS: readonly DemoPreset[] = [
  {
    id: 'higher-category', label: 'Higher category · curved 2-cells',
    description: 'Parallel curved functors, natural transformations, a dashed composite, and an explicit higher two-cell.',
    source: 'Diagram.higher(Cat.C,Cat.D,Cat.E,Functor.F,Functor.G,Functor.H,Nat.eta,Nat.theta,TwoCell.alpha)',
    rootMacro: 'Diagram.higher', diagramMacro: 'Diagram.higher', slotCount: 9,
  },
  {
    id: 'derived-cube', label: 'Derived cube · unusual arrows',
    description: 'An eight-object cube with diagonal, dashed, hooked, wavy, and doubled morphisms rendered as artwork.',
    source: 'Diagram.cube(Cube.X0,Cube.X1,Cube.X2,Cube.X3,Cube.Y0,Cube.Y1,Cube.Y2,Cube.Y3)',
    rootMacro: 'Diagram.cube', diagramMacro: 'Diagram.cube', slotCount: 8,
  },
  {
    id: 'topology-cover', label: 'Topology · covering and loops',
    description: 'A covering-space schematic combining loop levels, a torus-like base, projection, and group action labels.',
    source: 'Diagram.cover(Top.Universal,Top.Space,Top.Sphere,Top.Loop,Top.Pi,Top.Cover,Top.Action)',
    rootMacro: 'Diagram.cover', diagramMacro: 'Diagram.cover', slotCount: 7,
  },
  {
    id: 'projective-geometry', label: 'Geometry · conic and incidence',
    description: 'An inscribed projective triangle, circumcircle, cevians, centers, polar line, and curved incidence correspondence.',
    source: 'Diagram.geometry(Geo.A,Geo.B,Geo.C,Geo.O,Geo.H,Geo.Angle,Geo.Polar)',
    rootMacro: 'Diagram.geometry', diagramMacro: 'Diagram.geometry', slotCount: 7,
  },
  {
    id: 'function-plot', label: 'Analysis · function plot',
    description: 'A cubic function, its derivative parabola, critical points, extrema, and the zero crossing in one diagram.',
    source: 'Diagram.plot(Plot.F,Plot.DF,Plot.Minus,Plot.Plus,Plot.Max,Plot.Min,Plot.Zero)',
    rootMacro: 'Diagram.plot', diagramMacro: 'Diagram.plot', slotCount: 7,
  },
]
