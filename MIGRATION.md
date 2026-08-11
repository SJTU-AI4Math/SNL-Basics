# Migration: Fulcrum-Smarterm → SNL-Basics

**Date:** 2026-07-01

## Package 0.2.1

- Macro schema 11 moves every render field into one complete TemplateSpec at
  `style.template`. The template may be invariant or localized as a whole;
  language never mixes mode, body, separator, block renderer, or consumer
  extensions from different projections.
- Each localized projection within one Style has the same escape-aware
  placeholder contract. Separate explicit Styles may intentionally omit or
  reveal children while preserving the same parsed syntax tree.
- Run `node scripts/migrate-schema.mjs --write --target <path>` to migrate mixed
  Macro v6-v10 records to v11. Current v11 documents are fixed points.

## Package 0.2.0

- Macro schema 10 preserves consumer-defined kind strings for metadata and
  palette lookup. Persisted `partial` is renamed to `sub`; a missing kind is
  materialized as `const`. Only `sub`, `binder`, `bvar`, and `fvar` select
  special behavior, while every other string follows const behavior without
  losing its presentation identity.
- Kind palettes and Entry Kind coloring accept either the legacy flat
  `{ stroke, background }` pair or a theme-aware `{ light, dark }` pair. Flat
  input applies to both themes; `paletteToCss(palette)` remains a light-context
  shorthand.
- The public runtime `SnlMacro` type accepted the deprecated 0.1.x
  `default_style` map and honored language → `en` → `styles[0]` selection so an
  existing query backend could upgrade directly. Schema 10 was canonical for
  package 0.2.x: `migrateMacroDocument` removed the map and current-document
  validation rejected it.
- Tree schema 3 replaces persisted `partial` with `sub`, removes derived
  `bindRef`, and stores structured source references. Basics does not silently
  rewrite consumer storage; run the schema migration or the Extension workspace
  migration before loading old persisted data.
- `@x` declares one leaf binder. `x@entry`, `x@#0.1`, and `x@#binderName` denote
  Entry, explicit tree-position, and named local sources respectively.
- Temporary `%…%`, `$…$`, `$$…$$`, and `` `…` `` nodes use tree-coordinate
  internal names (`#`, `#0`, …); their literal payload is separate. Backticks
  are formula-mode `\texttt` sugar, not a new rendering mode.
- `sub` is metadata-transparent and delegates interaction to its nearest semantic
  parent. A root `sub` remains bare rendered content.
- Activation clearing and recursive popover dismissal now have independent,
  synchronous policy controllers. `SnlDeactivationController` owns one view's
  generation-safe activation lease; `HoverPopoverDismissController` receives
  immutable `descendants` / `subtree` / `unfrozen-subtree` / `all` requests.
  Existing behavior is unchanged when the optional controllers are omitted.
  `runDefault()` is valid only during the handler call, owner unmount cleanup is
  non-cancelable, and provider teardown bypasses request/deactivation policy
  while still completing `on_removed` once per removed layer. A vetoed
  `sibling-replaced` request keeps the old sibling and intentionally allows the
  new pin to coexist.
- Delegated SNL activation now yields structurally to native/ARIA controls and
  `[data-snl-interaction-boundary]` descendants inside custom Blocks; renderers
  no longer need to rely on bubble-handler ordering for control priority.

## Package 0.1.4

Unclassified syntax-tree roots now default to Macro Kind `partial`; unclassified
descendants continue to default to `fvar`. Explicit node and Macro kinds still
win. `SnlRenderHooks` adds independent `onHover1s` and `onHover2s` phases beside
`onHover`. The default timeline is highlight immediately, show at one second,
lock at two seconds, and show+lock immediately on click. Custom tooltip renderers
receive optional `SnlTooltipState.locked`. All phases in one uninterrupted hover
share an exported `SnlHoverSession` through the hook-specific
`SnlHoverPhaseEvent.session` for identity and data exchange; the legacy
`SnlHoverEvent` shape remains constructible. Changing the node or tree cancels
the old session.

## Package 0.1.3

Plain SNL identifiers now accept visible non-ASCII Unicode while preserving the
existing ASCII allow-list. This changes lexical acceptance only; Macro schema
remains v8. Use `isSnlIdentifier` instead of maintaining a separate validator.

