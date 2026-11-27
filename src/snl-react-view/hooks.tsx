import type { FC, ReactElement } from 'react'
import type { SnlBlockMacroTemplate, SnlMacro, SnlMacroSource } from '../snl-macro/types'
import type { MacroDataDriver } from '../snl-macro/macro-data-driver'
// NOTE: the runtime tree produced by the parser is the flat SnlSyntaxTree from
// snl-syntax-tree/types (no `mode` discriminant yet). We type hook payloads
// against it so consumers receive exactly what the view has. The forward-looking
// node-types union is exported separately from the package barrel.
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'
import {
  defaultHighlightStrategy,
  type SnlHighlightStrategy,
} from './highlight-strategy'
import { CenteredRenderer, EnumerateRenderer, ListRenderer, RightRenderer, TableRenderer } from './block-renderers'
import type { SnlContextMenuContext, SnlContextMenuItem } from './context-menu'


/** Shared mutable channel for one uninterrupted hover lifecycle. */
export interface SnlHoverSession {
  readonly id: number
  readonly data: Map<unknown, unknown>
}

/** Backward-compatible base payload for hover consumers and fixtures. */
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

/** Payload delivered to the three phase hooks; all phases share one session. */
export interface SnlHoverPhaseEvent extends SnlHoverEvent {
  session: SnlHoverSession
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
  /** True once the tooltip is pinned by a 2-second hover or a click. Defaults to false. */
  locked?: boolean
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

/** What could not be rendered; passed to {@link SnlRenderHooks.renderError}. */
export interface SnlRenderFailure {
  /**
   * `macro-query`: the macro backend failed; `template`: no valid Style/template
   * projection; `typeset`: the formula could not be typeset; `math-island`: a
   * `$…$` island in text failed; `foreign`: an embedded block renderer failed.
   */
  stage: 'macro-query' | 'template' | 'typeset' | 'math-island' | 'foreign'
  /** The node whose output is replaced, when known. */
  node?: SnlSyntaxTree
  /** The underlying error, for host logging. The default renderer never shows it. */
  error: unknown
  /** Content language of the view (`en`, `zh-CN`, …). */
  language: string
  /** True when the failed content is a block (e.g. a whole display formula). */
  block: boolean
}

/**
 * Hover-highlight policy lives in its own React-free module so the DOM-only
 * `./hover` subpath entry can import it without dragging in the block
 * renderers (and through them React). Re-exported here so this module's public
 * surface is unchanged.
 */
export {
  defaultHighlightStrategy,
  type SnlHighlightSet,
  type SnlHighlightStrategy,
} from './highlight-strategy'

/**
 * Props passed to a block renderer. `renderChild` dispatches any child node
 * (math / text / block) back through the view's mode-aware renderer, so a block
 * renderer never has to know how to render math itself.
 */
export interface SnlBlockRendererProps {
  /** The block node to render. */
  node: SnlSyntaxTree
  /** The macro data driver, for looking up child metadata if needed. */
  macro_data_driver: MacroDataDriver
  /** The complete, localized consumer-owned TemplateSpec projection selected by the view. */
  template: SnlBlockMacroTemplate
  /** Macro-level arity contract; specialized renderers must fail closed when unsupported. */
  dynamicArity: boolean
  /** Exact semantic path of the block node. */
  treePath: string
  /** Resolve a child mode without bypassing the view's existing Macro projection. */
  childMode: (child: SnlSyntaxTree) => 'formula_inline' | 'formula_display' | 'text' | 'block'
  /**
   * Report whether the selected complete TemplateSpec modes anywhere in this
   * child's subtree include block content. Optional for custom renderers;
   * specialized foreign-content renderers may require it to fail closed.
   */
  childContainsBlock?: (child: SnlSyntaxTree) => boolean
  /** Render a child of any mode through the view, preserving semantic DOM metadata. */
  renderChild: (child: SnlSyntaxTree, index?: number) => ReactElement
}

/** A React component that renders a `mode === "block"` macro. */
export type SnlBlockRenderer = FC<SnlBlockRendererProps>

/**
 * Registry mapping a macro style's `block_template_name` to a block
 * renderer. Consumers may add their own custom keys.
 */
export type SnlRendererRegistry = Record<string, SnlBlockRenderer>

/**
 * Built-in block renderers keyed by `block_template_name`:
 *   `"list"`      — unordered list (LaTeX `\begin{itemize}` → `<ul>`).
 *   `"enumerate"` — ordered list   (LaTeX `\begin{enumerate}` → `<ol>`).
 *                   Honours `mdata.start` (starting counter) and
 *                   `mdata.listStyle` ('decimal' / 'lower-alpha' / …).
 *   `"table"`     — `<table>` with optional `table-header` first row.
 *   `"centered"`  — horizontally-centered block wrapper.
 *   `"right"`     — right-aligned block wrapper.
 * Spread your own entries over this to extend it.
 */
export const defaultRenderers: SnlRendererRegistry = {
  list: ListRenderer,
  enumerate: EnumerateRenderer,
  table: TableRenderer,
  centered: CenteredRenderer,
  right: RightRenderer,
}

/**
 * Customization surface for {@link SnlSyntaxTreeView}. Every field is optional
 * and merged over {@link defaultRenderHooks}; provide any subset to override
 * tooltip, hover, description, highlight, or block-render behavior.
 */
export interface SnlRenderHooks {
  /**
   * Fire-and-forget — NOT awaited. Called on hover start / move for consumer
   * side effects (logging, host messaging). The view's internal hover state
   * machine runs regardless. Default: undefined.
   */
  onHover?: (event: SnlHoverPhaseEvent) => void
  /** Fire once when the same node has remained hovered for one second. */
  onHover1s?: (event: SnlHoverPhaseEvent) => void
  /** Fire once when the same node has remained hovered for two seconds. */
  onHover2s?: (event: SnlHoverPhaseEvent) => void
  /**
   * Fire-and-forget — NOT awaited. Called when the pointer leaves the render
   * container. Default: undefined.
   */
  onLeave?: () => void

