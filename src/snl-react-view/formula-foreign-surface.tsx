import { useEffect, useLayoutEffect, type ReactElement, type ReactNode } from 'react'
import type { FormulaForeignPlan } from './render-source'
import { ForeignBoxFallback, useForeignBox } from './use-foreign-box'

const useSsrSafeLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export interface FormulaForeignSurfaceProps {
  readonly plan: FormulaForeignPlan
  readonly marker: HTMLElement
  readonly widthPx: number
  readonly heightPx: number
  readonly child: ReactNode
}

/**
 * Mount one fixed-metric React surface over a KaTeX-owned marker. The marker's
 * committed viewport size is authoritative for script/numerator/limit scaling;
 * authored values never become CSS pixels directly.
 */
export function FormulaForeignSurface({ plan, marker, widthPx, heightPx, child }: FormulaForeignSurfaceProps): ReactElement {
  const surface = (
    <div
      className="snl-formula-foreign-surface"
      style={{ width: `${widthPx}px`, height: `${heightPx}px` }}
      data-snl-formula-foreign-surface={plan.identity}
    >
      {child}
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
  })
  useSsrSafeLayoutEffect(() => {
    marker.setAttribute('aria-hidden', 'true')
    marker.setAttribute('role', 'presentation')
    foreign.markerRef(marker)
    return () => {
      foreign.markerRef(null)
      if (marker.isConnected) {
        marker.removeAttribute('aria-hidden')
        marker.removeAttribute('role')
      }
    }
  }, [foreign.markerRef, marker])
  return (
    <ForeignBoxFallback foreign={foreign} as="span" className="snl-formula-foreign-fallback">
      <span role="img" aria-label={plan.accessibilityLabel}>{plan.accessibilityLabel}</span>
    </ForeignBoxFallback>
  )
}
