/**
 * Applying a hover highlight to already-rendered SNL DOM.
 *
 * `SnlSyntaxTreeView` owns the React tree and drives hover from pointer events;
 * this module owns what happens AFTER a target is chosen — computing the
 * highlight set and putting the classes on. It is deliberately React-free and
 * DOM-only so static HTML consumers reuse the same policy.
 */
import type { SnlHighlightSet, SnlHighlightStrategy } from './hooks'
import { defaultHighlightStrategy } from './hooks'
import { buildBvarScopeIndex, type BvarScopeEntry } from '../snl-syntax-tree/bvar-scope-index'
import { measureSemanticHighlightRects } from './hover-dom'

/** CSS custom property holding the container's pre-hover computed text colour. */
export const SNL_BASE_TEXT_COLOR_VAR = '--snl-base-text-color'

/** Classes applied by one hover interaction. */
export const SNL_HOVER_CLASS = {
  singleHover: 'snl-single-hover',
  geometry: 'snl-highlight-geometry',
  bvarScope: 'snl-bvar-scope',
  binderDecl: 'snl-binder-decl',
} as const

const ALL_HOVER_CLASSES = [
  SNL_HOVER_CLASS.singleHover,
  SNL_HOVER_CLASS.geometry,
  SNL_HOVER_CLASS.bvarScope,
  SNL_HOVER_CLASS.binderDecl,
]
const OVERLAY_ATTRIBUTE = 'data-snl-highlight-overlay'

interface HighlightGeometryState {
  container: HTMLElement
  fragments: HTMLElement[]
  overlays: HTMLElement[]
  view: Window
  resizeObserver: ResizeObserver | null
  mutationObservers: MutationObserver[]
  scheduled: number | null
  scheduleKind: 'raf' | 'timeout' | null
  onScroll: (event: Event) => void
  onResize: () => void
  disposed: boolean
}

type ObserverWindow = Window & {
  MutationObserver?: typeof MutationObserver
  ResizeObserver?: typeof ResizeObserver
}

const geometryStates = new WeakMap<HTMLElement, HighlightGeometryState>()

// Overlays live at the document root, outside the target's overflow chain.
// Preserve their original frame and clip only its paint, rather than drawing
// a new outline around the intersection (which invents edges at scrollports).
function overflowClip(fragment: HTMLElement, view: Window) {
  let left = -Infinity, top = -Infinity, right = Infinity, bottom = Infinity
  for (let el: HTMLElement | null = fragment; el && el !== fragment.ownerDocument.documentElement; el = el.parentElement) {
    const style = view.getComputedStyle(el)
    if (el === fragment.ownerDocument.body) {
      const rootStyle = view.getComputedStyle(fragment.ownerDocument.documentElement)
      const uncontained = (s: CSSStyleDeclaration) => !s.contain || s.contain === 'none'
      // CSS Overflow 3 §3.1.4: body overflow can be used by the viewport,
      // leaving body's used overflow visible. Its short client box is then
      // NOT a clip. Non-visible root overflow or containment disables this.
      if (rootStyle.overflowX === 'visible' && rootStyle.overflowY === 'visible' &&
          uncontained(rootStyle) && uncontained(style)) continue
    }
    if (style.display === 'inline' || style.display === 'contents') continue
    const clips = (value: string) => /^(auto|scroll|hidden|clip|overlay)$/.test(value)
    const x = clips(style.overflowX), y = clips(style.overflowY)
    if (!x && !y) continue
    const box = el.getBoundingClientRect()
    const sx = el.offsetWidth ? box.width / el.offsetWidth : 1
    const sy = el.offsetHeight ? box.height / el.offsetHeight : 1
    const l = box.left + el.clientLeft * sx, t = box.top + el.clientTop * sy
    if (x) { left = Math.max(left, l); right = Math.min(right, l + el.clientWidth * sx) }
    if (y) { top = Math.max(top, t); bottom = Math.min(bottom, t + el.clientHeight * sy) }
  }
  return { left, top, right, bottom }
}

