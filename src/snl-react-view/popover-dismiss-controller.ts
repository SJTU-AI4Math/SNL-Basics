import type { SnlActivationLease } from './deactivation-controller'
import type { PopoverPhase } from './hover-popovers'
import { absorbControllerResult } from './controller-safety'

export type HoverPopoverDismissReason =
  | 'pointer-exit'
  | 'outside-pointer-down'
  | 'escape'
  | 'ancestor-interaction'
  | 'sibling-replaced'
  | 'owner-unmount'
  | 'explicit-api'

export type HoverPopoverDismissScope =
  | { readonly kind: 'descendants'; readonly anchor_id: string }
  | { readonly kind: 'subtree'; readonly anchor_id: string }
  | { readonly kind: 'unfrozen-subtree'; readonly anchor_id: string }
  | { readonly kind: 'all' }

export interface HoverPopoverDismissTarget<TSubject> {
  readonly id: string
  readonly subject: TSubject
  readonly parent_id: string | null
  readonly frozen: boolean
  readonly phase: PopoverPhase
  readonly activation?: SnlActivationLease
}

export interface HoverPopoverDismissRequest<TSubject> {
  readonly reason: HoverPopoverDismissReason
  readonly scope: HoverPopoverDismissScope
  readonly targets: readonly HoverPopoverDismissTarget<TSubject>[]
  readonly native_event?: PointerEvent | KeyboardEvent
  readonly cancelable: boolean
}

export interface HoverPopoverDismissDispatch<P, TSubject> {
  readonly request: HoverPopoverDismissRequest<TSubject>
  readonly params: P
  runDefault(): void
}

export interface HoverPopoverDismissControllerOptions<P, TSubject> {
  enabled?: boolean
  defaultBehavior?: boolean
  params: P
  on_request?: (dispatch: HoverPopoverDismissDispatch<P, TSubject>) => void
  on_removed?: (targets: readonly HoverPopoverDismissTarget<TSubject>[]) => void
}

/** Synchronous policy for one immutable, graph-scoped popover close request. */
export class HoverPopoverDismissController<P = unknown, TSubject = unknown> {
  readonly enabled: boolean
  readonly defaultBehavior: boolean
  readonly params: P
  readonly on_request: HoverPopoverDismissControllerOptions<P, TSubject>['on_request']
  readonly on_removed: HoverPopoverDismissControllerOptions<P, TSubject>['on_removed']

  constructor(options: HoverPopoverDismissControllerOptions<P, TSubject>) {
    this.enabled = options.enabled ?? true
    this.defaultBehavior = options.defaultBehavior ?? true
    this.params = options.params
    this.on_request = options.on_request
    this.on_removed = options.on_removed
  }

  dispatch(request: HoverPopoverDismissRequest<TSubject>, runDefault: () => void): boolean {
    let defaultRan = false
    let handlerActive = true
    const once = (): void => {
      if (!handlerActive || defaultRan) return
      defaultRan = true
      runDefault()
    }

    if (this.enabled && this.on_request) {
      try {
        const result = this.on_request({ request, params: this.params, runDefault: once })
        handlerActive = false
        absorbControllerResult(result)
      } catch { /* consumer request handlers cannot break provider state */ }
      finally { handlerActive = false }
    } else {
      if (this.enabled && this.defaultBehavior) once()
      handlerActive = false
    }

    // Non-cancelable lifecycle cleanup is forced even when policy is disabled,
    // suppresses defaults, throws, or declines its synchronous capability.
    if (!request.cancelable && !defaultRan) {
      defaultRan = true
      runDefault()
    }
    return defaultRan
  }

  notifyRemoved(targets: readonly HoverPopoverDismissTarget<TSubject>[]): void {
    try {
      absorbControllerResult(this.on_removed?.(targets))
    } catch { /* removal notifications cannot affect completed cleanup */ }
  }
}

export const DEFAULT_HOVER_POPOVER_DISMISS_CONTROLLER = new HoverPopoverDismissController<undefined, unknown>({
  params: undefined,
})