## Rename event

This repository was renamed from **Fulcrum-Smarterm** to **SNL-Basics**
(project name **SNL_Basics**).

- **From:** `Fulcrum-Smarterm`
- **To:** `SNL-Basics`
- **Workspace path change:** `~/.openclaw/workspace/cat-repos/Fulcrum-Smarterm`
  → `~/.openclaw/workspace/cat-repos/SNL-Basics`
- **Remote:** `git@github-snl-basics:SJTU-AI4Math/SNL-Basics.git` (unchanged `origin`)

## History integrity

No git history is broken by this rename. The workspace directory rename is a
pure filesystem move; all commits, refs, and blobs are preserved. Subsequent
source-tree renames are performed with `git mv` to preserve per-file history.

## Phased rename plan

- **Phase 1 (this migration):** pure mechanical rename + typo fix.
  - Commit 1: this `MIGRATION.md` (workspace + docs rename record).
  - Commit 2: `git mv` of source directories/files (`operator-tree` →
    `snl-syntax-tree`, `operator-katex` → `snl-react-view`,
    `OperatorTreeEditor` → `SnlSyntaxTreeEditor`,
    `OperatorTreeKaTeXView` → `SnlSyntaxTreeView`) + import-path updates only.
  - Commit 3: identifier rename (`Operator*`/`OperatorTree` →
    `SnlMacro*`/`SnlSyntaxTree`), package name (`@fulcrum-smarterm/operator-katex`
    → `@sjtu-ai4math/snl-basics`), CSS class rename (`.katex-*` custom classes →
    `.snl-*`), data-file rename (`katex-template-db.json` → `snl-macro-db.json`),
    and the `contantSubtree` → `constantSubtree` typo fix.
- **Phase 3 (later):** removal of the `[style]` parser DSL. Not part of this
  migration.

## Notes

- The typo `contantSubtree` → `constantSubtree` is fixed globally in Phase 1
  (Commit 3). This `MIGRATION.md` intentionally records the old spelling for
  historical reference.

## Template DSL v1 → v2 (2026-07-02)

The macro-DB template syntax changed from the `@…@` placeholder DSL with
hand-written `\htmlData` wrappers to LaTeX-native macro-argument syntax with
automatic wrapping.

**v1 (removed):**

- `@CHILD0@` / `@CHILD1@` / … — fixed-arity children
- `@CHILDREN@` — variadic children
- `@NAME@` / `@KIND@` / `@BIND_REF@` / `@BIND_REF_ATTR@` — node metadata
- Templates hand-wrote their own `\htmlData{name=@NAME@,kind=…}{…}` wrappers
  (often double-wrapped: an outer `constantSubtree` + an inner kind wrapper).

**v2 (current):**

- `#0` / `#1` / … — 0-indexed children
- `#*` — variadic children (joined by `separator`)
- `\#` — literal `#`
- Node metadata (`name`, `kind`, `bindRef`) is **no longer** written in
  templates. The view layer auto-wraps every rendered node in a single
  `\htmlData{name=<macro>,kind=<node.kind>[,bindRef=<ref>][,tree-path=<path>]}{…}`.

This is a schema break — the migrated DB is not compatible with library
versions `< 0.2.1`.

## Schema v7 + Tree v2 (0.10.0, 2026-07-18)

Major rename of all schema and tree fields to snake_case for consistency.
The View API also changes from dual `query`/`macroDb` props to a single
`macro_data_driver` prop.

### Macro schema renames (v5 → v7)

| Old (0.9.x)           | New (0.10.0)          |
|-----------------------|-----------------------|
| `SnlMacroStyle.tag`   | `SnlMacroStyle.style_name` |
| `SnlMacroStyle.react_renderer_key` | `SnlMacroStyle.block_template_name` |
| `SnlMacroStyle.variadic_left/join/right` | Removed; use `separator` + `#*` template |
| (n/a)                 | `SnlMacro.tags: string[]` (required) |
| (n/a)                 | `SnlMacroStyle.tags: string[]` (required) |

Note: `SnlMacro.name` stays as `name` (NOT renamed to `macro_name`).

