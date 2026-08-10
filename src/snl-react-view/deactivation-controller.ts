import type { SnlSyntaxTree } from '../snl-syntax-tree/types'
import type { SnlActivationPhase } from './activation-controller'
import type { TreePath } from './interaction-driver'
import { absorbControllerResult } from './controller-safety'

export type SnlDeactivationReason =
  | 'pointer-leave'
  | 'blank-activation'
  | 'popover-dismiss'
  | 'superseded'
  | 'explicit'

export interface SnlActivationSnapshot {
  readonly activation_id: number
  readonly node: SnlSyntaxTree
  readonly tree_path: TreePath
  readonly target: HTMLElement
  readonly phase: SnlActivationPhase
}

export interface SnlActivationLease {
  readonly activation_id: number
  /** Returns false when this lease is stale, vetoed, or already deactivated. */
  request_deactivate(reason: SnlDeactivationReason, cause?: unknown): boolean
}

export interface SnlDeactivationDispatch<P, E> {
  readonly reason: SnlDeactivationReason
  readonly event: E
  readonly params: P
  readonly activation: SnlActivationSnapshot
  runDefault(): void
}

export type SnlDeactivationHandler<P, E> = (
  dispatch: SnlDeactivationDispatch<P, E>,
) => void

export interface SnlDeactivationControllerOptions<P, E> {
  enabled?: boolean
  defaultBehavior?: boolean
  params: P
  handlers?: Partial<Record<SnlDeactivationReason, SnlDeactivationHandler<P, E>>>
}

/** Synchronous, initialization-time policy for clearing one SNL activation. */
export class SnlDeactivationController<P = unknown, E = unknown> {
  readonly enabled: boolean
  readonly defaultBehavior: boolean
  readonly params: P
  readonly handlers: Partial<Record<SnlDeactivationReason, SnlDeactivationHandler<P, E>>>

  constructor(options: SnlDeactivationControllerOptions<P, E>) {
    this.enabled = options.enabled ?? true
    this.defaultBehavior = options.defaultBehavior ?? true
    this.params = options.params
    this.handlers = options.handlers ?? {}
  }

  dispatch(
    reason: SnlDeactivationReason,
    activation: SnlActivationSnapshot,
    event: E,
    runDefault: () => void,
  ): boolean {
    if (!this.enabled) return false
    let defaultRan = false
    let handlerActive = true
    const once = (): void => {
      if (!handlerActive || defaultRan) return
      defaultRan = true
      runDefault()
    }
    const handler = this.handlers[reason]
    if (handler) {
      try {
        const result = handler({ reason, event, params: this.params, activation, runDefault: once })
        handlerActive = false
        absorbControllerResult(result)
      } catch { /* consumer deactivation handlers cannot break the view */ }
      finally { handlerActive = false }
      return defaultRan
    }
    if (this.defaultBehavior) once()
    handlerActive = false
    return defaultRan
  }
}

export const DEFAULT_SNL_DEACTIVATION_CONTROLLER = new SnlDeactivationController<undefined, unknown>({
  params: undefined,
})
