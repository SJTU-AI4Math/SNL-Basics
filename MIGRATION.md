# Migration: Fulcrum-Smarterm → SNL-Basics

**Date:** 2026-07-01

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
    → `@snl-basics/react`), CSS class rename (`.katex-*` custom classes →
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

Run `npm run migrate-db-v2` (`scripts/migrate-macro-db-v2.mjs`, `--dry-run`
supported) to transform a v1 DB: it strips **all** `\htmlData` wrappers with a
balanced-brace parser and rewrites `@CHILDn@ → #n` / `@CHILDREN@ → #*`.

This is a schema break — the migrated DB is not compatible with library
versions `< 0.3.0`.

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
node scripts/migrate-schema.mjs             # preview changes (default dry-run)
node scripts/migrate-schema.mjs --write     # back up and apply migration
```

Idempotent — skips documents already in v7 shape.

### Consumer upgrade path

```diff
- import { createMacroTemplateQueryFromDb, bundledMacroDb, SnlSyntaxTreeView } from '@snl-basics/react'
- const query = createMacroTemplateQueryFromDb(bundledMacroDb)
- <SnlSyntaxTreeView tree={tree} query={query} macroDb={bundledMacroDb} />
+ import { MacroDataDriver, SnlSyntaxTreeView } from '@snl-basics/react'
+ import macroDb from './path/to/snl-macro-db.json'
+ const driver = new MacroDataDriver({
+   queries: { query_macro: async ({ macro_name }) => macroDb[macro_name] ?? null },
+ })
+ <SnlSyntaxTreeView tree={tree} macro_data_driver={driver} />
```
