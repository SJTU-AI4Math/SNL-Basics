# @snl-basics/react — Public API Reference

The stable surface of `@snl-basics/react` as of 2026-07-13.
Import everything from the package root:

```ts
import { … } from '@snl-basics/react'
```

Grouped by role. Every entry lists: **signature** · **role** · **stability** · **example** · **pitfalls**.

---

## Table of contents

1. [Data model (types)](#1-data-model)
2. [Parser](#2-parser)
3. [Macro DB](#3-macro-db)
4. [Rendering (React)](#4-rendering)
5. [Consumer cheat sheet](#5-consumer-cheat-sheet)

---

## 1. Data model

Pure TypeScript interfaces — data shapes shared between parser output, macro
definitions, and the render component. All immutable by convention; the lib
never mutates a caller-provided instance.

### `SnlSyntaxTree`

```ts
interface SnlSyntaxTree {
  name: string
  kind?: string            // 'bvar' | 'fvar' | 'binder' | 'rule' | 'const' | custom
  envMode?: 'formula_inline' | 'formula_display' | 'text' | 'block'
  style?: string           // resolved style tag (from `foo[style](…)`)
  children: SnlSyntaxTree[]
  mdata?: Record<string, unknown>
  scope?: string
}
```

- Root of every parsed SNL document. Union of three envMode branches; a node
  is either a formula-mode node (LaTeX in `name`), text-mode (React text),
  or block-mode (renders via a `react_renderer_key`).
- Produced by `parseSnlSyntaxTree` / `tryParseSnlSyntaxTree`, consumed by
  `SnlSyntaxTreeView`.
- **Pitfall**: `mdata.src` — set by the `x@srcEntry` postfix syntax; consumers
  use it to build cross-entry hover links.

### `SnlMacro`

```ts
interface SnlMacro {
  name: string             // globally unique, e.g. "Add.add", "FOL.forall"
  description: string      // human-readable, shown in tooltips
  source: SnlMacroSource   // { entries: string[], urls: string[] }
  kind?: string            // semantic kind — default = 'fvar'
  dynamic_arity: boolean   // true = has `#*` variadic slot
  styles: SnlMacroStyle[]  // NON-EMPTY; styles[0] is the implicit default
  tags?: string[]          // free-text search labels; no backslashes
}
```

- **All styles of a macro MUST accept the same arity.** Switching styles never
  changes child count — that's what makes `foo[styleB](args)` safe without
  spec input.

### `SnlMacroStyle`

```ts
interface SnlMacroStyle {
  tag: string              // unique within `SnlMacro.styles`
  mode: 'formula_inline' | 'formula_display' | 'text' | 'block'
  template: string         // LaTeX-native with #0, #1, #* placeholders
  variadic_left?: string   // wraps left of children.join(variadic_join)
  variadic_join?: string   // default ', ' (formula) / '' (text)
  variadic_right?: string  // wraps right
  react_renderer_key?: string  // dispatch key for block/text renderers
  tags?: string[]
}
```

### `SnlMacroDb`

```ts
type SnlMacroDb = Record<string, SnlMacro>
```

- Just a bag `name → SnlMacro`. The parser doesn't need it; renderer looks up
  `tree.name` in this map to resolve template + kind.
- Merge multiple sources with `{...base, ...overrides}`.

### `SnlMacroTemplateQuery`

```ts
type SnlMacroTemplateQuery = (
  args: SnlMacroTemplateQueryArgs
) => Promise<string>

interface SnlMacroTemplateQueryArgs {
  name: string
  node: SnlSyntaxTree
}
```

- The async LaTeX-template lookup used by `SnlSyntaxTreeView` during render.
- Build one from an `SnlMacroDb` via `createMacroTemplateQueryFromDb`.
- **Fallback contract**: when the name isn't in the DB, the query returns a
  legible fvar/bvar fallback template — never throws. Consumers can wrap the
  default query to inject their own resolution (e.g. cross-workspace lookup).

### `SnlRenderHooks`

```ts
interface SnlRenderHooks {
  onHover?: (event: SnlHoverEvent) => void
  onLeave?: () => void
  resolveMacroInfo?: (name: string, macro: SnlMacro | undefined) => Promise<SnlMacroInfo>
  resolveSource?: (source: SnlMacroSource) => SnlResolvedSource | null
  renderTooltip?: (state: SnlTooltipState) => ReactElement | null
  highlightStrategy?: SnlHighlightStrategy
  renderers?: SnlRendererRegistry     // block/text renderer overrides
}
```

- Every field optional; the view spreads yours over `defaultRenderHooks`.
- `resolveMacroInfo` is async and awaited before showing a tooltip.
- `resolveSource` is sync and called every render — no I/O.
- **Pitfall**: passing a NEW hooks object every render invalidates internal
  memo. Wrap in `useMemo`.

### `KindColoring` / `KindPalette`

```ts
interface KindColoring {
  stroke: string           // border / underline color (CSS)
  background: string       // fill color for badges (CSS)
}

type KindPalette = Record<string, KindColoring>
// keys are kind ids: 'bvar' | 'fvar' | 'binder' | 'rule' | 'const' | custom
```

- The color scheme the renderer uses to distinguish semantic kinds.
- Use `DEFAULT_KIND_PALETTE` as base; spread your overrides.

---

## 2. Parser

Pure sync functions — no React, no I/O, no async.

### `parseSnlSyntaxTree`

```ts
function parseSnlSyntaxTree(source: string): SnlSyntaxTree
```

- Throws `SnlSyntaxTreeParseError` on invalid input.
- Prefer `tryParseSnlSyntaxTree` unless you're inside a `try/catch` block already.

### `tryParseSnlSyntaxTree`

```ts
function tryParseSnlSyntaxTree(
  source: string
): { ok: true; tree: SnlSyntaxTree } | { ok: false; error: string; position: number }
```

- Non-throwing variant. `position` is a 0-indexed character offset into the
  source where parsing gave up — surface this to your editor's error UI.
- **Recommended default** for editors and linters.

```ts
const result = tryParseSnlSyntaxTree(userInput)
if (!result.ok) {
  showError(result.error, result.position)
  return
}
render(<SnlSyntaxTreeView tree={result.tree} … />)
```

### `createSnlSyntaxTreeNode`

```ts
function createSnlSyntaxTreeNode(name: string, opts?: {
  envMode?: SnlSyntaxTree['envMode']
  kind?: string
  children?: SnlSyntaxTree[]
}): SnlSyntaxTree
```

- Factory for a fresh leaf. Useful for GUI editors building trees programmatically
  (e.g. auto-fill child slots when the user types a fixed-arity macro name).
- Omitted fields stay `undefined` — respects the "empty by default" invariant.

---

## 3. Macro DB

### `bundledMacroDb`

```ts
const bundledMacroDb: SnlMacroDb
```

- The built-in fixture — a small demo/test DB shipped with the library so
  standalone consumers have something to render. Real projects should merge
  their own DB over the top:

```ts
const macroDb = { ...bundledMacroDb, ...myProjectMacros }
```

- **Not versioned as public data** — its contents may change between minor
  releases. Depend on shape, not identity.

### `createMacroTemplateQueryFromDb`

```ts
function createMacroTemplateQueryFromDb(db: SnlMacroDb): SnlMacroTemplateQuery
```

- Turns a static DB into the async query `SnlSyntaxTreeView` needs.
- Handles style resolution (`foo[bar]` → picks `styles.find(s => s.tag === 'bar')`
  or falls back to `styles[0]`), unresolved-name → fvar fallback, and
  binder/bvar shortcut rendering — you don't have to.
- Wrap it to inject side channels:

```ts
const base = createMacroTemplateQueryFromDb(macroDb)
const withLogging: SnlMacroTemplateQuery = async (args) => {
  console.log('query', args.name)
  return base(args)
}
```

---

## 4. Rendering

### `SnlSyntaxTreeView`

```ts
interface SnlSyntaxTreeViewProps {
  tree: SnlSyntaxTree
  query: SnlMacroTemplateQuery      // required, usually createMacroTemplateQueryFromDb(macroDb)
  macroDb: SnlMacroDb               // required, drives kind / style resolution
  katexOptions?: KatexOptions       // forwarded to katex.renderToString
  kindPalette?: KindPalette         // spread over DEFAULT_KIND_PALETTE
  onResolved?: (latex: string) => void  // fires when async render completes
  hooks?: SnlRenderHooks            // customization surface — see §1
}

const SnlSyntaxTreeView: React.FC<SnlSyntaxTreeViewProps>
```

- The main render component. Dispatches per envMode:
  - `formula_*` → KaTeX pipeline (async `renderToString` into a `ref`-managed div)
  - `text` → React `<TextRun>` (may embed `$…$` math islands via KaTeX)
  - `block` → React block renderer (via `react_renderer_key` lookup)
- **Async by nature**: after mount you'll see an empty container until KaTeX
  resolves. `onResolved` fires when the LaTeX is computed.
- **Pitfall (fixed 2026-07-13 in `d5a2f46`)**: container div is keyed by mode
  so a formula ⇄ text switch fully unmounts the old DOM. Don't wrap it in
  your own key that stays stable across mode changes.
- **Pitfall**: `macroDb` and `hooks` must be memoized. A new object each render
  cancels in-flight KaTeX and re-fires everything.

### `defaultRenderHooks`

```ts
const defaultRenderHooks: Required<SnlRenderHooks>
```

- Baseline for every hook. Spread yours over it:

```ts
const hooks: SnlRenderHooks = useMemo(() => ({
  ...defaultRenderHooks,
  resolveMacroInfo: async (name, macro) => myLookup(name),
}), [/* your deps */])
```

### `DEFAULT_KIND_PALETTE`

```ts
const DEFAULT_KIND_PALETTE: KindPalette
```

- Ships with entries for the built-in kinds (`bvar`, `fvar`, `binder`, `rule`,
  `const`). Spread your project palette over it.

---

## 5. Consumer cheat sheet

Which SNL-Doc-Extension file uses which exports.

| File                                        | Exports used                                                                                                                                            |
|---------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------|
| `webview/src/render/EntryRender.tsx`        | `parseSnlSyntaxTree` · `tryParseSnlSyntaxTree` · `createMacroTemplateQueryFromDb` · `defaultRenderHooks` · `SnlSyntaxTreeView` · `bundledMacroDb` · `SnlMacroDb` · `SnlMacroTemplateQuery` · `SnlRenderHooks` |
| `webview/src/CreateEntryApp.tsx`            | `tryParseSnlSyntaxTree` · `bundledMacroDb` · `createSnlSyntaxTreeNode` · `DEFAULT_KIND_PALETTE` · `SnlMacro` · `SnlMacroDb` · `SnlMacroStyle` · `SnlSyntaxTree` · `KindColoring` |
| `webview/src/CreateMacroApp.tsx`            | `tryParseSnlSyntaxTree` · `createMacroTemplateQueryFromDb` · `defaultRenderHooks` · `SnlSyntaxTreeView` · `bundledMacroDb` · `SnlMacro` · `SnlMacroDb` · `SnlMacroStyle` · `SnlSyntaxTree` · `SnlRenderHooks` · `KindPalette` |
| `webview/src/PackagePanelApp.tsx`           | `bundledMacroDb` · `createMacroTemplateQueryFromDb` · `defaultRenderHooks` · `SnlSyntaxTreeView` · `SnlMacro` · `SnlMacroDb` · `SnlSyntaxTree` · `SnlRenderHooks` |
| `webview/src/SnlGraphApp.tsx`               | `parseSnlSyntaxTree` · `tryParseSnlSyntaxTree` · `SnlSyntaxTree`                                                                                        |
| `webview/src/EntryInfoviewApp.tsx`          | `SnlMacroDb`                                                                                                                                            |
| `webview/src/App.tsx`                       | `SnlMacroDb`                                                                                                                                            |
| `webview/src/render/HoverPopoverProvider.tsx` | `SnlMacroDb`                                                                                                                                          |
| `webview/src/render/contextSrcLookup.ts`    | `parseSnlSyntaxTree` · `SnlSyntaxTree`                                                                                                                  |
| `src/snlDoc.ts` (extension host)            | `SnlMacroDb` (wire-shape reference only — no runtime import)                                                                                            |

**Legend**: `EntryRender` is the biggest consumer (uses ~half the surface); every
render path in the Extension goes through it. `snlDoc.ts` is the ONLY host-side
consumer and uses the type reference only — the actual runtime lives in
webview bundles.

---

## Stability

- Types (§1): stable. Additive fields may appear in minor releases; existing
  fields do not change shape without a major bump.
- Parser (§2): stable. Grammar changes go through a syntax-tree spec review
  before landing.
- Macro DB (§3): `bundledMacroDb` contents are illustrative and may drift.
  `createMacroTemplateQueryFromDb`'s fallback rules are stable.
- Rendering (§4): stable surface, but internal render pipeline (React vs
  KaTeX split) has been evolving; expect additive `hooks` fields and new
  `react_renderer_key` defaults.
- Anything NOT in this document is internal and may change without notice.
  If you need one of the internal helpers (`resolveStyle`, `fillLatexTemplate`,
  `escapeLatexText`, …), file an issue so we can promote it to the public
  surface deliberately.
