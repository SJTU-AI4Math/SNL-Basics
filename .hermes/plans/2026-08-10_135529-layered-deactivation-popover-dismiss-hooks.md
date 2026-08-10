# Layered Deactivation and Popover Dismiss Hooks Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make SNL activation clearing and hierarchical popover dismissal consumer-customizable without losing parent/child dismissal semantics, leaking timers, or letting stale popovers clear newer activations.

**Architecture:** Add two synchronous controller surfaces. `SnlDeactivationController` owns one `SnlSyntaxTreeView` activation lifecycle and mirrors `SnlActivationController.runDefault()`. `HoverPopoverDismissController` owns graph-scoped close requests. Every popover may carry a generation-safe activation lease; accepted dismissal requests deactivate only the doomed layers, leaf-first, then close/remove those popovers.

**Tech Stack:** TypeScript, React, Vitest, Testing Library, existing `SnlActivationController`, `HoverPopoverProvider`, `SnlInteractionDriver`, `EntryPreviewProvider`.

---

## 1. Design constraints

1. Do not place popover policy in `SnlRenderHooks`. `HoverPopoverProvider<TSubject>` is generic and can exist without an SNL renderer.
2. Do not expose raw React setters or make consumers locate `.snl-container` through DOM traversal.
3. Activation clearing is local to one `SnlSyntaxTreeView`; popover dismissal is graph-scoped.
4. A popover owns an activation **lease**, not a bare `HTMLElement`.
5. A lease is generation-safe and idempotent: dismissing an old popover must not clear a newer activation in the same view.
6. Hook dispatch is synchronous. `runDefault()` is valid only during the handler stack, runs at most once, and cannot be delayed through a Promise/thenable.
7. Consumer throws/rejections cannot break default internal state or leave half-mutated graph state.
8. Provider unmount and timer disposal are mandatory resource cleanup, not vetoable policy.
9. Closing begins immediately after an accepted request; physical DOM removal may wait for `fadeMs`.
10. Deactivation happens when closing is accepted, before paint, not after fade completion.

## 2. Public API sketch

### 2.1 Local activation lease and deactivation controller

```ts
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
  /** Returns false when this lease is stale or already deactivated. */
  request_deactivate(reason: SnlDeactivationReason, cause?: unknown): boolean
}

export interface SnlDeactivationDispatch<P, E> {
  readonly reason: SnlDeactivationReason
  readonly event: E
  readonly params: P
  readonly activation: SnlActivationSnapshot
  runDefault(): void
}

export type SnlDeactivationHandler<P, E> =
  (dispatch: SnlDeactivationDispatch<P, E>) => void

export interface SnlDeactivationControllerOptions<P, E> {
  enabled?: boolean
  defaultBehavior?: boolean
  params: P
  handlers?: Partial<Record<SnlDeactivationReason, SnlDeactivationHandler<P, E>>>
}

export class SnlDeactivationController<P = unknown, E = unknown> {
  dispatch(
    reason: SnlDeactivationReason,
    activation: SnlActivationSnapshot,
    event: E,
    runDefault: () => void,
  ): boolean
}
```

Add to `SnlInteractionContext`:

```ts
readonly activation: SnlActivationLease
```

Add to `SnlSyntaxTreeView` props:

```ts
deactivation_controller?: SnlDeactivationController<any, any>
```

The internal default clear operation must be one centralized function that:

- increments/cancels generation only when the lease is current;
- clears async info requests and hover timers;
- clears hover session;
- removes all hover classes in that view container;
- resets tooltip/hover React state.

### 2.2 Hierarchical popover dismissal controller

```ts
export type HoverPopoverDismissReason =
  | 'pointer-exit'
  | 'outside-pointer-down'
  | 'escape'
  | 'ancestor-interaction'
  | 'sibling-replaced'
  | 'owner-unmount'
  | 'explicit-api'

export type HoverPopoverDismissScope =
  | { kind: 'descendants'; anchor_id: string }
  | { kind: 'subtree'; anchor_id: string }
  | { kind: 'unfrozen-subtree'; anchor_id: string }
  | { kind: 'all' }

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
```

