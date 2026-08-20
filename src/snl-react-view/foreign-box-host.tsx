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
import { assertForeignBoxMetrics, foreignBoxIdentityKey, snapshotForeignBoxIdentity, type ForeignBoxIdentity, type ForeignBoxMetricReport, type ForeignBoxMetrics } from './foreign-box'

const useSsrSafeLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

type MarkerElement = HTMLElement | SVGElement

function hasOnlySupportedTransforms(element: Element): boolean {
  if (typeof getComputedStyle === 'undefined') return true
  for (let current: Element | null = element; current; current = current.parentElement) {
    const transform = getComputedStyle(current).transform.trim()
    if (transform === '' || transform === 'none') continue
    const match = /^matrix\(([^)]+)\)$/.exec(transform)
    if (!match) return false
    const values = match[1].split(',').map(value => Number(value.trim()))
    if (values.length !== 6 || values.some(value => !Number.isFinite(value))) return false
    const [a, b, c, d] = values
    if (b !== 0 || c !== 0 || a <= 0 || d <= 0) return false
  }
  return true
}

function viewportDeltaToHostLocal(host: HTMLElement, hostRect: DOMRect, dx: number, dy: number): { left: number; top: number } | null {
  if (!hasOnlySupportedTransforms(host)) return null
  const localWidth = host.offsetWidth
  const localHeight = host.offsetHeight
  const scaleX = localWidth > 0 && hostRect.width > 0 ? hostRect.width / localWidth : 1
  const scaleY = localHeight > 0 && hostRect.height > 0 ? hostRect.height / localHeight : 1
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) return null
  return { left: dx / scaleX - host.clientLeft + host.scrollLeft, top: dy / scaleY - host.clientTop + host.scrollTop }
}

interface RegistrationOptions {
  readonly identity: ForeignBoxIdentity
  readonly child: ReactNode
  readonly onMetrics?: (metrics: ForeignBoxMetrics) => void
  readonly metricEpoch?: number
  readonly onMetricReport?: (report: ForeignBoxMetricReport) => void
  readonly onUnregister?: () => void
  readonly onPositionedChange?: (positioned: boolean) => void
}

export interface ForeignBoxRegistration {
  update(options: Pick<RegistrationOptions, 'child' | 'onMetrics' | 'metricEpoch' | 'onMetricReport' | 'onUnregister'>): void
  setMarker(marker: MarkerElement | null): void
  reportMetrics(metrics: ForeignBoxMetrics): void
  unregister(): void
  isAlive(): boolean
}

interface ForeignBoxRegistry {
  register(options: RegistrationOptions): ForeignBoxRegistration
  stageAll(): void
}

function stageWrapper(wrapper: HTMLDivElement | null): void {
  if (!wrapper) return
  wrapper.dataset.state = 'staging'
  delete wrapper.dataset.geometryError
  wrapper.style.visibility = 'hidden'
  wrapper.style.transform = ''
  wrapper.style.width = ''
  wrapper.style.height = ''
  wrapper.style.removeProperty('--snl-foreign-box-depth')
  wrapper.setAttribute('aria-hidden', 'true')
  wrapper.setAttribute('inert', '')
}

function failClosedWrapper(wrapper: HTMLDivElement): void {
  stageWrapper(wrapper)
  wrapper.dataset.state = 'unsupported-transform'
  wrapper.dataset.geometryError = 'unsupported-transform'
}

interface Entry {
  readonly identity: ForeignBoxIdentity
  child: ReactNode
  onMetrics?: (metrics: ForeignBoxMetrics) => void
  metricEpoch: number
  onMetricReport?: (report: ForeignBoxMetricReport) => void
  onUnregister?: () => void
  onPositionedChange?: (positioned: boolean) => void
  positioned: boolean
  readonly key: string
  readonly slot: string
  readonly token: object
  marker: MarkerElement | null
  wrapper: HTMLDivElement | null
  wrapperRef: (wrapper: HTMLDivElement | null) => void
  measurement: HTMLDivElement | null
  intrinsicMeasurement: HTMLElement | null
  measurementRef: (measurement: HTMLDivElement | null) => void
  metrics: ForeignBoxMetrics | null
  focusRestore: HTMLElement | null
}

function setEntryPositioned(entry: Entry, positioned: boolean): void {
  if (entry.positioned === positioned) return
  entry.positioned = positioned
  entry.onPositionedChange?.(positioned)
}

