export type ForeignBoxBaseline = 'alphabetic' | 'axis-center' | 'bottom'

export interface ForeignBoxMetrics {
  readonly width: number
  readonly height: number
  readonly depth: number
  readonly baseline: ForeignBoxBaseline
}

/** Complete authority identity for one foreign subtree producer. */
export interface ForeignBoxIdentity {
  /** Canonical semantic syntax-tree path shared by every visual occurrence. */
  readonly treePath: string
  /** Optional visual-placement discriminator for repeated projections of one semantic node. */
  readonly placement?: string
  readonly generation: number
  /** Renderer/template/asset identity including its revision. */
  readonly producer: string
}

const BASELINES: ReadonlySet<string> = new Set(['alphabetic', 'axis-center', 'bottom'])

export function snapshotForeignBoxIdentity(identity: ForeignBoxIdentity): ForeignBoxIdentity {
  const treePath = identity.treePath
  const placement = identity.placement
  const generation = identity.generation
  const producer = identity.producer
  if (typeof treePath !== 'string') throw new TypeError('ForeignBox treePath must be a string')
  if (placement !== undefined && (typeof placement !== 'string' || placement.length === 0)) throw new TypeError('ForeignBox placement identity must be a nonempty string')
  if (!Number.isSafeInteger(generation) || generation < 0) throw new TypeError('ForeignBox generation must be a nonnegative safe integer')
  if (typeof producer !== 'string' || producer.length === 0) throw new TypeError('ForeignBox producer identity is required')
  return Object.freeze({ treePath, ...(placement === undefined ? {} : { placement }), generation, producer })
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
  return snapshot.placement === undefined
    ? JSON.stringify([snapshot.treePath, snapshot.generation, snapshot.producer])
    : JSON.stringify([snapshot.treePath, snapshot.placement, snapshot.generation, snapshot.producer])
}

export interface ForeignBoxMetricAuthority extends ForeignBoxIdentity {
  readonly metricEpoch: number
}

export interface ForeignBoxMetricReport {
  readonly authority: ForeignBoxMetricAuthority
  readonly metrics: ForeignBoxMetrics
  readonly observationEpoch?: number
  readonly reserved?: Readonly<{ width: number; totalHeight: number }>
}

export interface ForeignBoxConvergenceController {
  activate(): void
  beginEpoch(metricEpoch: number, initial: readonly ForeignBoxMetricReport[]): void
  report(report: ForeignBoxMetricReport): void
  remove(identity: ForeignBoxIdentity): void
  dispose(): void
}

export interface ForeignBoxConvergenceOptions {
  readonly scheduleFrame: (callback: () => void) => number
  readonly cancelFrame: (handle: number) => void
  readonly onCommit: (batch: readonly ForeignBoxMetricReport[]) => void
  readonly onFallback: (authority: ForeignBoxMetricAuthority, reason: 'oscillation' | 'iteration-cap', samples?: readonly ForeignBoxMetrics[]) => void
  readonly thresholdPx?: number
  readonly maxIterations?: number
}

function snapshotMetricReport(report: ForeignBoxMetricReport): ForeignBoxMetricReport {
  const identity = snapshotForeignBoxIdentity(report.authority)
  const metricEpoch = report.authority.metricEpoch
  if (!Number.isSafeInteger(metricEpoch) || metricEpoch < 0) throw new TypeError('ForeignBox metricEpoch must be a nonnegative safe integer')
  const observationEpoch = report.observationEpoch ?? 0
  if (!Number.isSafeInteger(observationEpoch) || observationEpoch < 0) throw new TypeError('ForeignBox observationEpoch must be a nonnegative safe integer')
  const reserved = report.reserved
  if (reserved && (!(typeof reserved.width === 'number' && Number.isFinite(reserved.width) && reserved.width >= 0)
    || !(typeof reserved.totalHeight === 'number' && Number.isFinite(reserved.totalHeight) && reserved.totalHeight >= 0))) {
    throw new TypeError('ForeignBox reserved metrics must be finite and nonnegative')
  }
  return Object.freeze({
    authority: Object.freeze({ ...identity, metricEpoch }),
    metrics: assertForeignBoxMetrics(report.metrics),
    observationEpoch,
    ...(reserved ? { reserved: Object.freeze({ width: reserved.width, totalHeight: reserved.totalHeight }) } : {}),
  })
}

