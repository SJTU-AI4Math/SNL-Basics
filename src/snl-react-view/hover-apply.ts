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
import { measureSemanticHighlightRect } from './hover-dom'

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

function syncGeometry(state: HighlightGeometryState): void {
  if (state.disposed) return
  state.fragments.forEach((fragment, index) => {
    const overlay = state.overlays[index]
    const rect = measureSemanticHighlightRect(fragment)
    if (!rect || !fragment.isConnected) {
      overlay.hidden = true
      return
    }
    overlay.hidden = false
    Object.assign(overlay.style, {
      left: `${rect.left + state.view.scrollX}px`,
      top: `${rect.top + state.view.scrollY}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    })
    const computed = state.view.getComputedStyle(fragment)
    overlay.style.setProperty('--snl-highlight-stroke', computed.getPropertyValue('--snl-highlight-stroke'))
  })
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
    state.resizeObserver?.observe(fragment)
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
  const overlays = fragments.map(() => {
    const overlay = container.ownerDocument.createElement('span')
    overlay.setAttribute(OVERLAY_ATTRIBUTE, '')
    overlay.setAttribute('aria-hidden', 'true')
    overlay.className = 'snl-highlight-overlay'
    container.ownerDocument.documentElement.append(overlay)
    return overlay
  })
  const state: HighlightGeometryState = {
    container,
    fragments,
    overlays,
    view,
    resizeObserver: null,
    mutationObservers: [],
    scheduled: null,
    scheduleKind: null,
    onScroll: () => {},
    onResize: () => {},
    disposed: false,
  }
  state.onScroll = (event) => {
    const document = state.container.ownerDocument
    if (event.target === state.view || event.target === document ||
        event.target === document.documentElement || event.target === document.body) {
      // Root scrolling moves an absolute document-coordinate overlay together
      // with its target without any JavaScript correction.
      return
    }
    // Nested scrollers do change the target's document coordinates. Refresh in
    // the scroll event itself; deferring to RAF leaves a visible floating frame.
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
