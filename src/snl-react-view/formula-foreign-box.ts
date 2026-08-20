import type { SnlBlockMacroTemplate } from '../snl-macro/types'
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'
import type { TreePath } from './interaction-driver'
import type { ForeignBoxMetrics } from './foreign-box'

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

export function formulaForeignMarkerLatex(identity: string, metrics: FixedFormulaMetrics): string {
  const id = formulaForeignMarkerId(identity)
  const width = texNumber(metrics.widthEm)
  const depth = texNumber(metrics.depthEm)
  const total = texNumber(metrics.totalHeightEm)
  if (metrics.heightEm <= 0 || Math.abs(metrics.heightEm + metrics.depthEm - metrics.totalHeightEm) > 1e-7) {
    throw new TypeError('formula foreign height and depth must compose the total height')
  }
  return `\\htmlData{snl-formula-foreign-marker=${id}}{\\htmlClass{snlFormulaForeignMarker}{\\color{transparent}{\\rule[-${depth}em]{${width}em}{${total}em}}}}`
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
