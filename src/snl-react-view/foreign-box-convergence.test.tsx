import { describe, expect, it, vi } from 'vitest'
import { deriveConvergedFormulaMetrics } from './formula-foreign-box'
import {
  createForeignBoxConvergenceController,
  type ForeignBoxMetricReport,
} from './foreign-box'

function report(slot: string, epoch: number, width: number, height = 20): ForeignBoxMetricReport {
  return {
    authority: { treePath: slot, generation: 3, producer: 'asset:r1', metricEpoch: epoch },
    metrics: { width, height, depth: 0, baseline: 'bottom' },
  }
}

describe('bounded foreign-box convergence', () => {
  it('converts intrinsic pixels through calibrated reserved geometry while preserving baseline split', () => {
    expect(deriveConvergedFormulaMetrics(
      { widthEm: 2, heightEm: 1.5, depthEm: 0.5, totalHeightEm: 2 },
      { width: 40, totalHeight: 20 },
      { width: 80, height: 30, depth: 0, baseline: 'bottom' },
    )).toEqual({ widthEm: 4, heightEm: 2.25, depthEm: 0.75, totalHeightEm: 3 })
  })

  it('ignores stale reports and deltas no larger than half a pixel', () => {
    const frames: Array<() => void> = []
    const commits: ForeignBoxMetricReport[][] = []
    const controller = createForeignBoxConvergenceController({
      scheduleFrame: callback => { frames.push(callback); return frames.length },
      cancelFrame: vi.fn(),
      onCommit: batch => commits.push([...batch]),
      onFallback: vi.fn(),
    })
    controller.beginEpoch(9, [report('0', 9, 20)])

    controller.report(report('0', 8, 80))
    controller.report(report('0', 9, 20.5))

    expect(frames).toEqual([])
    expect(commits).toEqual([])
  })

  it('fails closed on an A to B to A oscillation', () => {
    const frames: Array<() => void> = []
    const fallbacks: Array<[string, string]> = []
    const controller = createForeignBoxConvergenceController({
      scheduleFrame: callback => { frames.push(callback); return frames.length },
      cancelFrame: vi.fn(),
      onCommit: vi.fn(),
      onFallback: (authority, reason) => fallbacks.push([authority.treePath, reason]),
    })
    controller.beginEpoch(9, [report('0', 9, 20)])
    controller.report(report('0', 9, 40))
    frames.shift()!()

    controller.report(report('0', 9, 20))

    expect(fallbacks).toEqual([['0', 'oscillation']])
    expect(frames).toEqual([])
  })

  it('caps convergence iterations and resets the budget for a new metric epoch', () => {
    const frames: Array<() => void> = []
    const fallbacks: string[] = []
    const controller = createForeignBoxConvergenceController({
      scheduleFrame: callback => { frames.push(callback); return frames.length },
      cancelFrame: vi.fn(),
      onCommit: vi.fn(),
      onFallback: (_authority, reason) => fallbacks.push(reason),
      maxIterations: 2,
    })
    controller.beginEpoch(9, [report('0', 9, 20)])
    controller.report(report('0', 9, 30)); frames.shift()!()
    controller.report(report('0', 9, 40)); frames.shift()!()
    controller.report(report('0', 9, 50))
    expect(fallbacks).toEqual(['iteration-cap'])
    expect(frames).toEqual([])

    controller.beginEpoch(10, [report('0', 10, 50)])
    controller.report(report('0', 10, 60))
    expect(frames).toHaveLength(1)
  })

  it('continues while the committed reservation differs from unchanged intrinsic content', () => {
    const frames: Array<() => void> = []
    const commits: ForeignBoxMetricReport[][] = []
    const controller = createForeignBoxConvergenceController({
      scheduleFrame: callback => { frames.push(callback); return frames.length },
      cancelFrame: vi.fn(),
      onCommit: batch => commits.push([...batch]),
      onFallback: vi.fn(),
    })
    controller.beginEpoch(12, [report('0', 12, 20)])
    controller.report({ ...report('0', 12, 40), reserved: { width: 20, totalHeight: 10 } })
    frames.shift()!()
    controller.report({ ...report('0', 12, 40), reserved: { width: 41, totalHeight: 10 } })
    frames.shift()!()
    controller.report({ ...report('0', 12, 40), reserved: { width: 40, totalHeight: 10 } })
    expect(commits).toHaveLength(2)
  })

  it('caps an identity introduced after epoch seeding at four commits', () => {
    const frames: Array<() => void> = []
    const fallbacks: string[] = []
    const controller = createForeignBoxConvergenceController({
      scheduleFrame: callback => { frames.push(callback); return frames.length },
      cancelFrame: vi.fn(),
      onCommit: vi.fn(),
      onFallback: (_authority, reason) => fallbacks.push(reason),
      maxIterations: 4,
    })
    controller.beginEpoch(9, [])
    for (const width of [10, 20, 30, 40]) {
      controller.report(report('late', 9, width))
      frames.shift()!()
    }
    controller.report(report('late', 9, 50))
    expect(fallbacks).toEqual(['iteration-cap'])
    expect(frames).toEqual([])
  })

  it('ignores zero-sized convergence observations instead of committing invalid ratios', () => {
    const frames: Array<() => void> = []
    const commits = vi.fn()
    const controller = createForeignBoxConvergenceController({
      scheduleFrame: callback => { frames.push(callback); return frames.length },
      cancelFrame: vi.fn(),
      onCommit: commits,
      onFallback: vi.fn(),
    })
    controller.beginEpoch(3, [report('zero', 3, 20)])
    controller.report({ ...report('zero', 3, 0), reserved: { width: 20, totalHeight: 10 } })
    controller.report({ ...report('zero', 3, 20), reserved: { width: 0, totalHeight: 0 } })
    expect(frames).toEqual([])
    expect(commits).not.toHaveBeenCalled()
  })

  it('rejects stale observation revisions inside the same semantic metric epoch', () => {
    const frames: Array<() => void> = []
    const commits = vi.fn()
    const controller = createForeignBoxConvergenceController({
      scheduleFrame: callback => { frames.push(callback); return frames.length },
      cancelFrame: vi.fn(), onCommit: commits, onFallback: vi.fn(),
    })
    controller.beginEpoch(13, [{ ...report('0', 13, 20), observationEpoch: 1 }])
    controller.report({ ...report('0', 13, 40), observationEpoch: 2 })
    frames.shift()!()
    controller.report({ ...report('0', 13, 80), observationEpoch: 1 })
    expect(frames).toEqual([])
    expect(commits).toHaveBeenCalledTimes(1)
  })

  it('rejects a canceled prior-epoch frame even if the scheduler later invokes it', () => {
    const frames: Array<() => void> = []
    const commits = vi.fn()
    const controller = createForeignBoxConvergenceController({
      scheduleFrame: callback => { frames.push(callback); return frames.length },
      cancelFrame: vi.fn(), onCommit: commits, onFallback: vi.fn(),
    })
    controller.beginEpoch(20, [report('0', 20, 20)])
    controller.report(report('0', 20, 40))
    const stale = frames.shift()!
    controller.beginEpoch(21, [report('0', 21, 20)])
    controller.report(report('0', 21, 50))
    const current = frames.shift()!
    stale()
    expect(commits).not.toHaveBeenCalled()
    current()
    expect(commits).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending frame and rejects writes after disposal', () => {
    const frames: Array<() => void> = []
    const cancelFrame = vi.fn()
    const onCommit = vi.fn()
    const controller = createForeignBoxConvergenceController({
      scheduleFrame: callback => { frames.push(callback); return 77 },
      cancelFrame,
      onCommit,
      onFallback: vi.fn(),
    })
    controller.beginEpoch(9, [report('0', 9, 20)])
    controller.report(report('0', 9, 40))
    controller.dispose()
    controller.report(report('0', 9, 60))
    frames.shift()!()
    expect(cancelFrame).toHaveBeenCalledWith(77)
    expect(onCommit).not.toHaveBeenCalled()

    controller.activate()
    controller.beginEpoch(10, [report('0', 10, 20)])
    controller.report(report('0', 10, 40))
    expect(frames).toHaveLength(1)
  })

  it('batches sibling metric changes into one source-ordered frame commit', () => {
    const frames: Array<() => void> = []
    const commits: ForeignBoxMetricReport[][] = []
    const controller = createForeignBoxConvergenceController({
      scheduleFrame: callback => { frames.push(callback); return frames.length },
      cancelFrame: vi.fn(),
      onCommit: batch => commits.push([...batch]),
      onFallback: vi.fn(),
    })
    controller.beginEpoch(9, [report('0', 9, 20), report('1', 9, 30)])

    controller.report(report('1', 9, 50))
    controller.report(report('0', 9, 40))

    expect(frames).toHaveLength(1)
    expect(commits).toEqual([])
    frames.shift()!()
    expect(commits).toHaveLength(1)
    expect(commits[0].map(item => [item.authority.treePath, item.metrics.width])).toEqual([
      ['0', 40],
      ['1', 50],
    ])
  })
})
