import { useEffect, useLayoutEffect, useRef, type ReactElement, type ReactNode } from 'react'
import type { ForeignBoxMetricReport, ForeignBoxMetrics } from './foreign-box'
import type { FormulaForeignPlan } from './render-source'
import { ForeignBoxFallback, useForeignBox } from './use-foreign-box'

const useSsrSafeLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export interface FormulaForeignSurfaceProps {
  readonly plan: FormulaForeignPlan
  readonly marker: HTMLElement
  readonly widthPx: number
  readonly heightPx: number
  readonly child: ReactNode
  readonly metricEpoch?: number
  readonly observationEpoch?: number
  readonly onMetricReport?: (report: ForeignBoxMetricReport) => void
}

/**
 * Mount one fixed-metric React surface over a KaTeX-owned marker. The marker's
 * committed viewport size is authoritative for script/numerator/limit scaling;
 * authored values never become CSS pixels directly.
 */
export function FormulaForeignSurface({ plan, marker, widthPx, heightPx, child, metricEpoch = 0, observationEpoch = 0, onMetricReport }: FormulaForeignSurfaceProps): ReactElement {
  // The marker geometry is calibrated in viewport pixels, but this surface is
  // authored in the marker's transformed local coordinate space.
  const localWidthPx = marker.offsetWidth > 0 ? marker.offsetWidth : widthPx
  const localHeightPx = marker.offsetHeight > 0 ? marker.offsetHeight : heightPx
  const latestIntrinsicRef = useRef<ForeignBoxMetrics | null>(null)
  useSsrSafeLayoutEffect(() => { latestIntrinsicRef.current = null }, [metricEpoch])
  const publishMetricReport = onMetricReport
    ? (report: ForeignBoxMetricReport) => {
        latestIntrinsicRef.current = report.metrics
        onMetricReport({ ...report, reserved: { width: widthPx, totalHeight: heightPx } })
      }
    : undefined
  const genericLayout = plan.layout
  const surfaceStyle = genericLayout
    ? genericLayout.width === 'intrinsic'
      ? { width: 'max-content', height: 'max-content', minHeight: `${localHeightPx}px`, overflow: genericLayout.overflow === 'clip' ? 'clip' : 'visible' }
      : { width: `${genericLayout.width.px}px`, minWidth: `${genericLayout.width.px}px`, maxWidth: `${genericLayout.width.px}px`, height: 'max-content', minHeight: `${localHeightPx}px`, overflow: genericLayout.overflow === 'clip' ? 'clip' : 'visible' }
    : { minWidth: `${localWidthPx}px`, minHeight: `${localHeightPx}px` }
  const intrinsicStyle = !onMetricReport
    ? { display: 'contents' as const }
    : genericLayout && genericLayout.width !== 'intrinsic'
      ? {
          width: `${genericLayout.width.px}px`, minWidth: `${genericLayout.width.px}px`, maxWidth: `${genericLayout.width.px}px`,
          height: 'max-content', overflow: genericLayout.overflow === 'clip' ? 'clip' : 'visible',
        }
      : { width: 'max-content', height: 'max-content' }
  const surface = (
    <div
      className="snl-formula-foreign-surface"
      style={surfaceStyle}
      data-snl-formula-foreign-surface={plan.identity}
    >
      <div
        data-snl-foreign-intrinsic={onMetricReport ? 'true' : undefined}
        style={intrinsicStyle}
      >
        {child}
      </div>
    </div>
  )
  const foreign = useForeignBox({
    identity: {
      treePath: plan.treePath.join('.'),
      generation: plan.generation,
      producer: plan.producer,
    },
    child: surface,
    ssrFallback: <span role="img" aria-label={plan.accessibilityLabel}>{plan.accessibilityLabel}</span>,
    metricEpoch,
    observationEpoch,
    onMetricReport: publishMetricReport,
  })
  useSsrSafeLayoutEffect(() => {
    const metrics = latestIntrinsicRef.current
    if (!onMetricReport || !metrics) return
    onMetricReport({
      authority: { treePath: plan.treePath.join('.'), generation: plan.generation, producer: plan.producer, metricEpoch },
      metrics,
      observationEpoch,
      reserved: { width: widthPx, totalHeight: heightPx },
    })
  }, [heightPx, metricEpoch, observationEpoch, onMetricReport, plan.generation, plan.producer, plan.treePath, widthPx])
  useSsrSafeLayoutEffect(() => {
    const accessibilityMarker = marker.closest<HTMLElement>('[data-snl-formula-foreign-marker]') ?? marker
    accessibilityMarker.setAttribute('aria-hidden', 'true')
    accessibilityMarker.setAttribute('role', 'presentation')
    foreign.markerRef(marker)
    return () => {
      foreign.markerRef(null)
      if (accessibilityMarker.isConnected) {
        accessibilityMarker.removeAttribute('aria-hidden')
        accessibilityMarker.removeAttribute('role')
      }
    }
  }, [foreign.markerRef, marker])
  return (
    <ForeignBoxFallback foreign={foreign} as={plan.layout?.overflow === 'fallback-block' ? 'div' : 'span'} className="snl-formula-foreign-fallback">
      <span role="img" aria-label={plan.accessibilityLabel}>{plan.accessibilityLabel}</span>
    </ForeignBoxFallback>
  )
}
