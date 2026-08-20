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
import { assertForeignBoxMetrics, foreignBoxIdentityKey, snapshotForeignBoxIdentity, type ForeignBoxIdentity, type ForeignBoxMetrics } from './foreign-box'

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
  return { left: dx / scaleX + host.scrollLeft, top: dy / scaleY + host.scrollTop }
}

interface RegistrationOptions {
  readonly identity: ForeignBoxIdentity
  readonly child: ReactNode
  readonly onMetrics?: (metrics: ForeignBoxMetrics) => void
  readonly onUnregister?: () => void
}

export interface ForeignBoxRegistration {
  update(options: Pick<RegistrationOptions, 'child' | 'onMetrics' | 'onUnregister'>): void
  setMarker(marker: MarkerElement | null): void
  reportMetrics(metrics: ForeignBoxMetrics): void
  unregister(): void
  isAlive(): boolean
}

interface ForeignBoxRegistry {
  register(options: RegistrationOptions): ForeignBoxRegistration
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
  onUnregister?: () => void
  readonly key: string
  readonly slot: string
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
          stageWrapper(wrapper)
        }
        if (wrapper && !wrapper.isConnected) {
          observerRef.current?.unobserve(wrapper)
          elementEntriesRef.current.delete(wrapper)
          entry.wrapper = null
          wrapper = null
        }
        if (!marker || !wrapper || !metrics) continue
        const markerRect = marker.getBoundingClientRect()
        const local = viewportDeltaToHostLocal(host, hostRect, markerRect.left - hostRect.left, markerRect.top - hostRect.top)
        if (!local) {
          failClosedWrapper(wrapper)
          continue
        }
        delete wrapper.dataset.geometryError
        wrapper.dataset.state = 'positioned'
        wrapper.style.visibility = 'visible'
        wrapper.setAttribute('aria-hidden', 'false')
        wrapper.removeAttribute('inert')
        wrapper.style.transform = `translate(${local.left}px, ${local.top}px)`
        wrapper.style.width = `${metrics.width}px`
        wrapper.style.height = `${metrics.height + metrics.depth}px`
        wrapper.style.setProperty('--snl-foreign-box-depth', `${metrics.depth}px`)
      }
    })
  }, [])

  const registry = useMemo<ForeignBoxRegistry>(() => ({
    register(options) {
      const identity = snapshotForeignBoxIdentity(options.identity)
      const key = foreignBoxIdentityKey(identity)
      const slot = identity.treePath
      const token = {}
      const previous = entriesRef.current.get(slot)
      const entry: Entry = {
        identity, child: options.child, onMetrics: options.onMetrics, onUnregister: options.onUnregister,
        key, slot, token, marker: null, wrapper: previous?.wrapper ?? null, metrics: null,
      }
      if (!activeRef.current) return inertRegistration

      const previousUnregister = previous?.onUnregister
      if (previous) {
        previous.onUnregister = undefined
        if (previous.marker) {
          observerRef.current?.unobserve(previous.marker)
          elementEntriesRef.current.delete(previous.marker)
        }
        if (previous.wrapper) {
          observerRef.current?.unobserve(previous.wrapper)
          elementEntriesRef.current.delete(previous.wrapper)
        }
        previous.marker = null
        previous.metrics = null
        previous.wrapper = null
      }
      entriesRef.current.set(slot, entry)
      if (entry.wrapper) {
        stageWrapper(entry.wrapper)
        elementEntriesRef.current.set(entry.wrapper, entry)
        observerRef.current?.observe(entry.wrapper)
      }
      renderEntries()
      previousUnregister?.()

      const isAlive = () => activeRef.current && entriesRef.current.get(slot)?.token === token
      const update = (next: Pick<RegistrationOptions, 'child' | 'onMetrics' | 'onUnregister'>) => {
        if (!isAlive()) return
        entry.child = next.child
        entry.onMetrics = next.onMetrics
        entry.onUnregister = next.onUnregister
        renderEntries()
      }
      const setMarker = (marker: MarkerElement | null) => {
        if (!isAlive() || entry.marker === marker) return
        if (entry.marker) {
          observerRef.current?.unobserve(entry.marker)
          elementEntriesRef.current.delete(entry.marker)
        }
        entry.marker = marker
        if (!marker) stageWrapper(entry.wrapper)
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
        entriesRef.current.delete(slot)
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
    const epoch = lifecycleEpochRef.current
    const host = hostRef.current
    const ResizeObserverConstructor = typeof ResizeObserver === 'undefined' ? null : ResizeObserver
    if (ResizeObserverConstructor) {
      const observer = new ResizeObserverConstructor((records) => {
        if (!activeRef.current || lifecycleEpochRef.current !== epoch || observerRef.current !== observer) return
        for (const record of records) {
          if (record.target === host) continue
          const entry = elementEntriesRef.current.get(record.target)
          if (!entry || entriesRef.current.get(entry.slot)?.token !== entry.token) continue
          if (record.target === entry.wrapper) {
            const width = record.contentRect.width
            const totalHeight = record.contentRect.height
            const depth = entry.metrics?.depth ?? 0
            const height = totalHeight - depth
            if (Number.isFinite(width) && width >= 0 && Number.isFinite(height) && height >= 0) {
              const metrics = Object.freeze({ width, height, depth, baseline: entry.metrics?.baseline ?? 'bottom' })
              entry.metrics = metrics
              entry.onMetrics?.(metrics)
            }
          }
        }
        scheduleGeometry()
      })
      observerRef.current = observer
      if (host) observer.observe(host)
      for (const entry of entriesRef.current.values()) {
        if (entry.marker) observer.observe(entry.marker)
        if (entry.wrapper) observer.observe(entry.wrapper)
      }
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
        <div className="snl-foreign-box-overlay">
          {records.map((entry) => (
            <div
              key={entry.slot}
              className="snl-foreign-box"
              data-state="staging"
              style={{ visibility: 'hidden' }}
              aria-hidden="true"
              inert={true}
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
  update() {}, setMarker() {}, reportMetrics() {}, unregister() {}, isAlive: () => false,
}
