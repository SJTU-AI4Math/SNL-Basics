import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

export type ViewportBounds = { left: number; top: number; right: number; bottom: number }
export type PopoverPhase = 'opening' | 'visible' | 'closing'

export interface HoverPopover<TSubject> {
  id: string
  subject: TSubject
  originRect: DOMRect
  originElement?: HTMLElement | null
  x: number
  y: number
  parentId: string | null
  frozen: boolean
  phase: PopoverPhase
}

export interface HoverPopoverApi<TSubject> {
  spawn(
    subject: TSubject,
    origin: HTMLElement | DOMRect,
    pointerX: number,
    pointerY: number,
    parentId: string | null,
  ): string
  preview(
    subject: TSubject,
    origin: HTMLElement | DOMRect,
    pointerX: number,
    pointerY: number,
    parentId: string | null,
  ): string
  pin(
    subject: TSubject,
    origin: HTMLElement | DOMRect,
    pointerX: number,
    pointerY: number,
    parentId: string | null,
  ): string
  updatePointer(id: string, pointerX: number, pointerY: number): void
  freeze(id: string): void
  cancelUnfrozen(id: string): void
  /** Preserve this popover and ancestors; clear only recursively higher layers. */
  dismissDescendants(id: string): void
  dismissAll(): void
  isAlive(id: string): boolean
}

export interface HoverPopoverOptions {
  /** Whether pointer hover may open previews. Click-to-pin remains available. */
  hoverEnabled?: boolean
  offset?: number
  hitPadding?: number
  viewportMargin?: number
  openDelayMs?: number
  fadeMs?: number
  freezeDelayMs?: number | null
  maxZIndexBase?: number
}

export interface HoverPopoverProviderProps<TSubject> {
  children: ReactNode
  renderPopover(popover: HoverPopover<TSubject>): ReactNode
  options?: HoverPopoverOptions
  className?: string
  style?: CSSProperties | ((popover: HoverPopover<TSubject>, index: number) => CSSProperties)
  resolveBounds?: (origin: HTMLElement) => ViewportBounds
  portalTarget?: HTMLElement
}

type PopoverNode = { id: string; parentId: string | null }

export function collectPopoverSubtree(rootId: string, list: readonly PopoverNode[]): Set<string> {
  const result = new Set([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const item of list) {
      if (item.parentId && result.has(item.parentId) && !result.has(item.id)) {
        result.add(item.id)
        changed = true
      }
    }
  }
  return result
}

export function expandPopoverAncestors(
  initial: ReadonlySet<string>,
  list: readonly PopoverNode[],
): Set<string> {
  const result = new Set(initial)
  const byId = new Map(list.map((item) => [item.id, item]))
  for (const id of [...result]) {
    let current = byId.get(id)
    while (current?.parentId && !result.has(current.parentId)) {
      result.add(current.parentId)
      current = byId.get(current.parentId)
    }
  }
  return result
}

export function clampPopoverPosition(
  x: number,
  y: number,
  size: { width: number; height: number },
  bounds: ViewportBounds,
  margin = 8,
): { x: number; y: number } {
  const minX = bounds.left + margin
  const minY = bounds.top + margin
  const maxX = Math.max(minX, bounds.right - margin - size.width)
  const maxY = Math.max(minY, bounds.bottom - margin - size.height)
  return {
    x: Math.min(Math.max(x, minX), maxX),
    y: Math.min(Math.max(y, minY), maxY),
  }
}

