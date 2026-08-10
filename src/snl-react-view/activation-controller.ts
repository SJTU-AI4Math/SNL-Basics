import { absorbControllerResult } from './controller-safety'

export type SnlActivationPhase = 0 | 1 | 2

export interface SnlActivationDispatch<P, E> {
  phase: SnlActivationPhase
  event: E
  params: P
  runDefault(): void
}

export type SnlActivationHandler<P, E> = (
  dispatch: SnlActivationDispatch<P, E>,
) => void

export interface SnlActivationControllerOptions<P, E> {
  enabled?: boolean
  defaultBehavior?: boolean
  params: P
  handlers?: Partial<Record<SnlActivationPhase, SnlActivationHandler<P, E>>>
}

export interface SnlActivationDispatcher<E> {
  dispatch(phase: SnlActivationPhase, event: E, runDefault: () => void): boolean
}

/** Initialization-time activation policy shared by hover timers and click. */
export class SnlActivationController<P = unknown, E = unknown> {
  readonly enabled: boolean
  readonly defaultBehavior: boolean
  readonly params: P
  readonly handlers: Partial<Record<SnlActivationPhase, SnlActivationHandler<P, E>>>

  constructor(options: SnlActivationControllerOptions<P, E>) {
    this.enabled = options.enabled ?? true
    this.defaultBehavior = options.defaultBehavior ?? true
    this.params = options.params
    this.handlers = options.handlers ?? {}
  }

  dispatch(phase: SnlActivationPhase, event: E, runDefault: () => void): boolean {
    if (!this.enabled) return false
    let defaultRan = false
    let handlerActive = true
    const once = () => {
      if (!handlerActive || defaultRan) return
      defaultRan = true
      runDefault()
    }
    const handler = this.handlers[phase]
    if (handler) {
      try {
        const result = handler({ phase, event, params: this.params, runDefault: once })
        handlerActive = false
        absorbControllerResult(result)
      } catch { /* consumer activation handlers cannot break the view */ }
      finally { handlerActive = false }
      return defaultRan
    }
    if (this.defaultBehavior) once()
    return defaultRan
  }
}

export const DEFAULT_SNL_ACTIVATION_CONTROLLER = new SnlActivationController<undefined, unknown>({
  params: undefined,
})
