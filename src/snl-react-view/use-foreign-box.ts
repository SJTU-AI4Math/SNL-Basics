import { createElement, useEffect, useInsertionEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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

export interface ForeignBoxFallbackController {
  /** Stable ref that lets the geometry callback gate the ordinary-tree fallback synchronously. */
  readonly fallbackRef: (boundary: HTMLElement | null) => void
  /** Declarative mirror of the imperative accessibility gate. */
  readonly fallbackHidden: boolean
}

export interface ForeignBoxFallbackProps {
  readonly foreign: ForeignBoxFallbackController
  /** Use `span` for inline/formula fallbacks and `div` for flow/block fallbacks. */
  readonly as?: 'span' | 'div'
  readonly children?: ReactNode
  readonly className?: string
}

/**
 * Stable SSR-safe boundary for the ordinary-tree representation of a foreign box.
 * It stays mounted with native span/div display semantics; the live geometry callback
 * toggles its hidden/inert/aria-hidden gate before mirroring the same state through React.
 */
export function ForeignBoxFallback({ foreign, as = 'span', children, className }: ForeignBoxFallbackProps) {
  return createElement(as, {
    ref: foreign.fallbackRef,
    className,
    'data-snl-foreign-box-fallback': 'true',
    hidden: foreign.fallbackHidden || undefined,
    inert: foreign.fallbackHidden || undefined,
    'aria-hidden': foreign.fallbackHidden ? 'true' : undefined,
  }, children)
}

export interface UseForeignBoxResult extends ForeignBoxFallbackController {
  /** Backward-compatible prebuilt inline boundary; prefer ForeignBoxFallback when block semantics are required. */
  readonly ssrFallback: ReactNode
  readonly markerRef: (marker: HTMLElement | SVGElement | null) => void
  readonly reportMetrics: (metrics: ForeignBoxMetrics) => void
  readonly isAlive: () => boolean
}

const useSsrSafeLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

function setFallbackHidden(boundary: HTMLElement | null, hidden: boolean): void {
  if (!boundary) return
  boundary.hidden = hidden
  if (hidden) {
    boundary.setAttribute('inert', '')
    boundary.setAttribute('aria-hidden', 'true')
  } else {
    boundary.removeAttribute('inert')
    boundary.removeAttribute('aria-hidden')
  }
}

export function useForeignBox(options: UseForeignBoxOptions): UseForeignBoxResult {
  const registry = useForeignBoxRegistry()
  const identity = snapshotForeignBoxIdentity(options.identity)
  const identityKey = foreignBoxIdentityKey(identity)
  const [positionedState, setPositionedState] = useState(() => ({ key: identityKey, positioned: false }))
  const positioned = positionedState.key === identityKey && positionedState.positioned
  const holder = useMemo(() => ({
    registration: null as ForeignBoxRegistration | null,
    marker: null as HTMLElement | SVGElement | null,
    fallback: null as HTMLElement | null,
    positioned: false,
    reactMounted: false,
    acceptsFallbackRefs: false,
  }), [identityKey])
  const currentFallbackOwner = useRef<typeof holder | null>(null)

  useInsertionEffect(() => {
    currentFallbackOwner.current = holder
    holder.acceptsFallbackRefs = true
    return () => {
      holder.acceptsFallbackRefs = false
      if (currentFallbackOwner.current === holder) currentFallbackOwner.current = null
    }
  }, [holder])

  useSsrSafeLayoutEffect(() => {
    holder.reactMounted = true
    const registration = registry.register({
      ...options,
      identity,
      onPositionedChange(nextPositioned) {
        holder.positioned = nextPositioned
        setFallbackHidden(holder.fallback, nextPositioned)
        if (holder.reactMounted) {
          setPositionedState(current => current.key === identityKey && current.positioned === nextPositioned
            ? current
            : { key: identityKey, positioned: nextPositioned })
        }
      },
    })
    holder.registration = registration
    registration.setMarker(holder.marker)
    return () => {
      holder.reactMounted = false
      if (holder.registration === registration) holder.registration = null
      registration.unregister()
    }
  }, [registry, identityKey, holder])

  useSsrSafeLayoutEffect(() => {
    holder.registration?.update(options)
  })

  const controls = useMemo(() => ({
    fallbackRef(boundary: HTMLElement | null) {
      if (!holder.acceptsFallbackRefs || currentFallbackOwner.current !== holder) return
      holder.fallback = boundary
      setFallbackHidden(boundary, holder.positioned)
    },
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

  const fallbackController = useMemo<ForeignBoxFallbackController>(() => ({
    fallbackRef: controls.fallbackRef,
    fallbackHidden: positioned,
  }), [controls.fallbackRef, positioned])

  return useMemo(() => ({
    ...controls,
    ...fallbackController,
    ssrFallback: createElement(ForeignBoxFallback, { foreign: fallbackController }, options.ssrFallback ?? options.child),
  }), [controls, fallbackController, options.ssrFallback, options.child])
}