export function findPopoverBounds(origin: HTMLElement): ViewportBounds {
  let parent = origin.parentElement
  while (parent && parent !== document.body) {
    const style = getComputedStyle(parent)
    const clips = /(auto|scroll|hidden|clip)/.test(
      `${style.overflow}${style.overflowX}${style.overflowY}`,
    )
    const rect = parent.getBoundingClientRect()
    if (clips && rect.width > 0 && rect.height > 0) {
      return {
        left: Math.max(0, rect.left),
        top: Math.max(0, rect.top),
        right: Math.min(window.innerWidth, rect.right),
        bottom: Math.min(window.innerHeight, rect.bottom),
      }
    }
    parent = parent.parentElement
  }
  const viewport = window.visualViewport
  const left = viewport?.offsetLeft ?? 0
  const top = viewport?.offsetTop ?? 0
  return {
    left,
    top,
    right: left + (viewport?.width ?? window.innerWidth),
    bottom: top + (viewport?.height ?? window.innerHeight),
  }
}

const HoverPopoverContext = createContext<HoverPopoverApi<unknown> | null>(null)
const CurrentPopoverContext = createContext<string | null>(null)

export function useHoverPopovers<TSubject>(): HoverPopoverApi<TSubject> {
  const value = useContext(HoverPopoverContext)
  if (!value) throw new Error('HoverPopoverProvider missing')
  return value as HoverPopoverApi<TSubject>
}

export function useCurrentPopoverId(): string | null {
  return useContext(CurrentPopoverContext)
}

let popoverCounter = 0

interface TimerBucket {
  open?: ReturnType<typeof setTimeout>
  close?: ReturnType<typeof setTimeout>
  freeze?: ReturnType<typeof setTimeout>
}

interface PopoverFrameProps<TSubject> {
  popover: HoverPopover<TSubject>
  index: number
  className?: string
  style?: HoverPopoverProviderProps<TSubject>['style']
  fadeMs: number
  margin: number
  bounds: ViewportBounds
  register(id: string, element: HTMLElement | null): void
  dismissDescendants(id: string): void
  children: ReactNode
}

function PopoverFrame<TSubject>({
  popover,
  index,
  className,
  style,
  fadeMs,
  margin,
  bounds,
  register,
  dismissDescendants,
  children,
}: PopoverFrameProps<TSubject>): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ x: popover.x, y: popover.y })

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    setPosition(clampPopoverPosition(
      popover.x,
      popover.y,
      element.getBoundingClientRect(),
      bounds,
      margin,
    ))
  }, [bounds, margin, popover.x, popover.y])

  useEffect(() => {
    register(popover.id, ref.current)
    return () => register(popover.id, null)
  }, [popover.id, register])

  const customStyle = typeof style === 'function' ? style(popover, index) : style
  return (
    <div
      ref={ref}
      className={className}
      data-popover-id={popover.id}
      data-frozen={popover.frozen ? 'true' : 'false'}
      data-phase={popover.phase}
      onPointerDownCapture={() => dismissDescendants(popover.id)}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 1000 + index,
        opacity: popover.phase === 'visible' ? 1 : 0,
        transition: fadeMs > 0 ? `opacity ${fadeMs}ms ease-in-out` : undefined,
        pointerEvents: popover.phase === 'visible' ? 'auto' : 'none',
        ...customStyle,
      }}
    >
      {children}
    </div>
  )
}

