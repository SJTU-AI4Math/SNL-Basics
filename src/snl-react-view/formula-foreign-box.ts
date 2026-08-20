import type { SnlBlockMacroTemplate } from '../snl-macro/types'
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'
import type { TreePath } from './interaction-driver'
import type { ForeignBoxMetrics } from './foreign-box'
import type { SnlBlockRenderer } from './hooks'

export interface FixedFormulaEmbedPolicy {
  readonly totalHeightEm: number
  readonly baselineRatio: number
  readonly dynamicMeasurement: boolean
}

export interface FixedFormulaMetrics {
  readonly widthEm: number
  readonly heightEm: number
  readonly depthEm: number
  readonly totalHeightEm: number
}

export interface FormulaForeignCandidate {
  readonly node: SnlSyntaxTree
  readonly template: SnlBlockMacroTemplate
  readonly treePath: TreePath
  readonly dynamicArity: boolean
  readonly signal?: AbortSignal
}

export interface FormulaForeignResolution {
  readonly identity: string
  readonly metrics: FixedFormulaMetrics
  readonly rendererKey: string
  readonly producer: string
  readonly generation: number
  readonly accessibilityLabel: string
  readonly dynamicMetrics?: boolean
  /** Generic block layout policy. Omitted by the fixed SVG capability. */
  readonly layout?: GenericFormulaLayoutPolicy
}

export type GenericFormulaWidth = 'intrinsic' | { readonly px: number }
export type GenericFormulaOverflow = 'visible' | 'clip' | 'fallback-block'

export interface GenericFormulaLayoutPolicy {
  readonly width: GenericFormulaWidth
  readonly overflow: GenericFormulaOverflow
}

export interface GenericFormulaSeedMetrics {
  readonly widthEm: number
  readonly totalHeightEm: number
  readonly baselineRatio: number
}

export interface GenericFormulaBlockPreparation {
  readonly seed: GenericFormulaSeedMetrics
  readonly producer: string
  readonly generation: number
  readonly accessibilityText: string
  readonly layout: GenericFormulaLayoutPolicy
}

export interface FormulaBlockRendererOptions {
  /** Receives the exact selected TemplateSpec projection; no macro-name inference is performed. */
  readonly prepare: (candidate: FormulaForeignCandidate) => Promise<GenericFormulaBlockPreparation>
}

export interface FormulaForeignRendererCapability {
  readonly prepare: (candidate: FormulaForeignCandidate) => Promise<FormulaForeignResolution>
}

export const FORMULA_FOREIGN_RENDERER_CAPABILITY = Symbol.for('snl.formula-foreign-renderer.fixed-v1')

export type FormulaForeignCapableRenderer = {
  readonly [FORMULA_FOREIGN_RENDERER_CAPABILITY]?: FormulaForeignRendererCapability
}

export function formulaForeignCapability(renderer: unknown): FormulaForeignRendererCapability | null {
  if ((typeof renderer !== 'function' && (typeof renderer !== 'object' || renderer === null))) return null
  const capability = (renderer as FormulaForeignCapableRenderer)[FORMULA_FOREIGN_RENDERER_CAPABILITY]
  return capability && typeof capability.prepare === 'function' ? capability : null
}

function finiteNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`generic formula ${label} must be a non-negative safe integer`)
  }
  return value
}

function readGenericLayout(value: unknown): GenericFormulaLayoutPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('generic formula layout policy is required')
  }
  const record = value as Record<string, unknown>
  const rawWidth = record.width
  let width: GenericFormulaWidth
  if (rawWidth === 'intrinsic') {
    width = 'intrinsic'
  } else if (rawWidth && typeof rawWidth === 'object' && !Array.isArray(rawWidth)) {
    const entries = Object.entries(rawWidth)
    const px = (rawWidth as Record<string, unknown>).px
    if (entries.length !== 1 || entries[0]?.[0] !== 'px' || typeof px !== 'number' || !Number.isFinite(px) || px <= 0) {
      throw new TypeError('generic formula fixed width must be one positive finite px value')
    }
    width = Object.freeze({ px })
  } else {
    throw new TypeError('generic formula width must be intrinsic or fixed pixels')
  }
  const overflow = record.overflow
  if (overflow !== 'visible' && overflow !== 'clip' && overflow !== 'fallback-block') {
    throw new TypeError('generic formula overflow must be visible, clip, or fallback-block')
  }
  return Object.freeze({ width, overflow })
}