function stageEntry(entry: Entry): void {
  const active = entry.wrapper?.ownerDocument.activeElement
  if (active && entry.wrapper?.contains(active) && typeof (active as HTMLElement).focus === 'function') {
    entry.focusRestore = active as HTMLElement
  }
  stageWrapper(entry.wrapper)
  setEntryPositioned(entry, false)
}

function failClosedEntry(entry: Entry, wrapper: HTMLDivElement): void {
  failClosedWrapper(wrapper)
  setEntryPositioned(entry, false)
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
  /** Correlates serialized host markup with every live sidecar registration. */
  readonly authorityKey?: unknown
}

/**
 * Owns foreign React children independently from renderer-owned marker DOM.
 * Marker rectangles are mapped from viewport coordinates into the host's
 * scroll coordinate space. Browser-specific non-affine transform correction is
 * intentionally left behind this single geometry seam until browser-tested.
 */
export function ForeignBoxHost({ children, className, authorityKey }: ForeignBoxHostProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const entriesRef = useRef(new Map<string, Entry>())
  const registrationNonceRef = useRef(0)
  const elementEntriesRef = useRef(new WeakMap<Element, Entry>())
  const activeRef = useRef(false)
  const terminalCallbacksRef = useRef<Array<() => void>>([])
  const lifecycleEpochRef = useRef(0)
  const committedAuthorityRef = useRef(authorityKey)
  const observerRef = useRef<ResizeObserver | null>(null)
  const rotateObserverRef = useRef<(() => void) | null>(null)
  const rafRef = useRef<number | null>(null)
  const [, renderEntries] = useReducer((value: number) => value + 1, 0)

  const scheduleGeometry = useMemo(() => {
    const schedule = () => {
      if (!activeRef.current || entriesRef.current.size === 0 || rafRef.current !== null || typeof requestAnimationFrame === 'undefined') return
      const epoch = lifecycleEpochRef.current
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        if (!activeRef.current || lifecycleEpochRef.current !== epoch) return
        const host = hostRef.current
        if (host) {
          const hostRect = host.getBoundingClientRect()
          for (const entry of entriesRef.current.values()) {
            let { marker, wrapper } = entry
            const { metrics } = entry
            if (marker && !marker.isConnected) {
              observerRef.current?.unobserve(marker)
              elementEntriesRef.current.delete(marker)
              entry.marker = null
              marker = null
              stageEntry(entry)
            }
            if (entry.measurement && !entry.measurement.isConnected) {
              observerRef.current?.unobserve(entry.measurement)
              elementEntriesRef.current.delete(entry.measurement)
              entry.measurement = null
              stageEntry(entry)
            }
            if (entry.measurement) {
              const intrinsic = entry.measurement.querySelector<HTMLElement>('[data-snl-foreign-intrinsic="true"]')
              if (intrinsic !== entry.intrinsicMeasurement) {
                const previousTarget = entry.intrinsicMeasurement ?? entry.measurement
                observerRef.current?.unobserve(previousTarget)
                elementEntriesRef.current.delete(previousTarget)
                entry.intrinsicMeasurement = intrinsic
                const nextTarget = intrinsic ?? entry.measurement
                elementEntriesRef.current.set(nextTarget, entry)
                observerRef.current?.observe(nextTarget)
              }
            }
            if (wrapper && !wrapper.isConnected) {
              entry.wrapper = null
              wrapper = null
              setEntryPositioned(entry, false)
            }
            if (!marker || !wrapper || !entry.measurement || !metrics) continue
            const markerRect = marker.getBoundingClientRect()
            const local = viewportDeltaToHostLocal(host, hostRect, markerRect.left - hostRect.left, markerRect.top - hostRect.top)
            if (!local) {
              failClosedEntry(entry, wrapper)
              continue
            }
            // Isolate the ordinary-tree fallback synchronously before exposing
            // this live wrapper. React state only mirrors the completed handoff.
            setEntryPositioned(entry, true)
            delete wrapper.dataset.geometryError
            wrapper.dataset.state = 'positioned'
            wrapper.style.visibility = 'visible'
            wrapper.setAttribute('aria-hidden', 'false')
            wrapper.removeAttribute('inert')
            const focusRestore = entry.focusRestore
            if (focusRestore?.isConnected) {
              entry.focusRestore = null
              focusRestore.focus({ preventScroll: true })
            }
            wrapper.style.transform = `translate(${local.left}px, ${local.top}px)`
            wrapper.style.width = `${metrics.width}px`
            wrapper.style.height = `${metrics.height + metrics.depth}px`
            wrapper.style.setProperty('--snl-foreign-box-depth', `${metrics.depth}px`)
          }
        }
        schedule()
      })
    }
    return schedule
  }, [])

  const registry = useMemo<ForeignBoxRegistry>(() => ({
    stageAll() {
      if (!activeRef.current) return
      let changed = false
      for (const entry of entriesRef.current.values()) {
        if (entry.marker) {
          observerRef.current?.unobserve(entry.marker)
          elementEntriesRef.current.delete(entry.marker)
          entry.marker = null
        }
        stageEntry(entry)
        changed = true
      }
      if (changed) {
        renderEntries()
        scheduleGeometry()
      }
    },
    register(options) {
      const identity = snapshotForeignBoxIdentity(options.identity)
      const key = `${foreignBoxIdentityKey(identity)}#${++registrationNonceRef.current}`
      const slot = identity.treePath
      const token = {}
      const previous = entriesRef.current.get(slot)
      const entry: Entry = {
        identity, child: options.child, onMetrics: options.onMetrics,
        metricEpoch: options.metricEpoch ?? 0, onMetricReport: options.onMetricReport, onUnregister: options.onUnregister,
        onPositionedChange: options.onPositionedChange, positioned: false,
        key, slot, token, marker: null, wrapper: null, wrapperRef: () => {},
        measurement: null, intrinsicMeasurement: null, measurementRef: () => {}, metrics: null, focusRestore: null,
      }
      entry.wrapperRef = (wrapper) => {
        if (!activeRef.current || entriesRef.current.get(slot)?.token !== token) return
        entry.wrapper = wrapper
        if (wrapper) {
          stageEntry(entry)
          scheduleGeometry()
        } else {
          setEntryPositioned(entry, false)
        }
      }
      entry.measurementRef = (measurement) => {
        if (!activeRef.current || entriesRef.current.get(slot)?.token !== token) return
        if (entry.measurement && entry.measurement !== measurement) {
          observerRef.current?.unobserve(entry.measurement)
          elementEntriesRef.current.delete(entry.measurement)
        }
        if (entry.intrinsicMeasurement) {
          observerRef.current?.unobserve(entry.intrinsicMeasurement)
          elementEntriesRef.current.delete(entry.intrinsicMeasurement)
        }
        entry.measurement = measurement
        entry.intrinsicMeasurement = measurement?.querySelector<HTMLElement>('[data-snl-foreign-intrinsic="true"]') ?? null
        const target = entry.intrinsicMeasurement ?? measurement
        if (target) {
          elementEntriesRef.current.set(target, entry)
          observerRef.current?.observe(target)
          scheduleGeometry()
        }
      }
      if (!activeRef.current) return inertRegistration

      const previousUnregister = previous?.onUnregister
      const previousPositionedChange = previous?.positioned ? previous.onPositionedChange : undefined
      if (previous) {
        stageWrapper(previous.wrapper)
        previous.onUnregister = undefined
        previous.onPositionedChange = undefined
        if (previous.marker) {
          observerRef.current?.unobserve(previous.marker)
          elementEntriesRef.current.delete(previous.marker)
        }
        if (previous.measurement) {
          observerRef.current?.unobserve(previous.measurement)
          elementEntriesRef.current.delete(previous.measurement)
        }
        previous.marker = null
        previous.metrics = null
        previous.measurement = null
        previous.wrapper = null
        previous.positioned = false
      }
      entriesRef.current.set(slot, entry)
      renderEntries()
      scheduleGeometry()
      previousPositionedChange?.(false)
      previousUnregister?.()

      const isAlive = () => activeRef.current && entriesRef.current.get(slot)?.token === token
      const update = (next: Pick<RegistrationOptions, 'child' | 'onMetrics' | 'metricEpoch' | 'onMetricReport' | 'onUnregister'>) => {
        if (!isAlive()) return
        entry.child = next.child
        entry.onMetrics = next.onMetrics
        const nextMetricEpoch = next.metricEpoch ?? 0
        const rotateObserver = entry.metricEpoch !== nextMetricEpoch
        entry.metricEpoch = nextMetricEpoch
        entry.onMetricReport = next.onMetricReport
        entry.onUnregister = next.onUnregister
        if (rotateObserver) rotateObserverRef.current?.()
        renderEntries()
      }
      const setMarker = (marker: MarkerElement | null) => {
        if (!isAlive() || entry.marker === marker) return
        if (entry.marker) {
          observerRef.current?.unobserve(entry.marker)
          elementEntriesRef.current.delete(entry.marker)
        }
        entry.marker = marker
        if (!marker) stageEntry(entry)
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
        if (isAlive()) entry.onMetricReport?.({
          authority: { ...entry.identity, metricEpoch: entry.metricEpoch },
          metrics,
        })
      }
      const unregister = () => {
        if (!isAlive()) return
        stageWrapper(entry.wrapper)
        entriesRef.current.delete(slot)
        if (entry.marker) {
          observerRef.current?.unobserve(entry.marker)
          elementEntriesRef.current.delete(entry.marker)
        }
        if (entry.measurement) {
          observerRef.current?.unobserve(entry.measurement)
          elementEntriesRef.current.delete(entry.measurement)
        }
        if (entry.intrinsicMeasurement) {
          observerRef.current?.unobserve(entry.intrinsicMeasurement)
          elementEntriesRef.current.delete(entry.intrinsicMeasurement)
        }
        entry.marker = null
        entry.measurement = null
        entry.intrinsicMeasurement = null
        entry.focusRestore = null
        entry.wrapper = null
        setEntryPositioned(entry, false)
        if (entriesRef.current.size === 0 && rafRef.current !== null && typeof cancelAnimationFrame !== 'undefined') {
          cancelAnimationFrame(rafRef.current)
          rafRef.current = null
        }
        renderEntries()
        entry.onUnregister?.()
      }
      return { update, setMarker, reportMetrics, unregister, isAlive }
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
    if (Object.is(committedAuthorityRef.current, authorityKey)) return
    committedAuthorityRef.current = authorityKey
    registry.stageAll()
  }, [authorityKey, registry])

  useSsrSafeLayoutEffect(() => {
    const epoch = lifecycleEpochRef.current
    const host = hostRef.current
    const ResizeObserverConstructor = typeof ResizeObserver === 'undefined' ? null : ResizeObserver
    const installObserver = () => {
      const previous = observerRef.current
      observerRef.current = null
      previous?.disconnect()
      if (!ResizeObserverConstructor || !activeRef.current || lifecycleEpochRef.current !== epoch) return
      const observer = new ResizeObserverConstructor((records) => {
        if (!activeRef.current || lifecycleEpochRef.current !== epoch || observerRef.current !== observer) return
        for (const record of records) {
          if (record.target === host) continue
          const entry = elementEntriesRef.current.get(record.target)
          if (!entry || entriesRef.current.get(entry.slot)?.token !== entry.token) continue
          if (record.target === (entry.intrinsicMeasurement ?? entry.measurement)) {
            const width = record.contentRect.width
            const totalHeight = record.contentRect.height
            const depth = entry.metrics?.depth ?? 0
            const height = Math.max(0, totalHeight - depth)
            if (Number.isFinite(width) && width >= 0 && Number.isFinite(height)) {
              const metrics = Object.freeze({ width, height, depth, baseline: entry.metrics?.baseline ?? 'bottom' })
              entry.metrics = metrics
              entry.onMetrics?.(metrics)
              if (activeRef.current && entriesRef.current.get(entry.slot)?.token === entry.token) {
                entry.onMetricReport?.({
                  authority: { ...entry.identity, metricEpoch: entry.metricEpoch },
                  metrics,
                })
              }
            }
          }
        }
        scheduleGeometry()
      })
      observerRef.current = observer
      if (host) observer.observe(host)
      for (const entry of entriesRef.current.values()) {
        if (entry.marker) observer.observe(entry.marker)
        const target = entry.intrinsicMeasurement ?? entry.measurement
        if (target) observer.observe(target)
      }
    }
    rotateObserverRef.current = installObserver
    installObserver()

    const update = () => scheduleGeometry()
    if (typeof window !== 'undefined') {
      window.addEventListener('scroll', update, true)
      window.addEventListener('resize', update)
      window.visualViewport?.addEventListener('scroll', update)
      window.visualViewport?.addEventListener('resize', update)
    }

    return () => {
      ++lifecycleEpochRef.current
      if (rotateObserverRef.current === installObserver) rotateObserverRef.current = null
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
        <div className="snl-foreign-box-overlay">
          {records.map((entry) => (
            <div
              key={entry.key}
              className="snl-foreign-box"
              data-state="staging"
              style={{ visibility: 'hidden' }}
              aria-hidden="true"
              inert={true}
              data-tree-path={entry.identity.treePath}
              ref={entry.wrapperRef}
            >
              <div className="snl-foreign-box-measure" ref={entry.measurementRef}>
                {entry.child}
              </div>
            </div>
          ))}
        </div>
      </div>
    </ForeignBoxContext.Provider>
  )
}

const inertRegistration: ForeignBoxRegistration = {
  update() {}, setMarker() {}, reportMetrics() {}, unregister() {}, isAlive: () => false,
}