function syncGeometry(state: HighlightGeometryState): void {
  if (state.disposed) return
  let index = 0
  for (const fragment of state.fragments) {
    const rects = fragment.isConnected ? measureSemanticHighlightRects(fragment) : []
    const computed = state.view.getComputedStyle(fragment)
    const clip = overflowClip(fragment, state.view)
    // Preserve an owned, hidden placeholder for fragments without visible boxes.
    for (const rect of rects.length ? rects : [null]) {
      let overlay = state.overlays[index++]
      if (!overlay) {
        overlay = state.container.ownerDocument.createElement('span')
        overlay.setAttribute(OVERLAY_ATTRIBUTE, '')
        overlay.setAttribute('aria-hidden', 'true')
        overlay.className = 'snl-highlight-overlay'
        state.container.ownerDocument.documentElement.append(overlay)
        state.overlays.push(overlay)
      }
      overlay.hidden = rect === null || Math.min(rect.right, clip.right) <= Math.max(rect.left, clip.left) ||
        Math.min(rect.bottom, clip.bottom) <= Math.max(rect.top, clip.top)
      if (!rect || overlay.hidden) continue
      const insets = [Math.max(0, clip.top - rect.top), Math.max(0, rect.right - clip.right),
        Math.max(0, rect.bottom - clip.bottom), Math.max(0, clip.left - rect.left)]
      overlay.style.clipPath = insets.some(value => value > 0)
        ? `inset(${insets.map(value => `${value}px`).join(' ')})` : 'none'
      // Absolute offsets are relative to the actual containing-block origin,
      // which can be shifted by author borders/padding on the root element.
      // Measuring this owned overlay at (0, 0) avoids assuming an unstyled html.
      overlay.style.left = '0px'
      overlay.style.top = '0px'
      const origin = overlay.getBoundingClientRect()
      Object.assign(overlay.style, {
        left: `${rect.left - origin.left}px`,
        top: `${rect.top - origin.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      })
      overlay.style.setProperty('--snl-highlight-stroke', computed.getPropertyValue('--snl-highlight-stroke'))
    }
  }
  // Reflow can add or remove visual lines without changing semantic fragments.
  state.overlays.splice(index).forEach((overlay) => overlay.remove())
}

function scheduleGeometry(state: HighlightGeometryState): void {
  if (state.disposed) return
  if (state.scheduled !== null) return
  const run = () => {
    state.scheduled = null
    state.scheduleKind = null
    syncGeometry(state)
  }
  if (typeof state.view.requestAnimationFrame === 'function') {
    state.scheduleKind = 'raf'
    state.scheduled = state.view.requestAnimationFrame(run)
  } else {
    state.scheduleKind = 'timeout'
    state.scheduled = state.view.setTimeout(run, 0)
  }
}

function classWithoutHoverMarks(value: string | null): string {
  const hoverClasses = new Set<string>(ALL_HOVER_CLASSES)
  return (value ?? '').split(/\s+/).filter((name) => name && !hoverClasses.has(name)).sort().join(' ')
}

function mutationAffectsGeometry(record: MutationRecord): boolean {
  if (record.type !== 'attributes' || record.attributeName !== 'class') return true
  return classWithoutHoverMarks(record.oldValue) !==
    classWithoutHoverMarks((record.target as Element).getAttribute('class'))
}

function observeGeometry(state: HighlightGeometryState): void {
  if (state.disposed) return
  state.resizeObserver?.disconnect()
  state.mutationObservers.forEach((observer) => observer.disconnect())
  state.mutationObservers = []
  const MutationObserverCtor = (state.view as ObserverWindow).MutationObserver
  for (const fragment of state.fragments) {
    // Ancestor-only resizes can change the clip without resizing an inline
    // target (or its glyphs). Observe the same chain that supplies the clip.
    for (let el: HTMLElement | null = fragment; el; el = el.parentElement) state.resizeObserver?.observe(el)
    for (const descendant of fragment.querySelectorAll('*')) state.resizeObserver?.observe(descendant)
  }
  if (typeof MutationObserverCtor === 'function') {
    const onMutation = (records: MutationRecord[]) => {
      if (!records.some(mutationAffectsGeometry)) return
      if (records.some((record) => record.type === 'childList')) observeGeometry(state)
      syncGeometry(state)
    }
    const subtreeObserver = new MutationObserverCtor(onMutation)
    subtreeObserver.observe(state.container, {
      attributes: true, attributeOldValue: true, childList: true, subtree: true,
    })
    state.mutationObservers.push(subtreeObserver)
    let ancestor = state.container.parentElement
    while (ancestor) {
      const observer = new MutationObserverCtor(onMutation)
      observer.observe(ancestor, { attributes: true, attributeOldValue: true })
      state.mutationObservers.push(observer)
      ancestor = ancestor.parentElement
    }
  }
}

function removeGeometryState(container: HTMLElement): void {
  const state = geometryStates.get(container)
  if (!state) return
  state.disposed = true
  state.resizeObserver?.disconnect()
  state.mutationObservers.forEach((observer) => observer.disconnect())
  state.view.removeEventListener('scroll', state.onScroll, true)
  state.view.removeEventListener('resize', state.onResize)
  if (state.scheduled !== null) {
    if (state.scheduleKind === 'raf') state.view.cancelAnimationFrame(state.scheduled)
    else state.view.clearTimeout(state.scheduled)
  }
  state.overlays.forEach((overlay) => overlay.remove())
  geometryStates.delete(container)
}

function installGeometryState(container: HTMLElement, fragments: HTMLElement[], view: Window): void {
  const state: HighlightGeometryState = {
    container,
    fragments,
    overlays: [],
    view,
    resizeObserver: null,
    mutationObservers: [],
    scheduled: null,
    scheduleKind: null,
    onScroll: () => {},
    onResize: () => {},
    disposed: false,
  }
  state.onScroll = () => {
    // Absolute frames follow ordinary root scrolling in the compositor, but
    // fixed/sticky clipping ancestors can change their intersection even then.
    // Refresh in the event itself: no deferred floating frame after a wheel.
    syncGeometry(state)
  }
  state.onResize = () => scheduleGeometry(state)
  const ResizeObserverCtor = (view as ObserverWindow).ResizeObserver
  state.resizeObserver = typeof ResizeObserverCtor === 'function'
    ? new ResizeObserverCtor(() => syncGeometry(state))
    : null
  geometryStates.set(container, state)
  view.addEventListener('scroll', state.onScroll, true)
  view.addEventListener('resize', state.onResize)
  observeGeometry(state)
  syncGeometry(state)
}

function clearHoverClasses(container: HTMLElement): void {
  const selector = ALL_HOVER_CLASSES.map((className) => `.${className}`).join(',')
  for (const element of container.querySelectorAll<HTMLElement>(selector)) {
    element.classList.remove(...ALL_HOVER_CLASSES)
    element.style.removeProperty('--snl-highlight-left')
    element.style.removeProperty('--snl-highlight-top')
    element.style.removeProperty('--snl-highlight-width')
    element.style.removeProperty('--snl-highlight-height')
  }
}

/** Remove every hover mark and owned geometry overlay for `container`. */
export function clearSnlHoverHighlight(container: HTMLElement): void {
  removeGeometryState(container)
  clearHoverClasses(container)
}

export interface ApplySnlHoverHighlightOptions {
  /** Override the highlight policy. Defaults to {@link defaultHighlightStrategy}. */
  strategy?: SnlHighlightStrategy
  /** Prebuilt `bindRef -> scope` index; omitted callers rebuild it on demand. */
  bvarScopeIndex?: Map<string, BvarScopeEntry>
  phase?: 0 | 1 | 2
}

/** Clear marks, compute the semantic highlight set, and paint every fragment. */
export function applySnlHoverHighlight(
  target: HTMLElement,
  container: HTMLElement,
  options: ApplySnlHoverHighlightOptions = {},
): SnlHighlightSet {
  const previousGeometry = geometryStates.get(container)
  clearHoverClasses(container)

  const view = container.ownerDocument?.defaultView
  const baseTextColor = view ? view.getComputedStyle(container).color : ''
  if (baseTextColor) container.style.setProperty(SNL_BASE_TEXT_COLOR_VAR, baseTextColor)

  const strategy = options.strategy ?? defaultHighlightStrategy
  const index = options.bvarScopeIndex ?? buildBvarScopeIndex(container)
  const set = strategy.computeHighlightSet(target, container, index, options.phase)
  const singleHoverFragments = set.singleHoverFragments
    ?? (set.singleHover ? [set.singleHover] : [])

  for (const fragment of singleHoverFragments) {
    fragment.classList.add(SNL_HOVER_CLASS.singleHover, SNL_HOVER_CLASS.geometry)
  }

  const sameGeometry = previousGeometry !== undefined &&
    previousGeometry.fragments.length === singleHoverFragments.length &&
    previousGeometry.fragments.every((fragment, index_) => fragment === singleHoverFragments[index_])
  if (view && singleHoverFragments.length > 0) {
    if (!sameGeometry) {
      removeGeometryState(container)
      installGeometryState(container, singleHoverFragments, view)
    }
  } else {
    removeGeometryState(container)
  }

  for (const element of set.bvarScope) element.classList.add(SNL_HOVER_CLASS.bvarScope)
  for (const element of set.binderDecl) element.classList.add(SNL_HOVER_CLASS.binderDecl)
  return set
}