Provider props:

```ts
dismiss_controller?: HoverPopoverDismissController<any, TSubject>
```

Popover creation gets a backward-compatible final options bag:

```ts
interface HoverPopoverOwner {
  activation?: SnlActivationLease
}

preview(subject, origin, x, y, parentId, owner?: HoverPopoverOwner): string
pin(subject, origin, x, y, parentId, owner?: HoverPopoverOwner): string
```

Expose `dismissSubtree(id)` publicly in addition to existing `dismissDescendants` and `dismissAll`. Keep `cancelUnfrozen` as the compatibility alias for an `unfrozen-subtree` request.

## 3. Request matrix

| Trigger | Reason | Scope | Cancelable | Parent preserved |
|---|---|---|---:|---:|
| Pointer leaves hover corridor | `pointer-exit` | `unfrozen-subtree(id)` | yes | yes |
| Pointer-down inside popover P | `ancestor-interaction` | `descendants(P)` | yes | yes |
| Pin a new sibling under parent P | `sibling-replaced` | `subtree(oldSibling)` | yes | yes |
| Pointer-down outside all origins/popovers | `outside-pointer-down` | `all` | yes | no |
| Escape | `escape` | `all` | yes | no |
| Entry owner unmount | `owner-unmount` | `unfrozen-subtree(id)` | no | frozen descendants may survive/reparent |
| Public API | `explicit-api` | caller-selected scope | yes | depends on scope |
| Provider unmount | no policy dispatch | force timer/DOM cleanup | no | n/a |

`owner-unmount` may notify the controller, but cannot be vetoed. Provider teardown bypasses policy hooks entirely and only performs resource disposal.

## 4. Accepted dismissal algorithm

1. Snapshot the live graph once.
2. Resolve the requested scope to a stable target ID set.
3. Remove IDs already in `closing` phase.
4. Create immutable target snapshots for the hook.
5. Dispatch the synchronous request controller.
6. If accepted, sort targets by depth descending.
7. Call each target activation lease with `popover-dismiss`; stale leases return false and do nothing.
8. Clear open/freeze timers for doomed IDs.
9. Remove `opening` targets immediately.
10. Mark `visible` targets as `closing` and schedule physical removal after `fadeMs`.
11. Reparent preserved frozen descendants only for `unfrozen-subtree`, using the current existing algorithm.
12. After physical removal, issue notification-only `on_removed`; it cannot restore/veto state.

Do not run one hook per target. Dispatch once per user/system request with a complete immutable target list; this prevents partial closure when a handler throws halfway through.

## 5. Entry integration

`SnlSyntaxTreeView` creates a lease whenever a node activation becomes current. `SnlEntryBody` receives the lease in `SnlInteractionContext`. `EntryPreviewBridge.show/pin` attaches that lease to the created/reused popover.

Important cases:

- Dismissing child C invokes only C's lease. Parent P remains highlighted and open.
- Dismissing subtree P invokes child leases before P's lease.
- Pinning a new sibling activates generation N+1 before the old sibling's delayed close; the old N lease cannot clear N+1.
- A controlled consumer may veto popup dismissal and leave both popup and activation intact by not calling `runDefault()`.
- A consumer may customize deactivation separately. If it suppresses deactivation but accepts popup dismissal, a persistent highlight is its explicit policy, not a Basics bug.

## 6. Tasks

### Task 1: Centralize local deactivation

**Files:**
- Create: `src/snl-react-view/deactivation-controller.ts`
- Modify: `src/components/SnlSyntaxTreeView.tsx`
- Modify: `src/snl-react-view/interaction-driver.ts`
- Modify: `src/snl-react-view/index.ts`
- Test: `src/snl-react-view/deactivation-controller.test.ts`
- Test: `src/snl-react-view/view-integration.test.tsx`

**TDD:**

1. RED: pointer leave, blank click, explicit lease, delayed `runDefault`, repeated call, stale generation, sync throw.
2. Implement controller using the same synchronous capability pattern as `SnlActivationController`.
3. Replace duplicated local clear sequences with one generation-checked default function.
4. GREEN focused tests and TypeScript.

