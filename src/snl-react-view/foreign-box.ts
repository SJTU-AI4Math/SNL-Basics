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

export function snapshotForeignBoxIdentity(identity: ForeignBoxIdentity): ForeignBoxIdentity {
  const treePath = identity.treePath
  const generation = identity.generation
  const producer = identity.producer
  if (typeof treePath !== 'string') throw new TypeError('ForeignBox treePath must be a string')
  if (!Number.isSafeInteger(generation) || generation < 0) throw new TypeError('ForeignBox generation must be a nonnegative safe integer')
  if (typeof producer !== 'string' || producer.length === 0) throw new TypeError('ForeignBox producer identity is required')
  return Object.freeze({ treePath, generation, producer })
}

export function assertForeignBoxMetrics(metrics: ForeignBoxMetrics): ForeignBoxMetrics {
  const width = metrics.width
  const height = metrics.height
  const depth = metrics.depth
  const baseline = metrics.baseline
  for (const [name, value] of [['width', width], ['height', height], ['depth', depth]] as const) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new TypeError(`ForeignBox ${name} must be finite and nonnegative`)
  }
  if (typeof baseline !== 'string' || !BASELINES.has(baseline)) throw new TypeError('ForeignBox baseline is invalid')
  return Object.freeze({ width, height, depth, baseline })
}

export function foreignBoxIdentityKey(identity: ForeignBoxIdentity): string {
  const snapshot = snapshotForeignBoxIdentity(identity)
  return JSON.stringify([snapshot.treePath, snapshot.generation, snapshot.producer])
}
