# SNL-Basics

**v0.2.3 · MIT License · Beta** — [中文版 README](README(ZH).md)

Structured Natural Language (SNL) base library — parse a macro DSL into syntax
trees and render them to KaTeX-in-React with hover interactions.

Output backends (Typst / LaTeX / Markdown / plain text) are **consumer-side
concerns** and live in downstream extensions (e.g. SNL-Doc-Extension), not in
this render-only library.

Design goals: **simple, clear interfaces · highly modular · deeply customizable.**
Every interaction (tooltip, hover highlight, source resolution, block rendering)
is overridable through a single `hooks` prop.

---

## ⚠️ Read this before you depend on SNL-Basics

### Beta status — the schema is not stable until `1.0.0`

Every `0.x` release is a **beta** release and may contain breaking changes to
the API *and* to the serialized data schema (syntax-tree documents and macro
databases).

We commit to the following **maintenance measures** for every breaking change:

- **Deprecation notices** — removed API surface is announced with the release
  that removes it, and where practical shipped for one minor release with a
  deprecation marker naming its removal version.
- **Data migration functions** — every serialized-schema break ships with a
  runnable migration (`scripts/migrate-*.mjs`, plus the programmatic
  `migrateMacroDocument` / `migrateSyntaxTreeDocument`) and a row in
  [MIGRATION.md](MIGRATION.md).

We explicitly **do not** promise schema stability before `1.0.0`. Migration
functions are our commitment to make breaks *survivable*, not a promise that
breaks will not happen. The first release that freezes the schema is `1.0.0`.

### This library was built by AI agents, and the API has not been human-curated

SNL-Basics was produced by **vibe coding with Claude Opus + a ChatGPT-based
Hermes Agent**. The public interface has **not yet been through a human design
review**. Concretely, this means:

- Naming, argument shapes, and module boundaries are **not guaranteed to be
  efficient or well-designed**. Some of them are historical accidents.
- We expect to **substantially rework the interface** on the road to `1.0.0`.

**Therefore: if you write code by hand ("artisanal" programming), we do not
recommend depending on this library yet.** A future interface cleanup is likely
to invalidate a large amount of carefully hand-written integration work. If you
do use it now, we recommend you keep your integration thin, generated, or
otherwise cheap to regenerate — and pin an exact version.

The library is nonetheless covered by a **full automated test suite** and used in production
by SNL-Doc-Extension. The caveat is about interface *stability and taste*, not
correctness.

---

## Runnable example

[`examples/basic-demo`](examples/basic-demo) is a self-contained Vite + React
local-integration app. It links the repository root through `file:../..`,
imports only public package entry points, and renders through the complete Entry
route (`EntryPreviewProvider` + `EntrySurface`). Its lifecycle hooks automatically
install missing root build dependencies and rebuild `dist-lib`, so a fresh clone
does not need a pre-generated tarball.

```bash
cd examples/basic-demo
npm install                        # bootstraps and builds the local root package
npm run dev                        # or: npm run build
```

It demonstrates live SNL editing, Entry rendering, source-backed recursive Entry
previews, click-to-pin and blank-click dismissal. The serialized syntax tree and
outline remain parser diagnostics only.

Packed-artifact compatibility is verified separately by the release tarball
clean-consumer gates; this source-linked demo is the reference local integration,
not evidence about bytes published to npm.

## Feature overview

| Area | What you get | Entry point |
|---|---|---|
| **Parsing** | SNL source → syntax tree, with a non-throwing variant and a typed error | `parseSnlSyntaxTree`, `tryParseSnlSyntaxTree`, `SnlSyntaxTreeParseError` |
| **Serializing** | Tree → Parser-readable source (round-trips, including `[style]`) | `serializeSnlSyntaxTree`, `SnlDslFormatter` |
| **Binding analysis** | Infer binder / bound-variable / free-variable kinds for hover | `annotateBindings` |
| **Rendering** | Tree → KaTeX-in-React with automatic `\htmlData` hover metadata | `SnlSyntaxTreeView` |
| **Macro data** | Query-only data layer with LRU cache + in-flight dedup | `MacroDataDriver`, `MacroDataQueries` |
| **Interaction** | Injectable hover / leave / click / ctrl-click driver, tree paths | `SnlInteractionDriver`, `encodeTreePath`, `resolveTreePath` |
| **Customization** | Override tooltip, hover, source resolution, highlighting, block renderers | `SnlRenderHooks`, `defaultRenderHooks`, `defaultRenderers` |
| **Theming** | Kind → colour palette, CSS generation | `DEFAULT_KIND_PALETTE`, `paletteToCss` |
| **Runtime injection** | Locale / theme / preferences via a Reader monad, no host assumptions | `ReaderRuntime`, `ReaderM` |
| **Popovers** | Recursive hover-popover stack with viewport clamping | `HoverPopoverProvider`, `useHoverPopovers` |
| **Entry cards** (subpath) | Complete Entry renderer — SNL / Markdown / LaTeX / text bodies | `@sjtu-ai4math/snl-basics/entry` |
| **Schema migration** | Programmatic + CLI migration between schema versions | `migrateMacroDocument`, `scripts/migrate-schema.mjs` |

