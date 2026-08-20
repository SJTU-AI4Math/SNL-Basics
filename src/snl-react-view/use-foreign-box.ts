import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { ForeignBoxIdentity, ForeignBoxMetrics } from './foreign-box'
import { foreignBoxIdentityKey, snapshotForeignBoxIdentity } from './foreign-box'
import { useForeignBoxRegistry, type ForeignBoxRegistration } from './foreign-box-host'

export interface UseForeignBoxOptions {
  readonly identity: ForeignBoxIdentity
  readonly child: ReactNode
  /** Accessible content rendered until the live wrapper is measured and positioned. */
  readonly ssrFallback?: ReactNode
  readonly onMetrics?: (metrics: ForeignBoxMetrics) => void
  readonly onUnregister?: () => void
}

export interface UseForeignBoxResult {
  /** Render this in the consumer tree; it remains until the live wrapper is non-inert and positioned. */
  readonly ssrFallback: ReactNode | null
  readonly markerRef: (marker: HTMLElement | SVGElement | null) => void
  readonly reportMetrics: (metrics: ForeignBoxMetrics) => void
  readonly isAlive: () => boolean
}

const useSsrSafeLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect
const subscribeToHydration = () => () => {}
const getClientSnapshot = () => true
const getServerSnapshot = () => false

export function useForeignBox(options: UseForeignBoxOptions): UseForeignBoxResult {
  const registry = useForeignBoxRegistry()
  const clientMounted = useSyncExternalStore(subscribeToHydration, getClientSnapshot, getServerSnapshot)
  const identity = snapshotForeignBoxIdentity(options.identity)
  const identityKey = foreignBoxIdentityKey(identity)
  const [positionedState, setPositionedState] = useState(() => ({ key: identityKey, positioned: false }))
  const positioned = positionedState.key === identityKey && positionedState.positioned
  const holder = useMemo(() => ({
    registration: null as ForeignBoxRegistration | null,
    marker: null as HTMLElement | SVGElement | null,
  }), [identityKey])

  useSsrSafeLayoutEffect(() => {
    const registration = registry.register({
      ...options,
      identity,
      onPositionedChange(nextPositioned) {
        setPositionedState(current => current.key === identityKey && current.positioned === nextPositioned
          ? current
          : { key: identityKey, positioned: nextPositioned })
      },
    })
    holder.registration = registration
    registration.setMarker(holder.marker)
    return () => {
      registration.unregister()
      if (holder.registration === registration) holder.registration = null
    }
  }, [registry, identityKey, holder])

  useSsrSafeLayoutEffect(() => {
    holder.registration?.update(options)
  })

  const controls = useMemo(() => ({
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

  return useMemo(() => ({
    ...controls,
    ssrFallback: clientMounted && positioned ? null : (options.ssrFallback ?? options.child),
  }), [controls, clientMounted, positioned, options.ssrFallback, options.child])
}