function compareTreePaths(left: string, right: string): number {
  const parse = (value: string): number[] | null => {
    if (value === '') return []
    const segments = value.split(/[./]/)
    return segments.every(segment => /^(0|[1-9]\d*)$/.test(segment)) ? segments.map(Number) : null
  }
  const a = parse(left)
  const b = parse(right)
  if (!a || !b) return left.localeCompare(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (index >= a.length) return -1
    if (index >= b.length) return 1
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return left.localeCompare(right)
}

export function createForeignBoxConvergenceController(options: ForeignBoxConvergenceOptions): ForeignBoxConvergenceController {
  let active = true
  let epoch = -1
  let frame: number | null = null
  let frameGeneration = 0
  const pending = new Map<string, ForeignBoxMetricReport>()
  const committed = new Map<string, ForeignBoxMetricReport>()
  const history = new Map<string, ForeignBoxMetrics[]>()
  const iterations = new Map<string, number>()
  const unstable = new Set<string>()
  const latestObservationEpoch = new Map<string, number>()
  const thresholdPx = options.thresholdPx ?? 0.5
  if (!Number.isFinite(thresholdPx) || thresholdPx < 0) throw new TypeError('ForeignBox convergence threshold must be finite and nonnegative')
  const maxIterations = options.maxIterations ?? 4
  if (!Number.isSafeInteger(maxIterations) || maxIterations <= 0) throw new TypeError('ForeignBox convergence iteration cap must be a positive safe integer')

  const withinThreshold = (left: ForeignBoxMetrics, right: ForeignBoxMetrics): boolean =>
    Math.abs(left.width - right.width) <= thresholdPx
    && Math.abs(left.height - right.height) <= thresholdPx
    && Math.abs(left.depth - right.depth) <= thresholdPx

  const convergenceSample = (report: ForeignBoxMetricReport): ForeignBoxMetrics => report.reserved
    ? { width: report.reserved.width, height: report.reserved.totalHeight, depth: 0, baseline: 'bottom' }
    : report.metrics
  const reservationMatchesIntrinsic = (report: ForeignBoxMetricReport): boolean => Boolean(report.reserved
    && Math.abs(report.reserved.width - report.metrics.width) <= thresholdPx
    && Math.abs(report.reserved.totalHeight - report.metrics.height - report.metrics.depth) <= thresholdPx)

  const flush = () => {
    frame = null
    if (!active || pending.size === 0) return
    const batch = [...pending.values()].sort((left, right) => compareTreePaths(left.authority.treePath, right.authority.treePath))
    pending.clear()
    for (const report of batch) {
      const key = foreignBoxIdentityKey(report.authority)
      committed.set(key, report)
      const samples = history.get(key) ?? []
      samples.push(convergenceSample(report))
      history.set(key, samples)
      iterations.set(key, (iterations.get(key) ?? 0) + 1)
    }
    options.onCommit(batch)
  }

  const scheduleFlush = () => {
    const generation = frameGeneration
    let handle = 0
    handle = options.scheduleFrame(() => {
      if (generation !== frameGeneration || frame !== handle) return
      flush()
    })
    frame = handle
  }

  return {
    activate() {
      if (active) return
      active = true
      frameGeneration += 1
      epoch = -1
      frame = null
      pending.clear()
      committed.clear()
      history.clear()
      iterations.clear()
      unstable.clear()
      latestObservationEpoch.clear()
    },
    beginEpoch(metricEpoch, initial) {
      if (!active) return
      frameGeneration += 1
      if (!Number.isSafeInteger(metricEpoch) || metricEpoch < 0) throw new TypeError('ForeignBox metric epoch must be a nonnegative safe integer')
      if (frame !== null) options.cancelFrame(frame)
      frame = null
      pending.clear()
      committed.clear()
      history.clear()
      iterations.clear()
      unstable.clear()
      latestObservationEpoch.clear()
      epoch = metricEpoch
      for (const value of initial) {
        const report = snapshotMetricReport(value)
        if (report.authority.metricEpoch === metricEpoch) {
          const key = foreignBoxIdentityKey(report.authority)
          committed.set(key, report)
          latestObservationEpoch.set(key, report.observationEpoch ?? 0)
          history.set(key, [report.metrics])
          iterations.set(key, 0)
        }
      }
    },
    report(value) {
      if (!active) return
      const report = snapshotMetricReport(value)
      if (report.authority.metricEpoch !== epoch) return
      if (report.metrics.width <= 0 || report.metrics.height + report.metrics.depth <= 0
        || (report.reserved && (report.reserved.width <= 0 || report.reserved.totalHeight <= 0))) return
      const key = foreignBoxIdentityKey(report.authority)
      const observedAt = report.observationEpoch ?? 0
      const latestObservedAt = latestObservationEpoch.get(key) ?? 0
      if (observedAt < latestObservedAt) return
      if (observedAt > latestObservedAt) {
        latestObservationEpoch.set(key, observedAt)
        pending.delete(key)
      }
      if (unstable.has(key)) return
      if (reservationMatchesIntrinsic(report)) return
      const baseline = pending.get(key) ?? committed.get(key)
      if (!report.reserved && baseline && withinThreshold(baseline.metrics, report.metrics)) return
      if (report.reserved && baseline?.reserved
        && withinThreshold(baseline.metrics, report.metrics)
        && Math.abs(baseline.reserved.width - report.reserved.width) <= thresholdPx
        && Math.abs(baseline.reserved.totalHeight - report.reserved.totalHeight) <= thresholdPx) return
      const sample = convergenceSample(report)
      const samples = history.get(key) ?? []
      const previous = samples.at(-1)
      const beforePrevious = samples.at(-2)
      if (previous && beforePrevious
        && !withinThreshold(previous, sample)
        && withinThreshold(beforePrevious, sample)) {
        pending.delete(key)
        unstable.add(key)
        options.onFallback(report.authority, 'oscillation', [...samples, sample])
        return
      }
      if ((iterations.get(key) ?? 0) >= maxIterations) {
        pending.delete(key)
        unstable.add(key)
        options.onFallback(report.authority, 'iteration-cap', [...(history.get(key) ?? []), report.metrics])
        return
      }
      pending.set(key, report)
      if (frame === null) scheduleFlush()
    },
    remove(identity) {
      const key = foreignBoxIdentityKey(identity)
      pending.delete(key)
      committed.delete(key)
      history.delete(key)
      iterations.delete(key)
      unstable.delete(key)
      latestObservationEpoch.delete(key)
    },
    dispose() {
      if (!active) return
      active = false
      frameGeneration += 1
      if (frame !== null) options.cancelFrame(frame)
      frame = null
      pending.clear()
      committed.clear()
      history.clear()
      iterations.clear()
      unstable.clear()
      latestObservationEpoch.clear()
    },
  }
}
