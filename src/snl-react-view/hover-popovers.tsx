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
import type { SnlActivationLease } from './deactivation-controller'
import {
  DEFAULT_HOVER_POPOVER_DISMISS_CONTROLLER,
  type HoverPopoverDismissController,
  type HoverPopoverDismissReason,
  type HoverPopoverDismissScope,
  type HoverPopoverDismissTarget,
} from './popover-dismiss-controller'

const useSsrSafeLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export type ViewportBounds = { left: number; top: number; right: number; bottom: number }
export type PopoverPhase = 'opening' | 'visible' | 'closing'
export type HoverPopoverBoundsPolicy = 'viewport' | 'nearest-scroll-container'

/** A stable semantic origin with independently selectable anchor geometry and placement bounds. */
export interface HoverPopoverOrigin {
  element: HTMLElement
  /** Optional initial anchor geometry. Resize/scroll refreshes measure `element`. */
  rect?: DOMRect
  /** Defaults to the legacy HTMLElement policy: nearest scroll container. */
  bounds?: HoverPopoverBoundsPolicy
}

export type HoverPopoverOriginInput = HTMLElement | DOMRect | HoverPopoverOrigin

type HoverPopoverRectSource = 'live-element' | 'explicit-rect' | 'detached-rect'

interface ResolvedHoverPopoverOrigin {
  element: HTMLElement | null
  rect: DOMRect
  rectSource: HoverPopoverRectSource
  boundsPolicy: HoverPopoverBoundsPolicy
}

function resolvePopoverOrigin(origin: HoverPopoverOriginInput): ResolvedHoverPopoverOrigin {
  const isElement = typeof HTMLElement !== 'undefined' && origin instanceof HTMLElement
  const isDescriptor = !isElement && typeof origin === 'object' && origin !== null &&
    'element' in origin && origin.element instanceof HTMLElement
  if (isElement) {
    return {
      element: origin,
      rect: origin.getBoundingClientRect(),
      rectSource: 'live-element',
      boundsPolicy: 'nearest-scroll-container',
    }
  }
  if (isDescriptor) {
    return {
      element: origin.element,
      rect: origin.rect ?? origin.element.getBoundingClientRect(),
      rectSource: origin.rect ? 'explicit-rect' : 'live-element',
      boundsPolicy: origin.bounds ?? 'nearest-scroll-container',
    }
  }
  return {
    element: null,
    rect: origin as DOMRect,
    rectSource: 'detached-rect',
    boundsPolicy: 'viewport',
  }
}

function sameRect(a: DOMRect, b: DOMRect): boolean {
  return a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom
}

function sameBounds(a: ViewportBounds | undefined, b: ViewportBounds): boolean {
  return a?.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom
}

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
  activation?: SnlActivationLease
}

export interface HoverPopoverOwner {
  activation?: SnlActivationLease
}