### Task 2: Route all popover destruction through one request function

**Files:**
- Create: `src/snl-react-view/popover-dismiss-controller.ts`
- Modify: `src/snl-react-view/hover-popovers.tsx`
- Modify: `src/snl-react-view/index.ts`
- Test: `src/snl-react-view/hover-popovers.test.tsx`

**TDD:**

1. RED each row in the request matrix.
2. Add one `requestDismiss(reason, scope, event?)` path.
3. Preserve current fade, timer, frozen reparenting, capture-phase outside click and Escape behavior.
4. Keep provider-unmount cleanup unhookable.
5. GREEN focused tests.

### Task 3: Bind leases to recursive Entry popovers

**Files:**
- Modify: `src/entry-react/entry-render.tsx`
- Modify: `src/entry-react/index.ts`
- Test: `src/entry-react/entry-render.test.tsx`
- Test: `src/snl-react-view/hover-popovers.test.tsx`

**TDD:**

1. RED: parent → child → grandchild, dismiss grandchild, parent/child remain active.
2. RED: interact in parent, only descendants close/deactivate.
3. RED: pin sibling, old generation cannot clear new highlight.
4. RED: outside/Escape clears every layer.
5. Wire `context.activation` through `PreviewController.show/pin`.
6. GREEN tests.

### Task 4: Extension real-path integration

**Files:**
- Modify: `/tmp/snl-extension-0.2-migration/webview/src/render/EntryRenderRealClick.test.tsx`
- Add or modify a dedicated nested Entry popover integration test.

**TDD scenarios:**

1. Real SNL node click pins parent.
2. Node inside parent pins child.
3. Child dismissal clears only child activation classes.
4. Parent interaction clears child/grandchild only.
5. Outside pointer-down stopped in bubble phase still clears all via document capture.
6. Popover body, origin node and Entry Block Ctrl-click do not accidentally clear the wrong layer.

### Task 5: Public declarations and documentation

**Files:**
- Modify: `scripts/verify-subpath-types.ts`
- Modify: `README.md`
- Modify: `README(ZH).md`
- Modify: `MIGRATION.md`
- Modify: skill reference `references/controlled-popover-snl-activation.md` after implementation is verified.

Document:

- controller versus React Hook terminology;
- synchronous `runDefault()` capability;
- cancelable versus forced reasons;
- graph scope semantics;
- generation-safe activation lease;
- controlled consumer examples.

## 7. Verification gates

Basics:

```bash
npx vitest run src/snl-react-view/deactivation-controller.test.ts \
  src/snl-react-view/hover-popovers.test.tsx \
  src/snl-react-view/view-integration.test.tsx \
  src/entry-react/entry-render.test.tsx
npx tsc --noEmit
npm test
npm run build:lib
npm pack --json
```

Clean consumer:

- compile default controller usage;
- compile custom controller with `runDefault()`;
- runtime-test nested dismiss scopes from packed bytes.

Extension:

```bash
npm test
npm run smoke
npm run build:webview
npm run compile
npx vsce package --out /tmp/snl-doc-extension-dismiss-hooks.vsix
npm run smoke:vsix-host -- /tmp/snl-doc-extension-dismiss-hooks.vsix
```

Final browser verification must use the real Entry route and inspect actual `.snl-single-hover` classes at every popover layer.

## 8. Risks and deliberate non-goals

- **No async policy hook:** graph state can change while awaiting, and delayed `runDefault()` recreates the capability leak already fixed for activation.
- **No arbitrary target-ID filtering in v1:** deleting arbitrary middle nodes requires complex survivor reparenting. Callers choose one of the safe graph scopes instead.
- **No hook around provider teardown:** lifecycle cleanup must always finish.
- **No DOM-parent guessing:** activation leases own cleanup.
- **No second document outside-click listener in Entry integration:** keep one provider capture listener.
- **No serialized activation/popover state:** all leases and controllers are runtime-only.
