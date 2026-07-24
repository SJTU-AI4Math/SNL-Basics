# SNL-Basics

Structured Natural Language (SNL) base library — parse a macro DSL into syntax
trees and render them to KaTeX-in-React with hover interactions.

Output backends (Typst / LaTeX / Markdown / plain text) are **consumer-side
concerns** and live in downstream extensions (e.g. SNL-Doc-Extension), not in
this render-only library.

Design goals: **simple, clear interfaces · highly modular · deeply customizable.**
Every interaction (tooltip, hover highlight, source resolution, block rendering)
is overridable through a single `hooks` prop.

## Install

```bash
npm i @snl-basics/react katex react react-dom
```

`react`, `react-dom`, and `katex` are **peerDependencies** — the library never
bundles its own copy (see [Bundling](#bundling-vite--webpack)).

Import the stylesheets once (KaTeX + the SNL hover/block styles):

```ts
import 'katex/dist/katex.min.css'
import '@snl-basics/react/style.css'
```

## 5-minute quickstart

Create a query-only `MacroDataDriver`, parse an expression, and render:

```tsx
import 'katex/dist/katex.min.css'
import '@snl-basics/react/style.css'

import { useMemo } from 'react'
import {
  SnlSyntaxTreeView,
  MacroDataDriver,
  parseSnlSyntaxTree,
  annotateBindings,
  type SnlSyntaxTree,
} from '@snl-basics/react'

// Your macro definitions (or fetch from a server/file)
import macroDb from './my-macros.json'

export function Demo() {
  // 1. Create a MacroDataDriver — the query-only data source for the view.
  const driver = useMemo(
    () => new MacroDataDriver({
      queries: {
        async query_macro({ macro_name }) {
          return macroDb[macro_name] ?? null
        },
      },
    }),
    [],
  )

  // 2. Parse SNL source, then annotate binders/bound-variables for hover.
  const tree: SnlSyntaxTree = useMemo(() => {
    const t = parseSnlSyntaxTree('FOL.forall(x, FOL.eq(x, x))')
    annotateBindings(t)
    return t
  }, [])

  // 3. Render. Hover-enabling KaTeX options are applied by default (see below).
  return (
    <SnlSyntaxTreeView
      tree={tree}
      macro_data_driver={driver}
      katexOptions={{ displayMode: true }}
    />
  )
}
```

For async/remote backends, implement `MacroDataQueries` directly:

```tsx
import { MacroDataDriver } from '@snl-basics/react'

const driver = new MacroDataDriver({
  queries: {
    query_macro: async ({ macro_name }) => {
      const res = await fetch(`/api/macros/${macro_name}`)
      return res.ok ? res.json() : null
    },
  },
})
```

## Optional complete Entry renderer

Complete Entry cards are available only from the tree-shakeable
`@snl-basics/react/entry` subpath. The package root does not import its Markdown
dependencies.

```tsx
import { EntryDataDriver, EntryPreviewProvider, EntryView } from '@snl-basics/react/entry'
import '@snl-basics/react/entry/style.css'

const entries = new EntryDataDriver({
  queries: {
    query_entry: async ({ entry_id, signal }) => fetchEntry(entry_id, signal),
    query_entry_kind: async ({ kind_id, signal }) => fetchEntryKind(kind_id, signal),
  },
})

<EntryPreviewProvider entry_data_driver={entries} macro_data_driver={driver}>
  <EntryView entry_id="definition.ring" entry_data_driver={entries} macro_data_driver={driver} />
</EntryPreviewProvider>
```

The renderer selects nonblank SNL, Markdown, LaTeX, or text in that order,
handles empty/error cards and title math, queries context-bound sources, and
supports recursive macro-source previews. Storage, pointers, and host actions
remain injected adapters. See [Generic Entry rendering](docs/entry-rendering.md).

### KaTeX options — hover requires `trust: true` / `strict: false` ⚠️

**`SnlSyntaxTreeView` merges `{ trust: true, strict: false }` into
`katexOptions` by default so `\htmlData` (which powers hover) survives.**
Override at your own risk — passing `trust: false` will silently break hover
(KaTeX drops the `\htmlData` extension and no `data-*` attributes reach the
DOM, so `onHover` never fires).

If you call `katex.renderToString` directly for a custom block renderer, import
and spread the same preset so your output keeps the hover hooks:

```tsx
import katex from 'katex'
import { HTMLDATA_KATEX_DEFAULTS } from '@snl-basics/react'

katex.renderToString(latex, { throwOnError: false, ...HTMLDATA_KATEX_DEFAULTS })
```

## Offline / bundled usage (VS Code, Electron, Node)

No network required — load a macro JSON file and create a driver from it.
The bundled `public/snl-macro-db.json` ships with the package:

```tsx
import {
  MacroDataDriver,
  parseSnlSyntaxTree,
  SnlSyntaxTreeView,
} from '@snl-basics/react'
import 'katex/dist/katex.min.css'
import '@snl-basics/react/style.css'
import macroDb from '../public/snl-macro-db.json'

const driver = new MacroDataDriver({
  queries: {
    async query_macro({ macro_name }) {
      return macroDb[macro_name] ?? null
    },
  },
})
const tree = parseSnlSyntaxTree('FOL.implies(a, b)')
// <SnlSyntaxTreeView tree={tree} macro_data_driver={driver} />
```

> **No network required — load the bundled JSON and query through the driver.**

## Bundling (Vite / webpack)

`@snl-basics/react` lists `react` and `react-dom` as **peerDependencies** (never
`dependencies`), so it never carries its own nested React. If your bundler still
duplicates React (you'll see **"Invalid hook call"** at runtime), dedupe it:

```js
// vite.config.ts
export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom', 'react/jsx-runtime'] },
})
```

This is standard for any library exporting React components — not SNL-specific —
but the workaround is easy to miss.

## Macro naming conventions

Macro names must match `[A-Za-z0-9_.]+` — no hyphens, no other punctuation.
Dashes break KaTeX's `\htmlData` tokenizer (it treats `-` as binary minus and
mangles the attribute value). A dotted suffix is part of a macro's identity when
it's a genuinely different macro (e.g. different arity): `FOL.forall` vs.
`FOL.forall.typed` (2 vs. 3 children). Render *variations that keep the same
arity* are **styles**, not separate macros — see below.

## Styles & the `[style]` bracket

A macro declares one or more render **styles** keyed by `style_name`, with
`styles[0]` as the implicit default. All styles of a macro **must accept the
same arity** — a style only varies the render output, never the child count.
This is the invariant that makes switching styles always safe:

```
node := IDENT ('[' IDENT ']')? ('(' args ')')?
```

The optional `[style]` bracket picks a style; without it the macro's
`styles[0]` (default) is used.

```ts
parseSnlSyntaxTree('FOL.implies(a, b)')          // default style → a \rightarrow b
parseSnlSyntaxTree('FOL.implies[double](a, b)')  // 'double' style → a \Rightarrow b
```

The picked tag is exposed on the node as `node.style_name` and (when explicit)
is emitted as `data-style="<tag>"` on the rendered element. An unknown tag is a
render error.

## Concepts

- **Macro** — a named renderer. Top-level fields are `name`, `description`,
  `source`, optional `kind`, `dynamic_arity`, and a `styles` array (ordered,
  `styles[0]` is the default). Consumer-owned output strategies (`typst` /
  `latex` / `markdown` / `text`) live downstream. Fields and semantics live in
  [`src/snl-macro/types.ts`](src/snl-macro/types.ts):

  ```ts
  const macro: SnlMacro = {
    name: 'FOL.implies',
    description: '…',
    source: { entries: [], urls: [] },
    dynamic_arity: false,
    tags: [],
    styles: [
      { style_name: 'infix', mode: 'formula_inline', template: '#0 \\rightarrow #1', tags: [] },
      { style_name: 'double', mode: 'formula_inline', template: '#0 \\Rightarrow #1', tags: [] },
    ],
  }
  ```

- **Kind** — optional semantic tag surfaced as `data-kind` (drives the hover
  palette: `rule` / `const` / `bvar` / `binder` / `fvar`). If a macro sets no
  `kind` and annotation assigns none, the node defaults to **`fvar`** (there is
  no more neutral-grey `default` kind).
- **Syntax tree** — the parsed representation
  (`{ macro_name, style_name?, kind, mdata, children }`). At render time each
  node is dispatched by its style's `mode`: `formula_inline`/`formula_display`
  (KaTeX), `text` (`<span>`), or `block` (a registered block renderer via
  `block_template_name`).
- **MacroDataDriver** — the single query-only data-access layer between the View
  and macro data. Provides `query_macro({macro_name})` with bounded LRU cache
  and in-flight dedup. Created with `new MacroDataDriver({ queries })` where
  queries implements `MacroDataQueries`; storage and transport adaptation stays
  in the consumer.
- **ReaderRuntime / ReaderM** — the standard for locale, theme, motion,
  preferences, and every other consumer-owned runtime dependency. Pure
  calculations are Readers; a query-initialized `ReaderRuntime` supplies the
  fresh environment without Basics assuming VS Code, browser globals, files,
  or any other backend. See [Query-injected runtime standard](docs/query-injected-runtime.md).
- **Hooks** — every interaction is customizable via `SnlRenderHooks`: supply your
  own `renderTooltip`, `onHover` / `onLeave`, `resolveMacroInfo`, `resolveSource`,
  `highlightStrategy`, or `renderers`. Anything you omit falls back to
  `defaultRenderHooks`.
- **Arity & placeholders** — fixed-arity macros use `#0`, `#1`, …; variadic
  macros use `#*` joined by `separator` (e.g. `pmatrix` / `matrix.row`).
  See [Template DSL](#template-dsl).

### Template DSL

Templates use LaTeX-native macro-argument syntax:

- `#0` / `#1` / … — 0-indexed children (fixed-arity macros)
- `#*` — all children joined (dynamic_arity macros, `separator` string)
- `\#` — literal `#` (renders as `#` in KaTeX)

`\htmlData` is added automatically by the view layer — do not write it
yourself in templates. Every node is wrapped in
`\htmlData{name=<macro>,kind=<node.kind>[,style=<tag>][,tree-path=<path>]}{...}`
so hover interactions work with zero boilerplate.

## Customization examples

### Custom tooltip

```tsx
<SnlSyntaxTreeView
  tree={tree}
  macro_data_driver={driver}
  hooks={{
    renderTooltip: (state) =>
      state.visible ? (
        <div className="my-tooltip" style={{ position: 'fixed', left: state.x, top: state.y }}>
          <strong>{state.name}</strong>
          <div>{state.info?.description ?? '…'}</div>
        </div>
      ) : null,
  }}
/>
```

### Disable tooltips entirely

`renderTooltip` returning `null` suppresses the tooltip while keeping hover
highlighting:

```tsx
import { defaultRenderHooks, type SnlRenderHooks } from '@snl-basics/react'

const hooks: SnlRenderHooks = { ...defaultRenderHooks, renderTooltip: () => null }
```

### Custom source resolver (entry id → local pool, URL fallback)

`resolveSource` is **sync** — do a local lookup (an entry pool, a map) and
return a `SnlResolvedSource` or `null`. The `source` arg is the exported
`SnlMacroSource` (`{ entries: string[]; urls: string[] }`):

```tsx
import { defaultRenderHooks, type SnlRenderHooks } from '@snl-basics/react'

const entryPool: Record<string, { title: string; url?: string }> = {
  'add-def': { title: 'Addition', url: 'https://example/add' },
}

const hooks: SnlRenderHooks = {
  ...defaultRenderHooks,
  resolveSource: (source) => {
    for (const id of source.entries) {
      const hit = entryPool[id]
      if (hit) return { kind: 'entry', ref: id, displayName: hit.title, href: hit.url }
    }
    if (source.urls[0]) return { kind: 'url', ref: source.urls[0], href: source.urls[0] }
    return null
  },
}
```

### Forward hover to a host (e.g. VS Code webview message)

`onHover` is **fire-and-forget** (not awaited) — ideal for host-side logging or
messaging:

```tsx
import { defaultRenderHooks, type SnlRenderHooks } from '@snl-basics/react'

const hooks: SnlRenderHooks = {
  ...defaultRenderHooks,
  onHover: (event) => {
    vscodeApi.postMessage({ type: 'hover', name: event.name, kind: event.kind })
  },
}
```

### Custom block renderer

Register a renderer keyed by the resolved style's `block_template_name`. Spread
`defaultRenderers` to keep the built-in `list` / `table` / `centered` renderers:

```tsx
import { defaultRenderers, type SnlBlockRenderer } from '@snl-basics/react'

// Macro DB entry (v7 shape):
// { name: 'MyCallout', dynamic_arity: true,
//   styles: [{ style_name: 'default', mode: 'block', template: '',
//              block_template_name: 'callout', tags: [] }], tags: [] }
const Callout: SnlBlockRenderer = ({ node, renderChild }) => (
  <aside className="callout">
    {node.children.map((child, i) => (
      <span key={i}>{renderChild(child)}</span>
    ))}
  </aside>
)

<SnlSyntaxTreeView
  tree={tree}
  macro_data_driver={driver}
  hooks={{ renderers: { ...defaultRenderers, callout: Callout } }}
/>
```

## Output backends

Output backends (Typst / LaTeX / Markdown / plain text) are **consumer-side
concerns** and are no longer part of this library (removed in 0.4.0). A `SnlMacro`
now carries only render fields (`name`, `description`, `source`,
`dynamic_arity`, `tags`, `styles`). Downstream extensions that need to emit those formats
own their own extended macro shape (with per-style backends) and conversion code
(see SNL-Doc-Extension).

## API reference

The full public surface is the grouped barrel in
[`src/snl-react-view/index.ts`](src/snl-react-view/index.ts). Complete
TypeScript declarations for every export — props, hooks, types, and the
`MacroDataDriver` class — are published at
[`dist-lib/index.d.ts`](dist-lib/index.d.ts) and are what your editor resolves
on `import type { … } from '@snl-basics/react'`.

## Development

```bash
npm install
npm run build:lib   # emits dist-lib/ (JS + types + style.css + core macro DB)
npm test            # vitest
npm run dev         # interactive demo (src/App.tsx)
```

## License

SNL-Basics is released under the [MIT License](LICENSE).
