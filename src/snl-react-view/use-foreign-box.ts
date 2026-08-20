import { useLayoutEffect, useMemo, type ReactNode } from 'react'
import type { ForeignBoxIdentity, ForeignBoxMetrics } from './foreign-box'
import { foreignBoxIdentityKey } from './foreign-box'
import { useForeignBoxRegistry, type ForeignBoxRegistration } from './foreign-box-host'

export interface UseForeignBoxOptions {
  readonly identity: ForeignBoxIdentity
  readonly child: ReactNode
  readonly onMetrics?: (metrics: ForeignBoxMetrics) => void
  readonly onUnregister?: () => void
}

export interface UseForeignBoxResult {
  readonly markerRef: (marker: HTMLElement | SVGElement | null) => void
  readonly reportMetrics: (metrics: ForeignBoxMetrics) => void
  readonly isAlive: () => boolean
}

export function useForeignBox(options: UseForeignBoxOptions): UseForeignBoxResult {
  const registry = useForeignBoxRegistry()
  const identityKey = foreignBoxIdentityKey(options.identity)
  const holder = useMemo(() => ({
    registration: null as ForeignBoxRegistration | null,
    marker: null as HTMLElement | SVGElement | null,
  }), [identityKey])

  useLayoutEffect(() => {
    const registration = registry.register(options)
    holder.registration = registration
    registration.setMarker(holder.marker)
    return () => {
      registration.unregister()
      if (holder.registration === registration) holder.registration = null
    }
  }, [registry, identityKey, options.child, options.onMetrics, options.onUnregister, holder])

  return useMemo(() => ({
    markerRef(marker: HTMLElement | SVGElement | null) {
      holder.marker = marker
      holder.registration?.setMarker(marker)
    },
    reportMetrics(metrics: ForeignBoxMetrics) {
      holder.registration?.reportMetrics(metrics)
    },
    isAlive() {
      return holder.registration?.isAlive() ?? false
    },
  }), [holder])
}