export interface HoverPopoverApi<TSubject> {
  spawn(
    subject: TSubject,
    origin: HoverPopoverOriginInput,
    pointerX: number,
    pointerY: number,
    parentId: string | null,
    owner?: HoverPopoverOwner,
  ): string
  preview(
    subject: TSubject,
    origin: HoverPopoverOriginInput,
    pointerX: number,
    pointerY: number,
    parentId: string | null,
    owner?: HoverPopoverOwner,
  ): string
  pin(
    subject: TSubject,
    origin: HoverPopoverOriginInput,
    pointerX: number,
    pointerY: number,
    parentId: string | null,
    owner?: HoverPopoverOwner,
  ): string
  updatePointer(id: string, pointerX: number, pointerY: number): void
  freeze(id: string): void
  cancelUnfrozen(id: string, reason?: 'explicit-api' | 'owner-unmount'): void
  /** Preserve this popover and ancestors; clear only recursively higher layers. */
  dismissDescendants(id: string): void
  dismissSubtree(id: string): void
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
  dismiss_controller?: HoverPopoverDismissController<any, TSubject>
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
  dismissDescendants(id: string, event: PointerEvent): void
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
      onPointerDownCapture={(event) => dismissDescendants(popover.id, event.nativeEvent)}
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

function HoverPopoverLifecycleArm({ arm }: { arm: () => void }): null {
  useSsrSafeLayoutEffect(() => { arm() }, [arm])
  return null
}

export function HoverPopoverProvider<TSubject>({
  children,
  renderPopover,
  options,
  className,
  style,
  resolveBounds = findPopoverBounds,
  portalTarget,
  dismiss_controller = DEFAULT_HOVER_POPOVER_DISMISS_CONTROLLER as HoverPopoverDismissController<any, TSubject>,
}: HoverPopoverProviderProps<TSubject>): JSX.Element {
  const offset = options?.offset ?? 12
  const hitPadding = options?.hitPadding ?? offset + 8
  const margin = options?.viewportMargin ?? 8
  const openDelayMs = options?.openDelayMs ?? 1000
  const fadeMs = options?.fadeMs ?? 150
  const freezeDelayMs = options?.freezeDelayMs ?? null

  const [popovers, setPopovers] = useState<HoverPopover<TSubject>[]>([])
  const popoversRef = useRef(popovers)
  const disposedRef = useRef(false)
  const armProvider = useCallback(() => { disposedRef.current = false }, [])
  const updatePopovers = useCallback((
    update: (current: HoverPopover<TSubject>[]) => HoverPopover<TSubject>[],
  ): void => {
    if (disposedRef.current) return
    const next = update(popoversRef.current)
    popoversRef.current = next
    setPopovers(next)
  }, [])
  const elementsRef = useRef(new Map<string, HTMLElement>())
  const timersRef = useRef(new Map<string, TimerBucket>())
  const boundsRef = useRef(new Map<string, ViewportBounds>())
  const boundsPolicyRef = useRef(new Map<string, HoverPopoverBoundsPolicy>())
  const rectSourceRef = useRef(new Map<string, HoverPopoverRectSource>())
  const removedSnapshotsRef = useRef(new Map<string, HoverPopoverDismissTarget<TSubject>>())
  const dismissControllerRef = useRef(dismiss_controller)
  dismissControllerRef.current = dismiss_controller

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
      boundsPolicyRef.current.delete(id)
      rectSourceRef.current.delete(id)
    }
    updatePopovers((current) => current.filter((popover) => !ids.has(popover.id)))
    const removed = [...ids].flatMap((id) => {
      const snapshot = removedSnapshotsRef.current.get(id)
      removedSnapshotsRef.current.delete(id)
      return snapshot ? [snapshot] : []
    })
    if (removed.length > 0) dismiss_controller.notifyRemoved(Object.freeze(removed))
  }, [clearTimers, dismiss_controller, updatePopovers])

  const dismissSet = useCallback((targets: readonly HoverPopoverDismissTarget<TSubject>[]) => {
    const immediate = new Set(
      targets.filter((target) => target.phase === 'opening').map((target) => target.id),
    )
    const fading = new Set(
      targets.filter((target) => target.phase === 'visible').map((target) => target.id),
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
  }, [fadeMs, removeNow])

  const requestDismiss = useCallback((
    reason: HoverPopoverDismissReason,
    scope: HoverPopoverDismissScope,
    nativeEvent?: PointerEvent | KeyboardEvent,
  ): boolean => {
    const current = popoversRef.current.filter((popover) => popover.phase !== 'closing')
    let doomed: Set<string>
    if (scope.kind === 'all') {
      doomed = new Set(current.map((popover) => popover.id))
    } else {
      doomed = collectPopoverSubtree(scope.anchor_id, current)
      const currentIds = new Set(current.map((popover) => popover.id))
      doomed = new Set([...doomed].filter((id) => currentIds.has(id)))
      if (scope.kind === 'descendants') doomed.delete(scope.anchor_id)
      if (scope.kind === 'unfrozen-subtree') {
        const currentById = new Map(current.map((popover) => [popover.id, popover]))
        doomed = new Set([...doomed].filter((id) => !currentById.get(id)?.frozen))
      }
    }
    if (doomed.size === 0) return false
    const byId = new Map(current.map((popover) => [popover.id, popover]))
    const depth = (popover: HoverPopover<TSubject>): number => {
      let value = 0
      let parentId = popover.parentId
      while (parentId) {
        value += 1
        parentId = byId.get(parentId)?.parentId ?? null
      }
      return value
    }
    const targets = Object.freeze(current
      .filter((popover) => doomed.has(popover.id))
      .sort((a, b) => depth(b) - depth(a))
      .map((popover) => Object.freeze({
        id: popover.id,
        subject: popover.subject,
        parent_id: popover.parentId,
        frozen: popover.frozen,
        phase: popover.phase,
        activation: popover.activation,
      })))
    const request = Object.freeze({
      reason,
      scope: Object.freeze({ ...scope }) as HoverPopoverDismissScope,
      targets,
      native_event: nativeEvent,
      cancelable: reason !== 'owner-unmount',
    })
    return dismiss_controller.dispatch(request, () => {
      for (const target of targets) removedSnapshotsRef.current.set(target.id, target)
      const subtree = scope.kind === 'unfrozen-subtree'
        ? collectPopoverSubtree(scope.anchor_id, current)
        : null
      updatePopovers((list) => list.map((popover) => {
        if (doomed.has(popover.id)) {
          return popover.phase === 'closing' ? popover : { ...popover, phase: 'closing' }
        }
        if (!subtree?.has(popover.id)) return popover
        let parentId = popover.parentId
        while (parentId && doomed.has(parentId)) parentId = byId.get(parentId)?.parentId ?? null
        return parentId === popover.parentId ? popover : { ...popover, parentId }
      }))
      for (const target of targets) {
        try { target.activation?.request_deactivate('popover-dismiss', request) }
        catch { /* activation leases are isolated from graph cleanup */ }
      }
      dismissSet(targets)
    })
  }, [dismissSet, dismiss_controller, updatePopovers])

  const dismissSubtree = useCallback((id: string) => {
    requestDismiss('explicit-api', { kind: 'subtree', anchor_id: id })
  }, [requestDismiss])

  const dismissUnfrozenSubtree = useCallback((id: string, reason: HoverPopoverDismissReason = 'pointer-exit') => {
    requestDismiss(reason, { kind: 'unfrozen-subtree', anchor_id: id })
  }, [requestDismiss])

  const dismissDescendants = useCallback((id: string) => {
    requestDismiss('explicit-api', { kind: 'descendants', anchor_id: id })
  }, [requestDismiss])

  const dismissDescendantsFromInteraction = useCallback((id: string, event: PointerEvent) => {
    const target = event.target
    if (target instanceof Node) {
      const byId = new Map(popoversRef.current.map((popover) => [popover.id, popover]))
      for (const popover of popoversRef.current) {
        let parentId = popover.parentId
        while (parentId && parentId !== id) parentId = byId.get(parentId)?.parentId ?? null
        if (parentId === id && popover.originElement?.contains(target)) return
      }
    }
    requestDismiss('ancestor-interaction', { kind: 'descendants', anchor_id: id }, event)
  }, [requestDismiss])

  const spawn = useCallback((
    subject: TSubject,
    origin: HoverPopoverOriginInput,
    pointerX: number,
    pointerY: number,
    parentId: string | null,
    owner?: HoverPopoverOwner,
  ): string => {
    const id = `snl-popover-${++popoverCounter}`
    if (disposedRef.current) return id
    const resolvedOrigin = resolvePopoverOrigin(origin)
    const { element: originElement, rect: originRect, boundsPolicy } = resolvedOrigin
    const ownBounds = originElement && boundsPolicy === 'nearest-scroll-container'
      ? resolveBounds(originElement)
      : findPopoverBounds(document.body)
    const bounds = parentId ? boundsRef.current.get(parentId) ?? ownBounds : ownBounds
    boundsRef.current.set(id, bounds)
    boundsPolicyRef.current.set(id, boundsPolicy)
    rectSourceRef.current.set(id, resolvedOrigin.rectSource)
    const phase: PopoverPhase = openDelayMs <= 0 ? 'visible' : 'opening'
    updatePopovers((list) => [...list, {
      id,
      subject,
      originRect,
      originElement,
      x: pointerX + offset,
      y: pointerY + offset,
      parentId,
      frozen: false,
      phase,
      activation: owner?.activation,
    }])
    const bucket: TimerBucket = {}
    if (openDelayMs > 0) {
      bucket.open = setTimeout(() => {
        updatePopovers((list) => list.map((p) => p.id === id ? { ...p, phase: 'visible' } : p))
        const current = timersRef.current.get(id)
        if (current) current.open = undefined
      }, openDelayMs)
    }
    if (freezeDelayMs != null) {
      bucket.freeze = setTimeout(() => {
        updatePopovers((list) => list.map((p) => p.id === id ? { ...p, frozen: true } : p))
        const current = timersRef.current.get(id)
        if (current) current.freeze = undefined
      }, freezeDelayMs)
    }
    if (bucket.open || bucket.freeze) timersRef.current.set(id, bucket)
    return id
  }, [freezeDelayMs, offset, openDelayMs, resolveBounds, updatePopovers])

  const refreshReusedOrigin = useCallback((
    id: string,
    origin: HoverPopoverOriginInput,
    pointerX: number,
    pointerY: number,
  ) => {
    const resolvedOrigin = resolvePopoverOrigin(origin)
    const existing = popoversRef.current.find((popover) => popover.id === id)
    if (!existing) return
    const previousBounds = boundsRef.current.get(id)
    const ownBounds = resolvedOrigin.element && resolvedOrigin.boundsPolicy === 'nearest-scroll-container'
      ? resolveBounds(resolvedOrigin.element)
      : findPopoverBounds(document.body)
    const bounds = existing.parentId ? boundsRef.current.get(existing.parentId) ?? ownBounds : ownBounds
    const rectChanged = !sameRect(existing.originRect, resolvedOrigin.rect)
    const sourceChanged = rectSourceRef.current.get(id) !== resolvedOrigin.rectSource
    const policyChanged = boundsPolicyRef.current.get(id) !== resolvedOrigin.boundsPolicy
    const boundsChanged = !sameBounds(previousBounds, bounds)
    const geometryChanged = rectChanged || sourceChanged || policyChanged || boundsChanged

    if (!geometryChanged && existing.originElement === resolvedOrigin.element) return
    boundsRef.current.set(id, bounds)
    boundsPolicyRef.current.set(id, resolvedOrigin.boundsPolicy)
    rectSourceRef.current.set(id, resolvedOrigin.rectSource)

    updatePopovers((list) => list.map((popover) => popover.id === id ? {
      ...popover,
      originElement: resolvedOrigin.element,
      originRect: rectChanged || sourceChanged ? resolvedOrigin.rect : popover.originRect,
      x: pointerX + offset,
      y: pointerY + offset,
    } : popover))
  }, [offset, resolveBounds, updatePopovers])

  const updatePointer = useCallback((id: string, pointerX: number, pointerY: number) => {
    updatePopovers((list) => list.map((p) =>
      p.id === id && !p.frozen && p.phase !== 'closing'
        ? { ...p, x: pointerX + offset, y: pointerY + offset }
        : p,
    ))
  }, [offset, updatePopovers])

  const preview = useCallback((
    subject: TSubject,
    origin: HoverPopoverOriginInput,
    pointerX: number,
    pointerY: number,
    parentId: string | null,
    owner?: HoverPopoverOwner,
  ): string => {
    const originElement = typeof HTMLElement !== 'undefined' && origin instanceof HTMLElement
      ? origin
      : typeof origin === 'object' && origin !== null && 'element' in origin && origin.element instanceof HTMLElement
        ? origin.element
        : null
    const existing = [...popoversRef.current].reverse().find((popover) =>
      popover.phase !== 'closing' &&
      popover.subject === subject &&
      popover.parentId === parentId &&
      (originElement ? popover.originElement === originElement : popover.originRect === origin),
    )
    if (!existing) return spawn(subject, origin, pointerX, pointerY, parentId, owner)
    refreshReusedOrigin(existing.id, origin, pointerX, pointerY)
    if (owner?.activation && owner.activation !== existing.activation) {
      updatePopovers((list) => list.map((popover) => popover.id === existing.id
        ? { ...popover, activation: owner.activation }
        : popover))
    }
    updatePointer(existing.id, pointerX, pointerY)
    return existing.id
  }, [refreshReusedOrigin, spawn, updatePointer, updatePopovers])

  const freeze = useCallback((id: string) => {
    const bucket = timersRef.current.get(id)
    if (bucket?.freeze) {
      clearTimeout(bucket.freeze)
      bucket.freeze = undefined
    }
    updatePopovers((list) => list.map((p) =>
      p.id === id && p.phase !== 'closing' ? { ...p, frozen: true } : p,
    ))
  }, [updatePopovers])

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
    updatePopovers((list) => list.map((popover) =>
      popover.id === id && popover.phase !== 'closing'
        ? { ...popover, frozen: true, phase: 'visible' }
        : popover,
    ))
  }, [updatePopovers])

  const pin = useCallback((
    subject: TSubject,
    origin: HoverPopoverOriginInput,
    pointerX: number,
    pointerY: number,
    parentId: string | null,
    owner?: HoverPopoverOwner,
  ): string => {
    const originElement = typeof HTMLElement !== 'undefined' && origin instanceof HTMLElement
      ? origin
      : typeof origin === 'object' && origin !== null && 'element' in origin && origin.element instanceof HTMLElement
        ? origin.element
        : null
    const existing = [...popoversRef.current].reverse().find((popover) =>
      popover.phase !== 'closing' &&
      popover.subject === subject &&
      popover.parentId === parentId &&
      (originElement ? popover.originElement === originElement : popover.originRect === origin),
    )
    if (existing) {
      refreshReusedOrigin(existing.id, origin, pointerX, pointerY)
      if (owner?.activation && owner.activation !== existing.activation) {
        updatePopovers((list) => list.map((popover) => popover.id === existing.id
          ? { ...popover, activation: owner.activation }
          : popover))
      }
      revealAndFreeze(existing.id)
      return existing.id
    }
    for (const popover of popoversRef.current) {
      if (popover.parentId === parentId && popover.phase !== 'closing') {
        requestDismiss('sibling-replaced', { kind: 'subtree', anchor_id: popover.id })
      }
    }
    const id = spawn(subject, origin, pointerX, pointerY, parentId, owner)
    revealAndFreeze(id)
    return id
  }, [refreshReusedOrigin, requestDismiss, revealAndFreeze, spawn, updatePopovers])

  const cancelUnfrozen = useCallback((id: string, reason: 'explicit-api' | 'owner-unmount' = 'explicit-api') => {
    const target = popoversRef.current.find((p) => p.id === id)
    if (target && !target.frozen && target.phase !== 'closing') dismissUnfrozenSubtree(id, reason)
  }, [dismissUnfrozenSubtree])

  const dismissAll = useCallback(() => {
    requestDismiss('explicit-api', { kind: 'all' })
  }, [requestDismiss])

  const isAlive = useCallback((id: string) => !disposedRef.current && popoversRef.current.some(
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
      const dismissUnfrozenRoots = (candidates: readonly HoverPopover<TSubject>[]): void => {
        const candidateIds = new Set(candidates.map((popover) => popover.id))
        const byId = new Map(live.map((popover) => [popover.id, popover]))
        for (const popover of candidates) {
          let parentId = popover.parentId
          let covered = false
          while (parentId) {
            if (candidateIds.has(parentId)) { covered = true; break }
            parentId = byId.get(parentId)?.parentId ?? null
          }
          if (!covered) dismissUnfrozenSubtree(popover.id)
        }
      }
      if (insideIds.size === 0) {
        dismissUnfrozenRoots(live.filter((popover) => !popover.frozen))
        return
      }
      const keep = expandPopoverAncestors(insideIds, live)
      dismissUnfrozenRoots(live.filter((popover) => !popover.frozen && !keep.has(popover.id)))
    }
    document.addEventListener('pointermove', onPointerMove)
    return () => document.removeEventListener('pointermove', onPointerMove)
  }, [dismissAll, dismissUnfrozenSubtree, hitPadding])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node) {
        const live = popoversRef.current.filter((popover) => popover.phase !== 'closing')
        const activated = new Set(live
          .filter((popover) => popover.originElement?.contains(target))
          .map((popover) => popover.id))
        if (activated.size > 0) {
          const protectedIds = expandPopoverAncestors(activated, live)
          for (const popover of live) {
            if (protectedIds.has(popover.id)) continue
            if (popover.parentId && !protectedIds.has(popover.parentId)) continue
            requestDismiss('sibling-replaced', { kind: 'subtree', anchor_id: popover.id }, event)
          }
          return
        }
        for (const element of elementsRef.current.values()) {
          if (element.contains(target)) return
        }
      }
      requestDismiss('outside-pointer-down', { kind: 'all' }, event)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestDismiss('escape', { kind: 'all' }, event)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [requestDismiss])

  useEffect(() => {
    const refreshGeometry = () => {
      const nextBounds = new Map<string, ViewportBounds>()
      updatePopovers((list) => list.map((popover) => {
        const originRect = popover.originElement
          ? popover.originElement.getBoundingClientRect()
          : popover.originRect
        const policy = boundsPolicyRef.current.get(popover.id) ??
          (popover.originElement ? 'nearest-scroll-container' : 'viewport')
        const ownBounds = popover.originElement && policy === 'nearest-scroll-container'
          ? resolveBounds(popover.originElement)
          : findPopoverBounds(document.body)
        const bounds = popover.parentId ? nextBounds.get(popover.parentId) ?? ownBounds : ownBounds
        nextBounds.set(popover.id, bounds)
        const deltaX = popover.originElement ? originRect.left - popover.originRect.left : 0
        const deltaY = popover.originElement ? originRect.top - popover.originRect.top : 0
        return {
          ...popover,
          originRect,
          x: popover.x + deltaX,
          y: popover.y + deltaY,
        }
      }))
      boundsRef.current = nextBounds
    }
    window.addEventListener('resize', refreshGeometry)
    document.addEventListener('scroll', refreshGeometry, true)
    return () => {
      window.removeEventListener('resize', refreshGeometry)
      document.removeEventListener('scroll', refreshGeometry, true)
    }
  }, [resolveBounds, updatePopovers])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      disposedRef.current = true
      const current = popoversRef.current
      const byId = new Map(current.map((popover) => [popover.id, popover]))
      const depth = (popover: HoverPopover<TSubject>): number => {
        let value = 0
        let parentId = popover.parentId
        while (parentId) { value += 1; parentId = byId.get(parentId)?.parentId ?? null }
        return value
      }
      const removed = [...current]
        .sort((a, b) => depth(b) - depth(a))
        .map((popover) => removedSnapshotsRef.current.get(popover.id) ?? Object.freeze({
          id: popover.id,
          subject: popover.subject,
          parent_id: popover.parentId,
          frozen: popover.frozen,
          phase: popover.phase,
          activation: popover.activation,
        }))
      removedSnapshotsRef.current.clear()
      popoversRef.current = []
      elementsRef.current.clear()
      boundsRef.current.clear()
      boundsPolicyRef.current.clear()
      rectSourceRef.current.clear()
      for (const bucket of timers.values()) {
        if (bucket.open) clearTimeout(bucket.open)
        if (bucket.close) clearTimeout(bucket.close)
        if (bucket.freeze) clearTimeout(bucket.freeze)
      }
      timers.clear()
      if (removed.length > 0) {
        dismissControllerRef.current.notifyRemoved(Object.freeze(removed))
      }
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
    dismissSubtree,
    dismissAll,
    isAlive,
  }), [spawn, preview, pin, updatePointer, freeze, cancelUnfrozen, dismissDescendants, dismissSubtree, dismissAll, isAlive])

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
            dismissDescendants={dismissDescendantsFromInteraction}
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
      <HoverPopoverLifecycleArm arm={armProvider} />
      {children}
      {portal}
    </HoverPopoverContext.Provider>
  )
}
