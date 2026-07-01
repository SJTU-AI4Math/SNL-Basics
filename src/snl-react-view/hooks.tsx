import type { ReactElement } from 'react'
import type { SnlMacro, SnlMacroDb } from '../snl-macro/types'
// NOTE: the runtime tree produced by the parser is the flat SnlSyntaxTree from
// snl-syntax-tree/types (no `mode` discriminant yet). We type hook payloads
// against it so consumers receive exactly what the view has. The forward-looking
// node-types union is exported separately from the package barrel.
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'

export type { SnlMacroDb }

/** Payload passed to onHover. */
export interface SnlHoverEvent {
  name: string
  kind: string
  node: SnlSyntaxTree                          // the node in the tree that was hovered
  bindingHint: string                          // pre-formatted binding description (may be empty)
  variableRole: 'bvar' | 'fvar' | 'none'
  target: HTMLElement                          // DOM element under the cursor
  clientX: number
  clientY: number
}

/** Resolved macro description for tooltip / accessibility. */
export interface SnlMacroInfo {
  description: string                          // primary description shown in tooltip
  extra?: string                               // optional secondary line
}

/** Resolved source binding — one of the source.entries or source.urls. */
export interface SnlResolvedSource {
  kind: 'entry' | 'url'
  ref: string                                  // entry id or URL
  displayName?: string                         // human-readable label if available
  href?: string                                // if url or if entry can be resolved to URL
}

/** State passed to renderTooltip. */
export interface SnlTooltipState {
  visible: boolean
  x: number
  y: number
  name: string
  kind: string
  variableRole: 'bvar' | 'fvar' | 'none'
  bindingHint: string
  info: SnlMacroInfo | null                    // resolved async; null while loading
  loading: boolean
  source: SnlResolvedSource | null             // resolved via resolveSource hook
}

export interface SnlRenderHooks {
  /** Called on hover start / move. Default: schedule tooltip display. */
  onHover?: (event: SnlHoverEvent) => void
  onLeave?: () => void

  /** Async description resolver. Default: read macroDb[name].description. */
  resolveMacroInfo?: (name: string, macro: SnlMacro | undefined) => Promise<SnlMacroInfo>

  /** Resolve source binding to a URL / display label. Default: return null. */
  resolveSource?: (source: SnlMacro['source']) => SnlResolvedSource | null

  /**
   * Render the tooltip. Default: SNL-Basics's built-in tooltip DOM.
   * Return null to suppress tooltip entirely.
   */
  renderTooltip?: (state: SnlTooltipState) => ReactElement | null
}

function defaultRenderTooltip(state: SnlTooltipState): ReactElement | null {
  return (
    <div
      className={`snl-hover-tooltip ${state.visible ? 'visible' : ''}`}
      style={{ left: state.x, top: state.y }}
    >
      <div className="tooltip-title">{state.name}</div>
      <div className="tooltip-kind">
        kind: {state.kind || '(none)'}
        {state.variableRole !== 'none' ? ` · ${state.variableRole}` : ''}
      </div>
      {state.loading ? (
        <div className="tooltip-loading">加载说明中...</div>
      ) : (
        <>
          <div className="tooltip-desc">{state.info?.description ?? ''}</div>
          {state.bindingHint ? <div className="tooltip-desc">{state.bindingHint}</div> : null}
          {state.info?.extra ? <div className="tooltip-desc">{state.info.extra}</div> : null}
          {state.source ? (
            <div className="tooltip-desc">
              {state.source.href ? (
                <a href={state.source.href} target="_blank" rel="noreferrer">
                  {state.source.displayName ?? state.source.ref}
                </a>
              ) : (
                (state.source.displayName ?? state.source.ref)
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

/** The behavior that Phase 1 SnlSyntaxTreeView had baked in. */
export const defaultRenderHooks: SnlRenderHooks = {
  resolveMacroInfo: async (_name, macro) => ({
    description: macro?.description ?? 'No description available.',
  }),
  resolveSource: () => null,
  renderTooltip: defaultRenderTooltip,
  // onHover / onLeave intentionally undefined: the view's internal hover state
  // machine still runs; these hooks are only for consumers who want to intercept.
}