export function HoverPopoverProvider<TSubject>({
  children,
  renderPopover,
  options,
  className,
  style,
  resolveBounds = findPopoverBounds,
  portalTarget,
}: HoverPopoverProviderProps<TSubject>): JSX.Element {
  const offset = options?.offset ?? 12
  const hitPadding = options?.hitPadding ?? offset + 8
  const margin = options?.viewportMargin ?? 8
  const openDelayMs = options?.openDelayMs ?? 1000
  const fadeMs = options?.fadeMs ?? 150
  const freezeDelayMs = options?.freezeDelayMs ?? null

  const [popovers, setPopovers] = useState<HoverPopover<TSubject>[]>([])
  const popoversRef = useRef(popovers)
  popoversRef.current = popovers
  const elementsRef = useRef(new Map<string, HTMLElement>())
  const timersRef = useRef(new Map<string, TimerBucket>())
  const boundsRef = useRef(new Map<string, ViewportBounds>())

  const clearTimers = useCallback((ids: Iterable<string>) => {
    for (const id of ids) {
      const bucket = timersRef.current.get(id)
      if (bucket?.open) clearTimeout(bucket.open)
      if (bucket?.close) clearTimeout(bucket.close)
      if (bucket?.freeze) clearTimeout(bucket.freeze)
      timersRef.current.delete(id)
    }
  }, [])

  const removeNow = useCallback((ids: ReadonlySet<string>) => {
    clearTimers(ids)
    for (const id of ids) {
      elementsRef.current.delete(id)
      boundsRef.current.delete(id)
    }
    setPopovers((current) => current.filter((popover) => !ids.has(popover.id)))
  }, [clearTimers])

  const dismissSet = useCallback((doomed: ReadonlySet<string>) => {
    const current = popoversRef.current
    const immediate = new Set(
      current.filter((p) => doomed.has(p.id) && p.phase === 'opening').map((p) => p.id),
    )
    const fading = new Set(
      current.filter((p) => doomed.has(p.id) && p.phase === 'visible').map((p) => p.id),
    )
    if (immediate.size > 0) removeNow(immediate)
    if (fading.size === 0) return
    if (fadeMs <= 0) {
      removeNow(fading)
      return
    }
    for (const id of fading) {
      const bucket = timersRef.current.get(id) ?? {}
      if (bucket.open) clearTimeout(bucket.open)
      if (bucket.freeze) clearTimeout(bucket.freeze)
      bucket.open = undefined
      bucket.freeze = undefined
      bucket.close = setTimeout(() => removeNow(new Set([id])), fadeMs)
      timersRef.current.set(id, bucket)
    }
    setPopovers((list) => list.map((p) => fading.has(p.id) ? { ...p, phase: 'closing' } : p))
  }, [fadeMs, removeNow])

  const dismissSubtree = useCallback((rootId: string) => {
    dismissSet(collectPopoverSubtree(rootId, popoversRef.current))
  }, [dismissSet])

  const dismissUnfrozenSubtree = useCallback((rootId: string) => {
    const current = popoversRef.current
    const subtree = collectPopoverSubtree(rootId, current)
    const removable = new Set(
      current.filter((popover) => subtree.has(popover.id) && !popover.frozen).map((popover) => popover.id),
    )
    if (removable.size === 0) return
    const byId = new Map(current.map((popover) => [popover.id, popover]))
    setPopovers((list) => list.map((popover) => {
      if (!subtree.has(popover.id) || removable.has(popover.id)) return popover
      let parentId = popover.parentId
      while (parentId && removable.has(parentId)) parentId = byId.get(parentId)?.parentId ?? null
      return parentId === popover.parentId ? popover : { ...popover, parentId }
    }))
    dismissSet(removable)
  }, [dismissSet])

  const dismissDescendants = useCallback((id: string) => {
    const descendants = collectPopoverSubtree(id, popoversRef.current)
    descendants.delete(id)
    if (descendants.size > 0) dismissSet(descendants)
  }, [dismissSet])

  const spawn = useCallback((
    subject: TSubject,
    origin: HTMLElement | DOMRect,
    pointerX: number,
    pointerY: number,
    parentId: string | null,
  ): string => {
    const id = `snl-popover-${++popoverCounter}`
    const isElement = typeof HTMLElement !== 'undefined' && origin instanceof HTMLElement
    const originRect = isElement ? origin.getBoundingClientRect() : origin as DOMRect
    const bounds = parentId
      ? boundsRef.current.get(parentId) ?? (isElement ? resolveBounds(origin) : findPopoverBounds(document.body))
      : (isElement ? resolveBounds(origin) : findPopoverBounds(document.body))
    boundsRef.current.set(id, bounds)
    const phase: PopoverPhase = openDelayMs <= 0 ? 'visible' : 'opening'
    setPopovers((list) => [...list, {
      id,
      subject,
      originRect,
      originElement: isElement ? origin as HTMLElement : null,
      x: pointerX + offset,
      y: pointerY + offset,
      parentId,
      frozen: false,
      phase,
    }])
    const bucket: TimerBucket = {}
    if (openDelayMs > 0) {
      bucket.open = setTimeout(() => {
        setPopovers((list) => list.map((p) => p.id === id ? { ...p, phase: 'visible' } : p))
        const current = timersRef.current.get(id)
        if (current) current.open = undefined
      }, openDelayMs)
    }
    if (freezeDelayMs != null) {
      bucket.freeze = setTimeout(() => {
        setPopovers((list) => list.map((p) => p.id === id ? { ...p, frozen: true } : p))
        const current = timersRef.current.get(id)
        if (current) current.freeze = undefined
      }, freezeDelayMs)
    }
    if (bucket.open || bucket.freeze) timersRef.current.set(id, bucket)
    return id
  }, [freezeDelayMs, offset, openDelayMs, resolveBounds])

  const updatePointer = useCallback((id: string, pointerX: number, pointerY: number) => {
    setPopovers((list) => list.map((p) =>
      p.id === id && !p.frozen && p.phase !== 'closing'
        ? { ...p, x: pointerX + offset, y: pointerY + offset }
        : p,
    ))
  }, [offset])

  const preview = useCallback((
    subject: TSubject,
    origin: HTMLElement | DOMRect,
    pointerX: number,
    pointerY: number,
    parentId: string | null,
  ): string => {
    const originElement = typeof HTMLElement !== 'undefined' && origin instanceof HTMLElement
      ? origin
      : null
    const existing = [...popoversRef.current].reverse().find((popover) =>
      popover.phase !== 'closing' &&
      popover.subject === subject &&
      popover.parentId === parentId &&
      (originElement ? popover.originElement === originElement : popover.originRect === origin),
    )
    if (!existing) return spawn(subject, origin, pointerX, pointerY, parentId)
    updatePointer(existing.id, pointerX, pointerY)
    return existing.id
  }, [spawn, updatePointer])

  const freeze = useCallback((id: string) => {
    const bucket = timersRef.current.get(id)
    if (bucket?.freeze) {
      clearTimeout(bucket.freeze)
      bucket.freeze = undefined
    }
    setPopovers((list) => list.map((p) =>
      p.id === id && p.phase !== 'closing' ? { ...p, frozen: true } : p,
    ))
  }, [])

  const revealAndFreeze = useCallback((id: string) => {
    const bucket = timersRef.current.get(id)
    if (bucket?.open) {
      clearTimeout(bucket.open)
      bucket.open = undefined
    }
    if (bucket?.freeze) {
      clearTimeout(bucket.freeze)
      bucket.freeze = undefined
    }
    if (bucket && !bucket.open && !bucket.close && !bucket.freeze) timersRef.current.delete(id)
    setPopovers((list) => list.map((popover) =>
      popover.id === id && popover.phase !== 'closing'
        ? { ...popover, frozen: true, phase: 'visible' }
        : popover,
    ))
  }, [])

  const pin = useCallback((
    subject: TSubject,
    origin: HTMLElement | DOMRect,
    pointerX: number,
    pointerY: number,
    parentId: string | null,
  ): string => {
    const originElement = typeof HTMLElement !== 'undefined' && origin instanceof HTMLElement
      ? origin
      : null
    const existing = [...popoversRef.current].reverse().find((popover) =>
      popover.phase !== 'closing' &&
      popover.subject === subject &&
      popover.parentId === parentId &&
      (originElement ? popover.originElement === originElement : popover.originRect === origin),
    )
    if (existing) {
      updatePointer(existing.id, pointerX, pointerY)
      revealAndFreeze(existing.id)
      return existing.id
    }
    for (const popover of popoversRef.current) {
      if (popover.parentId === parentId && popover.phase !== 'closing') {
        dismissSubtree(popover.id)
      }
    }
    const id = spawn(subject, origin, pointerX, pointerY, parentId)
    revealAndFreeze(id)
    return id
  }, [dismissSubtree, revealAndFreeze, spawn, updatePointer])

  const cancelUnfrozen = useCallback((id: string) => {
    const target = popoversRef.current.find((p) => p.id === id)
    if (target && !target.frozen && target.phase !== 'closing') dismissUnfrozenSubtree(id)
  }, [dismissUnfrozenSubtree])

  const dismissAll = useCallback(() => {
    for (const popover of popoversRef.current) {
      if (!popover.parentId && popover.phase !== 'closing') dismissSubtree(popover.id)
    }
  }, [dismissSubtree])

  const isAlive = useCallback((id: string) => popoversRef.current.some(
    (p) => p.id === id && p.phase !== 'closing',
  ), [])

  const register = useCallback((id: string, element: HTMLElement | null) => {
    if (element) elementsRef.current.set(id, element)
    else elementsRef.current.delete(id)
  }, [])

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const live = popoversRef.current.filter((p) => p.phase !== 'closing')
      if (live.length === 0) return
      const inside = (rect: DOMRect) =>
        event.clientX >= rect.left - hitPadding &&
        event.clientX <= rect.right + hitPadding &&
        event.clientY >= rect.top - hitPadding &&
        event.clientY <= rect.bottom + hitPadding
      const insideIds = new Set<string>()
      for (const popover of live) {
        const element = elementsRef.current.get(popover.id)
        if (inside(popover.originRect) || (element && inside(element.getBoundingClientRect()))) {
          insideIds.add(popover.id)
        }
      }
      if (insideIds.size === 0) {
        for (const popover of live) {
          if (!popover.frozen) dismissUnfrozenSubtree(popover.id)
        }
        return
      }
      const keep = expandPopoverAncestors(insideIds, live)
      for (const popover of live) {
        if (!popover.frozen && !keep.has(popover.id)) dismissUnfrozenSubtree(popover.id)
      }
    }
    document.addEventListener('pointermove', onPointerMove)
    return () => document.removeEventListener('pointermove', onPointerMove)
  }, [dismissAll, dismissUnfrozenSubtree, hitPadding])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node) {
        for (const popover of popoversRef.current) {
          if (popover.originElement?.contains(target)) return
        }
        for (const element of elementsRef.current.values()) {
          if (element.contains(target)) return
        }
      }
      dismissAll()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismissAll()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [dismissAll])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const bucket of timers.values()) {
        if (bucket.open) clearTimeout(bucket.open)
        if (bucket.close) clearTimeout(bucket.close)
        if (bucket.freeze) clearTimeout(bucket.freeze)
      }
      timers.clear()
    }
  }, [])

  const api = useMemo<HoverPopoverApi<TSubject>>(() => ({
    spawn,
    preview,
    pin,
    updatePointer,
    freeze,
    cancelUnfrozen,
    dismissDescendants,
    dismissAll,
    isAlive,
  }), [spawn, preview, pin, updatePointer, freeze, cancelUnfrozen, dismissDescendants, dismissAll, isAlive])

  const portal = typeof document === 'undefined' ? null : createPortal(
    <>
      {popovers.map((popover, index) => (
        <CurrentPopoverContext.Provider value={popover.id} key={popover.id}>
          <PopoverFrame
            popover={popover}
            index={index}
            className={className}
            style={style}
            fadeMs={fadeMs}
            margin={margin}
            bounds={boundsRef.current.get(popover.id) ?? findPopoverBounds(document.body)}
            register={register}
            dismissDescendants={dismissDescendants}
          >
            {renderPopover(popover)}
          </PopoverFrame>
        </CurrentPopoverContext.Provider>
      ))}
    </>,
    portalTarget ?? document.body,
  )

  return (
    <HoverPopoverContext.Provider value={api as HoverPopoverApi<unknown>}>
      {children}
      {portal}
    </HoverPopoverContext.Provider>
  )
}