Everything above is exported from the package root except the Entry renderer,
which lives behind the tree-shakeable `/entry` subpath so the root never pulls
in the Markdown dependency chain.

## Install

```bash
npm i @sjtu-ai4math/snl-basics katex react react-dom
```

`react`, `react-dom`, and `katex` are **peerDependencies** — the library never
bundles its own copy (see [Bundling](#bundling-vite--webpack)).

Import the stylesheets once (KaTeX + the SNL hover/block styles):

```ts
import 'katex/dist/katex.min.css'
import '@sjtu-ai4math/snl-basics/style.css'
```

## 5-minute quickstart

Create a query-only `MacroDataDriver`, parse an expression, and render:

```tsx
import 'katex/dist/katex.min.css'
import '@sjtu-ai4math/snl-basics/style.css'

import { useMemo } from 'react'
import {
  SnlSyntaxTreeView,
  MacroDataDriver,
  parseSnlSyntaxTree,
  annotateBindings,
  type SnlSyntaxTree,
} from '@sjtu-ai4math/snl-basics'

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
    const t = parseSnlSyntaxTree('quantifier(@x, equals(x, x))')
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
import { MacroDataDriver } from '@sjtu-ai4math/snl-basics'

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
`@sjtu-ai4math/snl-basics/entry` subpath. The package root does not import its Markdown
dependencies.

```tsx
import { EntryDataDriver, EntryPreviewProvider, EntryView } from '@sjtu-ai4math/snl-basics/entry'
import '@sjtu-ai4math/snl-basics/entry/style.css'

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

`EntryKind.name` and optional `EntryKind.description` accept either a legacy
string or the shared `Localized<string, string>` I18n envelope. The driver keeps
the raw map; `EntrySurface` resolves the displayed Kind name through its supplied
`ReaderRuntime`, so a parent rerender observes the current content language.

### KaTeX options — command-scoped trust policy

`SnlSyntaxTreeView` uses a KaTeX trust callback that permits only `\htmlData`
(hover metadata) and `\htmlClass` (placeholder styling). URL, image, element-ID,
and inline-style commands remain rejected, including `\href`, `\url`,
`\includegraphics`, `\htmlId`, and `\htmlStyle`.

Passing `trust: false` disables the required HTML extensions and silently breaks
hover. Passing `trust: true` replaces the command-scoped policy and enables all
KaTeX trust-gated commands, so do that only for fully trusted input.

If you call `katex.renderToString` directly for a custom block renderer, import
and spread the same preset so your output keeps the hover hooks:

```tsx
import katex from 'katex'
import { HTMLDATA_KATEX_DEFAULTS } from '@sjtu-ai4math/snl-basics'

katex.renderToString(latex, { throwOnError: false, ...HTMLDATA_KATEX_DEFAULTS })
```

## Consumer-owned Macro data

SNL-Basics does not ship a Macro database. Applications own their Macro records
and expose them through `MacroDataDriver`, whether the backing store is an
in-memory object, a workspace file, or a remote service:

```tsx
import { MacroDataDriver, parseSnlSyntaxTree } from '@sjtu-ai4math/snl-basics'

const macros = {} // consumer-owned Record<string, SnlMacro>
const driver = new MacroDataDriver({
  queries: {
    async query_macro({ macro_name }) {
      return macros[macro_name] ?? null
    },
  },
})
const tree = parseSnlSyntaxTree('群.示例(@x, x)')
// <SnlSyntaxTreeView tree={tree} macro_data_driver={driver} />
```

## Bundling (Vite / webpack)

`@sjtu-ai4math/snl-basics` lists `react` and `react-dom` as **peerDependencies** (never
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

Plain Macro/style identifiers accept the legacy ASCII allow-list (`A-Z`, `a-z`,
`0-9`, `_`, leading `\\`, and subsequent `.`/`-`) plus visible non-ASCII
Unicode, for example `群.是群`, `Ελληνικά.Ομάδα`, and `Théorie.groupe`.
Other ASCII punctuation remains forbidden because it carries SNL syntax.
Unicode whitespace, controls, format controls (including zero-width/bidi
controls), and lone UTF-16 surrogates are also rejected. A dotted suffix is part
of a macro's identity when
it's a genuinely different macro (e.g. different arity): `quantifier` vs.
`quantifier.typed` (2 vs. 3 children). Render *variations that keep the same
arity* are **styles**, not separate macros — see below.

## Styles & the `[style]` bracket

A macro declares one or more render **styles** keyed by `style_name`.
`styles[0]` is the single implicit default. Every language projection within
one localized Style must have the same escape-aware placeholder contract.
Separate explicit Styles may intentionally omit or reveal children; selecting
one never changes the parsed syntax tree:

```
node := IDENT ('[' IDENT ']')? ('(' args ')')?
```

The optional `[style]` bracket picks a style and always wins. Without it,
`styles[0]` is selected. Language changes resolve one complete localized
TemplateSpec inside the selected Style; they never switch Styles.

```ts
parseSnlSyntaxTree('Pow.pow(x, 2)')               // styles[0]
parseSnlSyntaxTree('operator[double](a, b)')     // 'double' style → a \Rightarrow b
```

The picked tag is exposed on the node as `node.style_name` and (when explicit)
is emitted as `data-style="<tag>"` on the rendered element. An unknown tag is a
render error.

`serializeSnlSyntaxTree` preserves an explicit style bracket, so parse →
serialize round-trips.

## Concepts

- **Macro** — a named renderer. Top-level fields are `name`, `description`,
  `source`, optional `kind`, `dynamic_arity`, and an ordered `styles` array
  (`styles[0]` is the implicit default).
  Consumer-owned output strategies (`typst` /
  `latex` / `markdown` / `text`) live downstream. Fields and semantics live in
  [`src/snl-macro/types.ts`](src/snl-macro/types.ts):

  ```ts
  const macro: SnlMacro = {
    name: 'operator',
    description: '…',
    source: { entries: [], urls: [] },
    dynamic_arity: false,
    tags: [],
    styles: [
      {
        style_name: 'prose',
        template: {
          type: 'i18n',
          default_language: 'en',
          values: {
            en: { mode: 'text', body: '#0 implies #1' },
            'zh-CN': { mode: 'text', body: '#0 蕴含 #1' },
          },
        },
        tags: [],
      },
      {
        style_name: 'double',
        template: { mode: 'formula_inline', body: '#0 \\Rightarrow #1' },
        tags: [],
      },
    ],
  }
  ```

  Every Style owns one complete template or an `I18n` of complete templates.
  Locale selection atomically chooses `mode`, `body`, `separator`, block
  renderer, and consumer output backends without changing `style_name` or tags.

- **Kind** — one semantic tag. Basics has built-in behavior only for `sub`,
  `binder`, `bvar`, and `fvar`; every other Entry kind uses const behavior while
  retaining its original tag for appearance. Persisted Macro definitions keep
  their consumer-defined kind strings; `partial` migrates to `sub`, and only a
  missing kind materializes as `const`. Every other Macro kind uses const
  behavior without losing its palette/metadata identity. Temporary roots default
  to metadata-transparent `sub`;
  unresolved names become `fvar` after Macro-aware semantic resolution.
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
  own `renderTooltip`, `onHover` / `onHover1s` / `onHover2s` / `onLeave`, `resolveMacroInfo`, `resolveSource`,
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

The default interaction timeline is:

- hover immediately: highlight only;
- hover the same node for 1 second: show the tooltip;
- hover it for 2 seconds: lock the tooltip (`state.locked === true`);
- click: show and lock the tooltip immediately.

`onHover`, `onHover1s`, and `onHover2s` are independent, optional hooks. Leaving
before a threshold cancels its pending hook. A locked tooltip survives pointer
leave and ignores later hover movement until another node is clicked.
All three phases receive the same `event.session`, whose stable `id` identifies
the lifecycle and whose `data` Map is an explicit communication channel:

```ts
const hooks: SnlRenderHooks = {
  onHover1s: (event) => event.session.data.set('popover', openPopover(event)),
  onHover2s: (event) => {
    const popover = event.session.data.get('popover') as Popover | undefined
    popover?.lock()
  },
}
```

A node or tree change creates a new session and cancels stale phases. Consumer
hook failures are isolated from the default show/lock state machine.

### Controlled deactivation and layered popover dismissal

Activation clearing is separate from popover graph mutation. A real interaction
context carries an optional generation-safe `activation` lease; stale leases
cannot clear a newer node. Consumers can veto or replace local clearing with a
`SnlDeactivationController`, and can independently control recursive popover
requests with `HoverPopoverDismissController`:

```tsx
const deactivation = new SnlDeactivationController({
  params: { surface: 'proof' },
  handlers: {
    'pointer-leave': ({ runDefault }) => runDefault(),
  },
})

const dismissal = new HoverPopoverDismissController<{ surface: string }, string>({
  params: { surface: 'proof' },
  on_request: ({ request, runDefault }) => {
    if (request.reason !== 'escape') runDefault()
  },
})

<EntryPreviewProvider
  entry_data_driver={entries}
  macro_data_driver={macros}
  deactivation_controller={deactivation}
  dismiss_controller={dismissal}
>
  {content}
</EntryPreviewProvider>
```

Dismiss scopes are `descendants`, `subtree`, `unfrozen-subtree`, and `all`.
Each request contains one immutable leaf-to-root target snapshot. `runDefault()`
is a synchronous, once-only capability and expires when the handler returns;
promise/thenable failures are absorbed but cannot defer that capability.
`owner-unmount` is observable but non-cancelable. Provider teardown bypasses
request/deactivation policy, force-removes every layer, and still emits each
`on_removed` completion exactly once. Vetoing `sibling-replaced` controls only
the old sibling's dismissal: the newly requested pin is still created, so both
siblings coexist by explicit consumer policy.

Native controls inside rendered Blocks (`button`, links, form controls, semantic
ARIA controls, or `[data-snl-interaction-boundary]`) own pointer, hover, and
Enter/Space interaction before delegated SNL activation. This boundary is
structural and does not depend on a child renderer calling `stopPropagation()`.

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
import { defaultRenderHooks, type SnlRenderHooks } from '@sjtu-ai4math/snl-basics'

const hooks: SnlRenderHooks = { ...defaultRenderHooks, renderTooltip: () => null }
```

### Custom source resolver (entry id → local pool, URL fallback)

`resolveSource` is **sync** — do a local lookup (an entry pool, a map) and
return a `SnlResolvedSource` or `null`. The `source` arg is the exported
`SnlMacroSource` (`{ entries: string[]; urls: string[] }`):

```tsx
import { defaultRenderHooks, type SnlRenderHooks } from '@sjtu-ai4math/snl-basics'

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
import { defaultRenderHooks, type SnlRenderHooks } from '@sjtu-ai4math/snl-basics'

const hooks: SnlRenderHooks = {
  ...defaultRenderHooks,
  onHover: (event) => {
    vscodeApi.postMessage({ type: 'hover', name: event.name, kind: event.kind })
  },
  onHover1s: (event) => {
    vscodeApi.postMessage({ type: 'hover-1s', name: event.name })
  },
  onHover2s: (event) => {
    vscodeApi.postMessage({ type: 'hover-2s', name: event.name })
  },
}
```

### Custom block renderer

Register a renderer keyed by the resolved style's `block_template_name`. Spread
`defaultRenderers` to keep the built-in `list` / `enumerate` / `table` / `centered` renderers:

```tsx
import { defaultRenderers, type SnlBlockRenderer } from '@sjtu-ai4math/snl-basics'

// Macro DB entry (v11 shape):
// { name: 'MyCallout', dynamic_arity: true,
//   styles: [{ style_name: 'default', tags: [],
//     template: { mode: 'block', body: '#*',
//                 block_template_name: 'callout' } }], tags: [] }
const Callout: SnlBlockRenderer = ({ node, renderChild }) => (
  <aside className="callout">
    {node.children.map((child, i) => (
      <span key={i}>{renderChild(child, i)}</span>
    ))}
  </aside>
)

<SnlSyntaxTreeView
  tree={tree}
  macro_data_driver={driver}
  hooks={{ renderers: { ...defaultRenderers, callout: Callout } }}
/>
```

### Opt-in parameterized SVG block renderer

`createSvgTemplateRenderer` projects an existing block Macro through sanitized SVG
artwork while every label still goes through the view's `renderChild` path. It is
not registered by default. The consumer supplies a `SvgTemplateAssetRegistry`
and registers the returned renderer under its own `block_template_name`:

```tsx
import {
  createSvgTemplateRenderer,
  defaultRenderers,
  SvgTemplateAssetRegistry,
} from '@sjtu-ai4math/snl-basics'

const assets = new SvgTemplateAssetRegistry({
  loader: async (identity, signal) => loadTrustedSvgSource(identity, signal),
})
const Diagram = createSvgTemplateRenderer({ assetRegistry: assets })

<SnlSyntaxTreeView
  tree={tree}
  macro_data_driver={driver}
  hooks={{ renderers: { ...defaultRenderers, 'consumer-svg': Diagram } }}
/>
```

The selected, complete `TemplateSpec` remains consumer-owned and must have
`mode: "block"`, the consumer's `block_template_name`, and this opaque extension:

```json
{
  "mode": "block",
  "body": "#0#1#2#3",
  "block_template_name": "consumer-svg",
  "svg_template": {
    "asset": {
      "source": "assets/square.svg",
      "base_identity": "consumer-package-or-workspace",
      "revision": "sha256-or-consumer-revision",
      "request_epoch": 12
    },
    "generation": 3,
    "producer_revision": "diagram-projector-v2",
    "accessibility": { "label": "Commutative square" }
  }
}
```

All identity fields are required: `asset.source`, `asset.base_identity`,
`asset.revision`, and `producer_revision` are non-empty strings;
`asset.request_epoch` and `generation` are non-negative safe integers; and
`accessibility.label` is a non-empty trusted label. The registry resolves the
asset identity to immutable raw SVG source, and each consumer instance parses,
sanitizes, scopes IDs, and instantiates its own SVG DOM. A request epoch change
retires stale async work; asset and producer revisions participate in live
foreign-box identity.

Only fixed arity is supported. `dynamic_arity` must be `false`; the existing
`body` placeholders continue to declare the Macro's ordinary arity, while the
sanitized SVG must independently contain exactly the contiguous empty
`<g data-snl-slot="0">` through `<g data-snl-slot="N-1">` anchors. Each child is
selected by the validated slot index and rendered through `renderChild`.
Missing/excess children, malformed or active SVG, and any block-mode child fail
closed with a visible fallback. Text and formula children are supported as SVG
labels, but embedding the complete SVG renderer inside a formula is **not yet
supported**.

`data-snl-slot` and `svg_template` are renderer/projection metadata, not new SNL
author syntax. Macro calls remain ordinary SNL calls, and Basics introduces no
new persisted call representation or migration for this feature. Consumers may
store the opaque projection fields in their existing Macro database, but must
not derive identity from Macro names or treat `#N` text inside SVG as slots.

## Output backends

Output backends (Typst / LaTeX / Markdown / plain text) are **consumer-side
concerns**. Basics does not interpret them; downstream extensions may attach
opaque backend data to each complete `style.template` projection so language
selection remains atomic with mode, body, separator, and block renderer.

## API reference

The full public surface is the grouped barrel in
[`src/snl-react-view/index.ts`](src/snl-react-view/index.ts). Complete
TypeScript declarations for every export — props, hooks, types, and the
`MacroDataDriver` class — are published at
[`dist-lib/index.d.ts`](dist-lib/index.d.ts) and are what your editor resolves
on `import type { … } from '@sjtu-ai4math/snl-basics'`.

## Development

```bash
npm install
npm run build:lib   # emits dist-lib/ (JS + types + style.css + core macro DB)
npm test            # full Vitest suite
npm run dev         # interactive demo (src/App.tsx)
npm pack            # produce the publishable tarball
```

## Version & License

- **Version:** `0.2.3` (beta — see [the beta notice](#beta-status--the-schema-is-not-stable-until-100))
- **License:** [MIT](LICENSE)