### Syntax tree renames (v1 → v2)

| Old (0.9.x)       | New (0.10.0)       |
|-------------------|--------------------|
| `node.name`       | `node.macro_name`  |
| `node.style`      | `node.style_name`  |
| `node.envMode`    | `node.env_mode`    |

### View API changes

| Old (0.9.x)                        | New (0.10.0)            |
|-------------------------------------|-------------------------|
| `<View query={q} macroDb={db} …>`  | `<View macro_data_driver={driver} …>` |
| `createMacroTemplateQueryFromDb(db)` (public) | Removed |
| `bundledMacroDb` (direct import)    | Import JSON and implement `MacroDataQueries` |
| `loadSnlMacroDb(url)` (public)      | Removed — implement custom `MacroDataQueries` |
| `createDefaultMacroTemplateQuery()` (public) | Removed |
| `SnlMacroTemplateQuery` type (public) | Removed |
| `SnlMacroDb` type (public)          | Removed; internal alias renamed to `SnlMacroRecord` |

### New exports

- `MacroDataDriver` (class) — query-only data-access layer with LRU cache + in-flight dedup
- `MacroDataQueries` (interface) — `{ query_macro({macro_name, signal?}): Promise<SnlMacro|null> }`
- `SnlInteractionDriver` (class) — injectable event driver (hover/leave/click/ctrl-click)
- `SnlInteractionContext` — full event context (node, tree_path, macro, modifiers)
- `TreePath` — tree path type for interaction events
- `encodeTreePath` / `decodeTreePath` / `resolveTreePath` — path utilities
- `src/schema/` migration module — `migrateMacroDocument`, `migrateSyntaxTreeDocument`

### Migration CLI

```bash
node scripts/migrate-schema.mjs --target macros.json
node scripts/migrate-schema.mjs --write --target macros.json
```

Idempotent — skips entries already in the current v11 shape, including inside
mixed-version documents. A redundant legacy `default_style` map is removed
automatically when every mapping points to `styles[0]`. Published v8 language-split defaults are upgraded
by projecting each selected complete render template: the migrator inserts a
localized synthetic `styles[0]` and retains every old style
so explicit v8 `[style]` source keeps resolving. When the legacy map contains
`en`, that mapped Style remains the fallback for unmapped locales; when it does
not, the synthetic template stores the old `styles[0]` complete projection as its fallback.
Mapped Styles with incompatible invariant metadata such as tags are rejected
rather than silently changing rendering semantics.

## Macro schema v11 template-scope localization

`styles[0]` is the sole implicit style. Each Style keeps invariant identity and
tags while its `template` is either one complete TemplateSpec or an `I18n` of
complete TemplateSpecs:

```json
{
  "styles": [
    {
      "style_name": "prose",
      "template": {
        "type": "i18n",
        "default_language": "en",
        "values": {
          "en": { "mode": "text", "body": "#0 is a group" },
          "zh-CN": { "mode": "text", "body": "#0 是群" }
        }
      },
      "tags": []
    }
  ]
}
```

Explicit `Macro[style](...)` selection is unchanged and always takes priority.
Language resolves one complete projection inside the selected Style; it never
selects a different Style. Mode, body, separator, block renderer, and consumer
backends therefore cannot fall back independently. All projections within one
Style share one escape-aware arity contract; separate explicit Styles may
intentionally omit or reveal children. Entry content I18n is unchanged.

### Consumer upgrade path

```diff
- import { createMacroTemplateQueryFromDb, bundledMacroDb, SnlSyntaxTreeView } from '@sjtu-ai4math/snl-basics'
- const query = createMacroTemplateQueryFromDb(bundledMacroDb)
- <SnlSyntaxTreeView tree={tree} query={query} macroDb={bundledMacroDb} />
+ import { MacroDataDriver, SnlSyntaxTreeView } from '@sjtu-ai4math/snl-basics'
+ import macroDb from './path/to/snl-macro-db.json'
+ const driver = new MacroDataDriver({
+   queries: { query_macro: async ({ macro_name }) => macroDb[macro_name] ?? null },
+ })
+ <SnlSyntaxTreeView tree={tree} macro_data_driver={driver} />
```
