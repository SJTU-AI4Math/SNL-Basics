export type ForeignBoxBaseline = 'alphabetic' | 'axis-center' | 'bottom'

export interface ForeignBoxMetrics {
  readonly width: number
  readonly height: number
  readonly depth: number
  readonly baseline: ForeignBoxBaseline
}

/** Complete authority identity for one foreign subtree producer. */
export interface ForeignBoxIdentity {
  readonly treePath: string
  readonly generation: number
  /** Renderer/template/asset identity including its revision. */
  readonly producer: string
}

const BASELINES: ReadonlySet<string> = new Set(['alphabetic', 'axis-center', 'bottom'])

export function assertForeignBoxMetrics(metrics: ForeignBoxMetrics): ForeignBoxMetrics {
  for (const [name, value] of [['width', metrics.width], ['height', metrics.height], ['depth', metrics.depth]] as const) {
    if (!Number.isFinite(value) || value < 0) throw new TypeError(`ForeignBox ${name} must be finite and nonnegative`)
  }
  if (!BASELINES.has(metrics.baseline)) throw new TypeError('ForeignBox baseline is invalid')
  return { width: metrics.width, height: metrics.height, depth: metrics.depth, baseline: metrics.baseline }
}

export function foreignBoxIdentityKey(identity: ForeignBoxIdentity): string {
  if (typeof identity.treePath !== 'string' || identity.treePath.length === 0) throw new TypeError('ForeignBox treePath is required')
  if (!Number.isSafeInteger(identity.generation) || identity.generation < 0) throw new TypeError('ForeignBox generation must be a nonnegative safe integer')
  if (typeof identity.producer !== 'string' || identity.producer.length === 0) throw new TypeError('ForeignBox producer identity is required')
  return JSON.stringify([identity.treePath, identity.generation, identity.producer])
}
