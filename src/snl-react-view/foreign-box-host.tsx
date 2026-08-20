import {
  createContext,
  useContext,
  useEffect,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'
import { assertForeignBoxMetrics, foreignBoxIdentityKey, type ForeignBoxIdentity, type ForeignBoxMetrics } from './foreign-box'

const useSsrSafeLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

type MarkerElement = HTMLElement | SVGElement

interface RegistrationOptions {
  readonly identity: ForeignBoxIdentity
  readonly child: ReactNode
  readonly onMetrics?: (metrics: ForeignBoxMetrics) => void
  readonly onUnregister?: () => void
}

export interface ForeignBoxRegistration {
  setMarker(marker: MarkerElement | null): void
  reportMetrics(metrics: ForeignBoxMetrics): void
  unregister(): void
  isAlive(): boolean
}

interface ForeignBoxRegistry {
  register(options: RegistrationOptions): ForeignBoxRegistration
}

interface Entry extends RegistrationOptions {
  readonly key: string
  readonly token: object
  marker: MarkerElement | null
  wrapper: HTMLDivElement | null
  metrics: ForeignBoxMetrics | null
}

const ForeignBoxContext = createContext<ForeignBoxRegistry | null>(null)

export function useForeignBoxRegistry(): ForeignBoxRegistry {
  const registry = useContext(ForeignBoxContext)
  if (!registry) throw new Error('useForeignBox must be used within ForeignBoxHost')
  return registry
}

export interface ForeignBoxHostProps {
  readonly children?: ReactNode
  readonly className?: string
}

/**
 * Owns foreign React children independently from renderer-owned marker DOM.
 * Marker rectangles are mapped from viewport coordinates into the host's
 * scroll coordinate space. Browser-specific non-affine transform correction is
 * intentionally left behind this single geometry seam until browser-tested.
 */
export function ForeignBoxHost({ children, className }: ForeignBoxHostProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const entriesRef = useRef(new Map<string, Entry>())
  const elementEntriesRef = useRef(new WeakMap<Element, Entry>())
  const activeRef = useRef(false)
  const terminalCallbacksRef = useRef<Array<() => void>>([])
  const lifecycleEpochRef = useRef(0)
  const observerRef = useRef<ResizeObserver | null>(null)
  const rafRef = useRef<number | null>(null)
  const [, renderEntries] = useReducer((value: number) => value + 1, 0)

  const scheduleGeometry = useMemo(() => () => {
    if (!activeRef.current || rafRef.current !== null || typeof requestAnimationFrame === 'undefined') return
    const epoch = lifecycleEpochRef.current
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      if (!activeRef.current || lifecycleEpochRef.current !== epoch) return
      const host = hostRef.current
      if (!host) return
      const hostRect = host.getBoundingClientRect()
      for (const entry of entriesRef.current.values()) {
        let { marker, wrapper } = entry
        const { metrics } = entry
        if (marker && !marker.isConnected) {
          observerRef.current?.unobserve(marker)
          elementEntriesRef.current.delete(marker)
          entry.marker = null
          marker = null
        }
        if (wrapper && !wrapper.isConnected) {
          observerRef.current?.unobserve(wrapper)
          elementEntriesRef.current.delete(wrapper)
          entry.wrapper = null
          wrapper = null
        }
        if (!marker || !wrapper || !metrics) continue
        const markerRect = marker.getBoundingClientRect()
        const left = markerRect.left - hostRect.left + host.scrollLeft
        const top = markerRect.top - hostRect.top + host.scrollTop
        wrapper.dataset.state = 'positioned'
        wrapper.style.transform = `translate(${left}px, ${top}px)`
        wrapper.style.width = `${metrics.width}px`
        wrapper.style.height = `${metrics.height + metrics.depth}px`
        wrapper.style.setProperty('--snl-foreign-box-depth', `${metrics.depth}px`)
      }
    })
  }, [])

  const registry = useMemo<ForeignBoxRegistry>(() => ({
    register(options) {
      const key = foreignBoxIdentityKey(options.identity)
      const token = {}
      const entry: Entry = { ...options, key, token, marker: null, wrapper: null, metrics: null }
      if (!activeRef.current) return inertRegistration

      const previous = entriesRef.current.get(key)
      if (previous) {
        if (previous.marker) observerRef.current?.unobserve(previous.marker)
        if (previous.wrapper) observerRef.current?.unobserve(previous.wrapper)
      }
      entriesRef.current.set(key, entry)
      renderEntries()

      const isAlive = () => activeRef.current && entriesRef.current.get(key)?.token === token
      const setMarker = (marker: MarkerElement | null) => {
        if (!isAlive() || entry.marker === marker) return
        if (entry.marker) {
          observerRef.current?.unobserve(entry.marker)
          elementEntriesRef.current.delete(entry.marker)
        }
        entry.marker = marker
        if (marker) {
          elementEntriesRef.current.set(marker, entry)
          observerRef.current?.observe(marker)
        }
        scheduleGeometry()
      }
      const reportMetrics = (value: ForeignBoxMetrics) => {
        if (!isAlive()) return
        const metrics = assertForeignBoxMetrics(value)
        if (!isAlive()) return
        entry.metrics = metrics
        scheduleGeometry()
        entry.onMetrics?.(metrics)
      }
      const unregister = () => {
        if (!isAlive()) return
        entriesRef.current.delete(key)
        if (entry.marker) {
          observerRef.current?.unobserve(entry.marker)
          elementEntriesRef.current.delete(entry.marker)
        }
        if (entry.wrapper) {
          observerRef.current?.unobserve(entry.wrapper)
          elementEntriesRef.current.delete(entry.wrapper)
        }
        entry.marker = null
        entry.wrapper = null
        renderEntries()
        entry.onUnregister?.()
      }
      return { setMarker, reportMetrics, unregister, isAlive }
    },
  }), [scheduleGeometry])

  useInsertionEffect(() => {
    activeRef.current = true
    ++lifecycleEpochRef.current
    return () => {
      activeRef.current = false
      ++lifecycleEpochRef.current
      terminalCallbacksRef.current = [...entriesRef.current.values()]
        .map((entry) => entry.onUnregister)
        .filter((callback): callback is () => void => Boolean(callback))
      entriesRef.current.clear()
      elementEntriesRef.current = new WeakMap()
      const callbacks = terminalCallbacksRef.current.splice(0)
      queueMicrotask(() => {
        if (activeRef.current) return
        for (const callback of callbacks) callback()
      })
    }
  }, [])

  useSsrSafeLayoutEffect(() => {
    const epoch = lifecycleEpochRef.current
    const host = hostRef.current
    const ResizeObserverConstructor = typeof ResizeObserver === 'undefined' ? null : ResizeObserver
    if (ResizeObserverConstructor) {
      const observer = new ResizeObserverConstructor((records) => {
        if (!activeRef.current || lifecycleEpochRef.current !== epoch || observerRef.current !== observer) return
        for (const record of records) {
          if (record.target === host) continue
          const entry = elementEntriesRef.current.get(record.target)
          if (!entry || entriesRef.current.get(entry.key)?.token !== entry.token) continue
          if (record.target === entry.wrapper) {
            const width = record.contentRect.width
            const height = record.contentRect.height
            if (Number.isFinite(width) && width >= 0 && Number.isFinite(height) && height >= 0) {
              const metrics = { width, height, depth: entry.metrics?.depth ?? 0, baseline: entry.metrics?.baseline ?? 'bottom' } as const
              entry.metrics = metrics
              entry.onMetrics?.(metrics)
            }
          }
        }
        scheduleGeometry()
      })
      observerRef.current = observer
      if (host) observer.observe(host)
    }

    const update = () => scheduleGeometry()
    if (typeof window !== 'undefined') {
      window.addEventListener('scroll', update, true)
      window.addEventListener('resize', update)
      window.visualViewport?.addEventListener('scroll', update)
      window.visualViewport?.addEventListener('resize', update)
    }

    return () => {
      ++lifecycleEpochRef.current
      const observer = observerRef.current
      observerRef.current = null
      observer?.disconnect()
      if (rafRef.current !== null && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('scroll', update, true)
        window.removeEventListener('resize', update)
        window.visualViewport?.removeEventListener('scroll', update)
        window.visualViewport?.removeEventListener('resize', update)
      }
    }
  }, [scheduleGeometry])

  const records = [...entriesRef.current.values()]
  return (
    <ForeignBoxContext.Provider value={registry}>
      <div ref={hostRef} className={className ? `snl-foreign-box-host ${className}` : 'snl-foreign-box-host'} data-snl-foreign-box-host="true">
        {children}
        <div className="snl-foreign-box-overlay" aria-hidden="false">
          {records.map((entry) => (
            <div
              key={entry.key}
              className="snl-foreign-box"
              data-state="staging"
              data-tree-path={entry.identity.treePath}
              ref={(wrapper) => {
                if (!activeRef.current) return
                if (entry.wrapper && entry.wrapper !== wrapper) {
                  observerRef.current?.unobserve(entry.wrapper)
                  elementEntriesRef.current.delete(entry.wrapper)
                }
                entry.wrapper = wrapper
                if (wrapper) {
                  elementEntriesRef.current.set(wrapper, entry)
                  observerRef.current?.observe(wrapper)
                  scheduleGeometry()
                }
              }}
            >
              {entry.child}
            </div>
          ))}
        </div>
      </div>
    </ForeignBoxContext.Provider>
  )
}

const inertRegistration: ForeignBoxRegistration = {
  setMarker() {}, reportMetrics() {}, unregister() {}, isAlive: () => false,
}