function genericFormulaMetrics(seed: GenericFormulaSeedMetrics): FixedFormulaMetrics {
  const widthEm = finitePositive(seed?.widthEm, 'seed width')
  const totalHeightEm = finitePositive(seed?.totalHeightEm, 'seed total height')
  const baselineRatio = finitePositive(seed?.baselineRatio, 'seed baseline ratio')
  if (baselineRatio >= 1) throw new TypeError('generic formula baseline ratio must be strictly between zero and one')
  const heightEm = totalHeightEm * baselineRatio
  return Object.freeze({ widthEm, totalHeightEm, heightEm, depthEm: totalHeightEm - heightEm })
}

/**
 * Return a new renderer with an explicit generic formula capability. The input
 * renderer is never mutated, so built-in singleton renderers remain ineligible.
 */
export function createFormulaBlockRenderer(
  renderer: SnlBlockRenderer,
  options: FormulaBlockRendererOptions,
): SnlBlockRenderer {
  if (typeof renderer !== 'function' || !options || typeof options.prepare !== 'function') {
    throw new TypeError('generic formula renderer and prepare callback are required')
  }
  const wrapped: SnlBlockRenderer = props => renderer(props)
  const capability: FormulaForeignRendererCapability = {
    async prepare(candidate) {
      const rendererKey = candidate.template.block_template_name
      if (typeof rendererKey !== 'string' || rendererKey.length === 0) {
        throw new TypeError('generic formula embedding requires an explicitly selected renderer key')
      }
      const prepared = await options.prepare(candidate)
      if (!prepared || typeof prepared !== 'object') throw new TypeError('generic formula preparation is required')
      const producer = prepared.producer
      if (typeof producer !== 'string' || producer.length === 0) throw new TypeError('generic formula producer must be non-empty')
      const generation = finiteNonNegativeInteger(prepared.generation, 'generation')
      const accessibilityLabel = prepared.accessibilityText
      if (typeof accessibilityLabel !== 'string' || accessibilityLabel.length === 0) {
        throw new TypeError('generic formula accessibility text must be non-empty')
      }
      const metrics = genericFormulaMetrics(prepared.seed)
      const layout = readGenericLayout(prepared.layout)
      const path = candidate.treePath.join('.')
      const layoutIdentity = layout.width === 'intrinsic' ? 'intrinsic' : `px:${layout.width.px}`
      const identity = `generic:${encodeURIComponent(rendererKey)}:${path}:${encodeURIComponent(producer)}:${generation}:${layoutIdentity}:${layout.overflow}`
      return Object.freeze({
        identity, metrics, rendererKey, producer, generation, accessibilityLabel,
        dynamicMetrics: true, layout,
      })
    },
  }
  Object.defineProperty(wrapped, FORMULA_FOREIGN_RENDERER_CAPABILITY, {
    configurable: false, enumerable: false, writable: false, value: Object.freeze(capability),
  })
  return wrapped
}

interface FormulaEmbedRecord {
  readonly total_height_em?: unknown
  readonly baseline_ratio?: unknown
  readonly measurement?: unknown
}

function finitePositive(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`SVG formula ${label} must be a positive finite number`)
  }
  return value
}

export function readFixedFormulaEmbedPolicy(template: SnlBlockMacroTemplate): FixedFormulaEmbedPolicy {
  const svg = template.svg_template
  if (!svg || typeof svg !== 'object' || Array.isArray(svg)) {
    throw new TypeError('SVG formula embedding requires a complete svg_template projection')
  }
  const raw = (svg as Record<string, unknown>).formula_embed
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('SVG formula embedding requires a trusted formula_embed policy')
  }
  const record = raw as FormulaEmbedRecord
  const totalHeightEm = finitePositive(record.total_height_em, 'total_height_em')
  const baselineRatio = finitePositive(record.baseline_ratio, 'baseline_ratio')
  if (baselineRatio >= 1) throw new TypeError('SVG formula baseline_ratio must be strictly between zero and one')
  if (record.measurement !== undefined && record.measurement !== 'fixed' && record.measurement !== 'bounded') {
    throw new TypeError('SVG formula measurement must be fixed or bounded')
  }
  return Object.freeze({ totalHeightEm, baselineRatio, dynamicMeasurement: record.measurement === 'bounded' })
}