  /**
   * Async — awaited after hover starts (with a short debounce). Fine to hit
   * a network / disk cache; the view keeps `loading: true` in the tooltip
   * state until it resolves. The default reads the queried macro description.
   */
  resolveMacroInfo?: (name: string, macro: SnlMacro | undefined) => Promise<SnlMacroInfo>

  /**
   * Sync — called during render on every hover to enrich the tooltip payload.
   * Return null when no source is resolvable. If you need async lookup, cache
   * results in a React state / memo before construction and read synchronously
   * here. Default: return null.
   */
  resolveSource?: (source: SnlMacroSource) => SnlResolvedSource | null

  /**
   * Sync React render — called during render, must be pure (no side effects).
   * Default: SNL-Basics's built-in tooltip DOM. Return null to suppress the
   * tooltip entirely.
   */
  renderTooltip?: (state: SnlTooltipState) => ReactElement | null

  /**
   * Sync React render of content that could not be rendered (see
   * {@link SnlRenderFailure}). Default: a small, muted, localized "cannot
   * display" note; error details and source are never shown to readers.
   */
  renderError?: (failure: SnlRenderFailure) => ReactElement | null

  /**
   * Right-click menu of the subtree under the pointer. Receives the default
   * items (copy TeX source) and returns the menu to show; an empty list keeps
   * the browser's own menu. Default: the defaults unchanged.
   */
  contextMenuItems?: (
    context: SnlContextMenuContext,
    defaults: readonly SnlContextMenuItem[],
  ) => readonly SnlContextMenuItem[]

  /**
   * Which DOM elements get highlighted on hover. Default:
   * {@link defaultHighlightStrategy}.
   */
  highlightStrategy?: SnlHighlightStrategy

  /**
   * Block/text renderers keyed by `block_template_name`. Default:
   * {@link defaultRenderers}. Merged (spread) over the defaults by the view.
   */
  renderers?: SnlRendererRegistry
}

function defaultRenderTooltip(state: SnlTooltipState): ReactElement | null {
  return (
    <div
      className={`snl-hover-tooltip ${state.visible ? 'visible' : ''} ${state.locked ? 'locked' : ''}`}
      data-locked={state.locked ? 'true' : undefined}
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

function defaultRenderError(failure: SnlRenderFailure): ReactElement {
  const label = /^(zh|CN)(-|$)/i.test(failure.language) ? '（无法显示）' : '(cannot display)'
  const Tag = failure.block ? 'div' : 'span'
  return <Tag className="snl-render-fallback" data-snl-render-fallback={failure.stage}>{label}</Tag>
}

/** The behavior that Phase 1 SnlSyntaxTreeView had baked in. */
export const defaultRenderHooks: SnlRenderHooks = {
  resolveMacroInfo: async (_name, macro) => ({
    description: macro?.description ?? 'No description available.',
  }),
  resolveSource: () => null,
  renderTooltip: defaultRenderTooltip,
  renderError: defaultRenderError,
  highlightStrategy: defaultHighlightStrategy,
  renderers: defaultRenderers,
  // onHover / onLeave intentionally undefined: the view's internal hover state
  // machine still runs; these hooks are only for consumers who want to intercept.
}
