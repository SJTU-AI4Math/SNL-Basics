import type { FC, ReactElement } from 'react'
import type { SnlMacro, SnlMacroDb, SnlMacroSource } from '../snl-macro/types'
// NOTE: the runtime tree produced by the parser is the flat SnlSyntaxTree from
// snl-syntax-tree/types (no `mode` discriminant yet). We type hook payloads
// against it so consumers receive exactly what the view has. The forward-looking
// node-types union is exported separately from the package barrel.
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'
import type { BvarScopeEntry } from '../snl-syntax-tree/bvar-scope-index'
import { readBindRefFromDom } from '../snl-syntax-tree/binding'
import { collectDirectConstSymbols, findMinimalHoverRoot } from './hover-dom'
import { CenteredRenderer, ListRenderer, TableRenderer } from './block-renderers'

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

/**
 * The set of DOM elements a hover interaction should decorate. The view applies
 * one CSS class per bucket, uniformly:
 *   hovered → `.snl-hovered`, singleHover → `.snl-single-hover`,
 *   bvarScope → `.snl-bvar-scope`, binderDecl → `.snl-binder-decl`,
 *   opSkinHover → `.snl-op-skin-hover`.
 * An element may appear in several buckets (e.g. a bound variable is in both
 * `hovered` and `bvarScope`).
 */
export interface SnlHighlightSet {
  /** Gets `.snl-hovered`. */
  hovered: HTMLElement[]
  /** Gets `.snl-single-hover` — the one element directly under the pointer. */
  singleHover: HTMLElement | null
  /** Gets `.snl-bvar-scope` — bound-variable occurrences in scope. */
  bvarScope: HTMLElement[]
  /** Gets `.snl-binder-decl` — binder declaration sites. */
  binderDecl: HTMLElement[]
  /** Gets `.snl-op-skin-hover` — operator-skin symbols of a constant subtree. */
  opSkinHover: HTMLElement[]
}

/**
 * Pluggable hover-highlight policy. Given the pointer target, the render
 * container, and the current bvar-scope index, compute which elements light up.
 * Override to change highlight behavior without touching class application.
 */
export interface SnlHighlightStrategy {
  /**
   * @param target - the semantic element under the pointer (already resolved to
   *   its minimal hover root by the view).
   * @param container - the render root that owns the KaTeX/React output.
   * @param bvarScopeIndex - `bindRef → { bvars, binders }` built from the DOM.
   * @returns the buckets of elements to decorate.
   */
  computeHighlightSet(
    target: HTMLElement,
    container: HTMLElement,
    bvarScopeIndex: Map<string, BvarScopeEntry>,
  ): SnlHighlightSet
}

/**
 * Default highlight policy — reproduces Phase 1/2 behavior exactly:
 * bvar/binder hovers highlight the whole binding scope; constant-subtree hovers
 * additionally light up the operator skin symbols.
 */
export const defaultHighlightStrategy: SnlHighlightStrategy = {
  computeHighlightSet(target, container, bvarScopeIndex) {
    const kind = target.dataset.kind ?? ''
    const bindRef = readBindRefFromDom(target)

    const hovered: HTMLElement[] = []
    const bvarScope: HTMLElement[] = []
    const binderDecl: HTMLElement[] = []
    const opSkinHover: HTMLElement[] = []
    let singleHover: HTMLElement | null = null

    if ((kind === 'bvar' || kind === 'binder') && bindRef) {
      const entry = bvarScopeIndex.get(bindRef)
      let bvars: HTMLElement[]
      let binders: HTMLElement[]
      if (entry) {
        bvars = entry.bvars
        binders = entry.binders
      } else {
        const scopeRoot = Array.from(
          container.querySelectorAll<HTMLElement>('[data-kind="binderScope"]'),
        ).find((el) => readBindRefFromDom(el) === bindRef)
        if (!scopeRoot) {
          bvars = []
          binders = []
        } else {
          bvars = Array.from(
            scopeRoot.querySelectorAll<HTMLElement>('[data-kind="bvar"]'),
          ).filter((el) => readBindRefFromDom(el) === bindRef)
          binders = Array.from(
            scopeRoot.querySelectorAll<HTMLElement>('[data-kind="binder"]'),
          ).filter((el) => readBindRefFromDom(el) === bindRef)
        }
      }
      const touched = new Set<HTMLElement>()
      for (const el of bvars) {
        hovered.push(el)
        bvarScope.push(el)
        touched.add(el)
      }
      for (const el of binders) {
        hovered.push(el)
        binderDecl.push(el)
        touched.add(el)
      }
      // 仅当前指针下的那一处带「框」；同作用域其它仅字色（见 style.css）
      if (touched.has(target)) {
        singleHover = target
      }
    } else {
      const root = findMinimalHoverRoot(target, container)
      hovered.push(root)
      singleHover = root
      if (root.dataset.kind === 'constantSubtree') {
        for (const g of collectDirectConstSymbols(root)) {
          hovered.push(g)
          opSkinHover.push(g)
        }
      }
    }

    return { hovered, singleHover, bvarScope, binderDecl, opSkinHover }
  },
}

/**
 * Props passed to a block renderer. `renderChild` dispatches any child node
 * (math / text / block) back through the view's mode-aware renderer, so a block
 * renderer never has to know how to render math itself.
 */
export interface SnlBlockRendererProps {
  /** The block node to render. */
  node: SnlSyntaxTree
  /** The macro DB, for looking up child metadata if needed. */
  macroDb: SnlMacroDb
  /** Render a child of any mode as a React element. */
  renderChild: (child: SnlSyntaxTree) => ReactElement
}

/** A React component that renders a `mode === "block"` macro. */
export type SnlBlockRenderer = FC<SnlBlockRendererProps>

/**
 * Registry mapping a macro's `katex_react.react_renderer_key` to a block
 * renderer. Consumers may add their own custom keys.
 */
export type SnlRendererRegistry = Record<string, SnlBlockRenderer>

/**
 * Built-in block renderers keyed by `react_renderer_key`: `"list"`, `"table"`,
 * `"centered"`. Spread your own entries over this to extend it.
 */
export const defaultRenderers: SnlRendererRegistry = {
  list: ListRenderer,
  table: TableRenderer,
  centered: CenteredRenderer,
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
  onHover?: (event: SnlHoverEvent) => void
  /**
   * Fire-and-forget — NOT awaited. Called when the pointer leaves the render
   * container. Default: undefined.
   */
  onLeave?: () => void

  /**
   * Async — awaited after hover starts (with a short debounce). Fine to hit
   * a network / disk cache; the view keeps `loading: true` in the tooltip
   * state until it resolves. Default: read macroDb[name].description.
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
   * Which DOM elements get highlighted on hover. Default:
   * {@link defaultHighlightStrategy}.
   */
  highlightStrategy?: SnlHighlightStrategy

  /**
   * Block/text renderers keyed by `react_renderer_key`. Default:
   * {@link defaultRenderers}. Merged (spread) over the defaults by the view.
   */
  renderers?: SnlRendererRegistry
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
  highlightStrategy: defaultHighlightStrategy,
  renderers: defaultRenderers,
  // onHover / onLeave intentionally undefined: the view's internal hover state
  // machine still runs; these hooks are only for consumers who want to intercept.
}
