/**
 * SnlInteractionDriver — injectable interaction handler for SnlSyntaxTreeView.
 *
 * Delegated event model: the View attaches a single set of event listeners
 * on the container root and dispatches through the driver. The driver receives
 * the actual tree node + its tree_path (resolved from `data-tree-path` DOM
 * attributes) for every interaction.
 *
 * Design:
 *  - Class-based, instantiated by consumer and passed to the View.
 *  - All callbacks are async-capable.
 *  - Context includes full modifier key state (ctrl/meta/shift/alt).
 *  - Ctrl+click is `ctrl_key` ONLY — macOS Meta is NOT treated as Ctrl.
 *  - When no custom callbacks are provided, the default tooltip behavior
 *    from SnlRenderHooks is preserved.
 *  - onCtrlClick falls back to onClick if not defined.
 */

import type { SnlSyntaxTree } from '../snl-syntax-tree/types'
import type { SnlMacro } from '../snl-macro/types'
import type { SnlActivationLease } from './deactivation-controller'

// ─── TreePath ────────────────────────────────────────────────────────────────

/**
 * A path from root to a node in the tree, expressed as child indices.
 * E.g. `[0, 2, 1]` means root.children[0].children[2].children[1].
 * The root itself has path `[]`.
 */
export type TreePath = readonly number[]

/**
 * Encode a tree path as the string stored in `data-tree-path`.
 * Format: dot-separated indices, e.g. "0.2.1". Root = "".
 */
export function encodeTreePath(path: TreePath): string {
  return path.join('.')
}

/**
 * Decode a `data-tree-path` attribute value back to a TreePath.
 * Returns `[]` for empty string (root).
 */
export function decodeTreePath(attr: string): TreePath {
  if (!attr) return []
  return attr.split('.').map(Number)
}

/**
 * Walk a tree following a path to retrieve the node at that location.
 * Returns undefined if the path is invalid.
 */
export function resolveTreePath(
  root: SnlSyntaxTree,
  path: TreePath,
): SnlSyntaxTree | undefined {
  let current: SnlSyntaxTree = root
  for (const index of path) {
    if (!current.children[index]) return undefined
    current = current.children[index]
  }
  return current
}

// ─── Event context ───────────────────────────────────────────────────────────

/** Full context passed to every interaction callback. */
export interface SnlInteractionContext {
  /** The syntax-tree node that was interacted with. */
  readonly node: SnlSyntaxTree
  /** Path from tree root to this node (child indices). */
  readonly tree_path: TreePath
  /** The resolved macro for this node, or null if unknown/env_mode. */
  readonly macro: SnlMacro | null
  /** The DOM element that triggered the event. */
  readonly target: HTMLElement
  /** Generation-safe handle for clearing exactly this activation. Real view events provide it. */
  readonly activation?: SnlActivationLease
  /** Client X coordinate of the pointer. */
  readonly client_x: number
  /** Client Y coordinate of the pointer. */
  readonly client_y: number
  /** Modifier key state at event time. */
  readonly ctrl_key: boolean
  readonly meta_key: boolean
  readonly shift_key: boolean
  readonly alt_key: boolean
}

// ─── Callback types ──────────────────────────────────────────────────────────

export type InteractionCallback = (ctx: SnlInteractionContext) => void | Promise<void>
export type LeaveCallback = () => void | Promise<void>

// ─── SnlInteractionDriver class ──────────────────────────────────────────────

export interface SnlInteractionDriverOptions {
  /** Called when pointer enters a node's rendered region. */
  on_hover?: InteractionCallback
  /** Called when pointer leaves the rendered container entirely. */
  on_leave?: LeaveCallback
  /** Called on primary click on a node. */
  on_click?: InteractionCallback
  /**
   * Called on Ctrl+click (ctrl_key === true, NOT Meta).
   * Falls back to on_click if not defined.
   */
  on_ctrl_click?: InteractionCallback
}

/**
 * Injectable interaction driver for SnlSyntaxTreeView.
 *
 * When callbacks are absent, the View preserves its default tooltip
 * behavior from SnlRenderHooks. Only explicitly provided callbacks
 * override the defaults.
 */
export class SnlInteractionDriver {
  readonly on_hover: InteractionCallback | undefined
  readonly on_leave: LeaveCallback | undefined
  readonly on_click: InteractionCallback | undefined
  readonly on_ctrl_click: InteractionCallback | undefined

  constructor(options: SnlInteractionDriverOptions = {}) {
    this.on_hover = options.on_hover
    this.on_leave = options.on_leave
    this.on_click = options.on_click
    this.on_ctrl_click = options.on_ctrl_click
  }

  /**
   * Dispatch a click event. If ctrl_key is true and on_ctrl_click is defined,
   * calls on_ctrl_click; otherwise falls back to on_click.
   */
  async dispatch_click(ctx: SnlInteractionContext): Promise<void> {
    if (ctx.ctrl_key && this.on_ctrl_click) {
      await this.on_ctrl_click(ctx)
    } else if (ctx.ctrl_key && !this.on_ctrl_click && this.on_click) {
      // Ctrl+click falls back to regular click if no ctrl handler
      await this.on_click(ctx)
    } else if (!ctx.ctrl_key && this.on_click) {
      await this.on_click(ctx)
    }
  }

  /**
   * Dispatch a hover event.
   */
  async dispatch_hover(ctx: SnlInteractionContext): Promise<void> {
    if (this.on_hover) {
      await this.on_hover(ctx)
    }
  }

  /**
   * Dispatch a leave event.
   */
  async dispatch_leave(): Promise<void> {
    if (this.on_leave) {
      await this.on_leave()
    }
  }
}