function parseViewBox(viewBox: string): readonly [number, number, number, number] {
  const values = viewBox.trim().split(/[\s,]+/).map(Number)
  if (values.length !== 4 || values.some(value => !Number.isFinite(value)) || values[2] <= 0 || values[3] <= 0) {
    throw new TypeError('sanitized SVG formula viewBox must contain four finite numbers with positive width and height')
  }
  return values as unknown as readonly [number, number, number, number]
}

export function deriveFixedFormulaMetrics(viewBox: string, policy: FixedFormulaEmbedPolicy): FixedFormulaMetrics {
  const [, , width, height] = parseViewBox(viewBox)
  const totalHeightEm = finitePositive(policy.totalHeightEm, 'total height')
  const baselineRatio = finitePositive(policy.baselineRatio, 'baseline ratio')
  if (baselineRatio >= 1) throw new TypeError('SVG formula baseline ratio must be strictly between zero and one')
  return Object.freeze({
    widthEm: totalHeightEm * width / height,
    heightEm: totalHeightEm * baselineRatio,
    depthEm: totalHeightEm * (1 - baselineRatio),
    totalHeightEm,
  })
}

function texNumber(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw new TypeError('formula foreign metrics must be finite and non-negative')
  return Number(value.toFixed(8)).toString()
}

export function formulaForeignMarkerId(identity: string): string {
  if (typeof identity !== 'string' || identity.length === 0) throw new TypeError('formula foreign identity must be non-empty')
  let encoded = ''
  for (let index = 0; index < identity.length; index += 1) encoded += identity.charCodeAt(index).toString(16).padStart(4, '0')
  return `ff-${encoded}`
}

function escapeFormulaFallbackText(value: string): string {
  const replacements: Readonly<Record<string, string>> = {
    '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '$': '\\$',
    '&': '\\&', '#': '\\#', '%': '\\%', '_': '\\_', '^': '\\^{}', '~': '\\~{}',
  }
  return value.replace(/[\\{}$&#%_^~]/g, character => replacements[character])
}

export function formulaForeignMarkerLatex(identity: string, metrics: FixedFormulaMetrics, fallbackText?: string): string {
  const id = formulaForeignMarkerId(identity)
  const width = texNumber(metrics.widthEm)
  const depth = texNumber(metrics.depthEm)
  const total = texNumber(metrics.totalHeightEm)
  if (metrics.heightEm <= 0 || Math.abs(metrics.heightEm + metrics.depthEm - metrics.totalHeightEm) > 1e-7) {
    throw new TypeError('formula foreign height and depth must compose the total height')
  }
  const fallback = fallbackText === undefined
    ? ''
    : `\\htmlClass{snlFormulaForeignFallbackText}{\\rlap{\\text{${escapeFormulaFallbackText(fallbackText)}}}}`
  return `\\htmlData{snl-formula-foreign-marker=${id}}{\\htmlClass{snlFormulaForeignMarker}{\\color{transparent}{\\rule[-${depth}em]{${width}em}{${total}em}${fallback}}}}`
}

export interface FormulaReservedPixels {
  readonly width: number
  readonly totalHeight: number
}

export function deriveConvergedFormulaMetrics(
  current: FixedFormulaMetrics,
  reservedPx: FormulaReservedPixels,
  intrinsicPx: ForeignBoxMetrics,
): FixedFormulaMetrics {
  const reservedWidth = finitePositive(reservedPx.width, 'reserved pixel width')
  const reservedHeight = finitePositive(reservedPx.totalHeight, 'reserved pixel height')
  const intrinsicWidth = finitePositive(intrinsicPx.width, 'intrinsic pixel width')
  const intrinsicHeight = finitePositive(intrinsicPx.height + intrinsicPx.depth, 'intrinsic pixel height')
  const seedWidth = finitePositive(current.widthEm, 'current width')
  const seedTotal = finitePositive(current.totalHeightEm, 'current total height')
  const baselineRatio = finitePositive(current.heightEm / seedTotal, 'current baseline ratio')
  if (baselineRatio >= 1) throw new TypeError('formula convergence baseline ratio must be strictly between zero and one')
  const widthEm = seedWidth * intrinsicWidth / reservedWidth
  const totalHeightEm = seedTotal * intrinsicHeight / reservedHeight
  const heightEm = totalHeightEm * baselineRatio
  return Object.freeze({ widthEm, heightEm, depthEm: totalHeightEm - heightEm, totalHeightEm })
}
