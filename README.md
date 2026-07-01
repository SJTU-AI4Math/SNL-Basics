# SNL-Basics

Structured Natural Language (SNL) base library — parse a macro DSL into syntax
trees and render them to KaTeX-in-React with hover interactions, plus
Typst / LaTeX / Markdown / plain-text output backends.

Design goals: **simple, clear interfaces · highly modular · deeply customizable.**
Every interaction (tooltip, hover highlight, source resolution, block rendering)
is overridable through a single `hooks` prop.

## Install

```bash
npm i @snl-basics/react katex react
```

Import the stylesheets once (KaTeX + the SNL hover/block styles):

```ts
import 'katex/dist/katex.min.css'
import '@snl-basics/react/style.css'
```

## 5-minute quickstart

The macro DB ships with the package as JSON, so no network fetch is needed —
import it directly, build a query from it, parse an expression, and render:

```tsx
import 'katex/dist/katex.min.css'
import '@snl-basics/react/style.css'

import { useMemo } from 'react'
import {
  SnlSyntaxTreeView,
  parseSnlSyntaxTree,
  annotateBindings,
  createMacroTemplateQueryFromDb,
  type SnlMacroDb,
  type SnlSyntaxTree,
} from '@snl-basics/react'
import macroDb from '@snl-basics/react/snl-macro-db.json'

const db = macroDb as unknown as SnlMacroDb

export function Demo() {
  // 1. A query resolves a macro name to its KaTeX template (from the DB).
  const query = useMemo(() => createMacroTemplateQueryFromDb(db), [])

  // 2. Parse SNL source, then annotate binders/bound-variables for hover.
  const tree: SnlSyntaxTree = useMemo(() => {
    const t = parseSnlSyntaxTree('FOL.forall.binder(x, FOL.eq.infix(x, x))')
    annotateBindings(t)
    return t
  }, [])

  // 3. Render. `trust: true` lets KaTeX emit the \htmlData hover hooks.
  return (
    <SnlSyntaxTreeView
      tree={tree}
      query={query}
      templateDb={db}
      katexOptions={{ displayMode: true, trust: true }}
    />
  )
}
```

Prefer to load the DB over HTTP (e.g. served from your `public/` dir)? Use
`loadSnlMacroDb(url)` instead of the direct import:

```tsx
import { loadSnlMacroDb, createDefaultMacroTemplateQuery } from '@snl-basics/react'

const db = await loadSnlMacroDb('/snl-macro-db.json')
const query = createDefaultMacroTemplateQuery({ templateDbUrl: '/snl-macro-db.json' })
```

## Concepts

- **Macro** — a named renderer with five output strategies (`typst`, `latex`,
  `markdown`, `text`, `katex_react`). Fields and semantics live in
  [`src/snl-macro/types.ts`](src/snl-macro/types.ts).
- **Syntax tree** — the parsed representation (`{ name, kind, mdata, children }`).
  At render time each node is dispatched by its macro's `katex_react.mode`:
  `math` (KaTeX), `text` (`<span>`), or `block` (a registered block renderer).
- **Hooks** — every interaction is customizable via `SnlRenderHooks`: supply your
  own `renderTooltip`, `onHover` / `onLeave`, `resolveMacroInfo`, `resolveSource`,
  `highlightStrategy`, or `renderers`. Anything you omit falls back to
  `defaultRenderHooks`.
- **Arity & placeholders** — fixed-arity macros use `@CHILD0@`, `@CHILD1@`, …;
  variadic macros use `@CHILDREN@` joined by `variadic_join` (e.g. `pmatrix` /
  `matrix.row`).

## Customization examples

### Custom tooltip

```tsx
<SnlSyntaxTreeView
  tree={tree}
  query={query}
  templateDb={db}
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

### Custom source resolver (entry id → URL)

```tsx
import type { SnlResolvedSource } from '@snl-basics/react'

const resolveSource = (source: { entries: string[]; urls: string[] }): SnlResolvedSource | null => {
  if (source.entries[0]) {
    return { kind: 'entry', ref: source.entries[0], href: `https://my-wiki/entry/${source.entries[0]}` }
  }
  if (source.urls[0]) {
    return { kind: 'url', ref: source.urls[0], href: source.urls[0] }
  }
  return null
}

<SnlSyntaxTreeView tree={tree} query={query} templateDb={db} hooks={{ resolveSource }} />
```

### Custom block renderer

Register a renderer keyed by the macro's `katex_react.react_renderer_key`. Spread
`defaultRenderers` to keep the built-in `list` / `table` / `centered` renderers:

```tsx
import { defaultRenderers, type SnlBlockRenderer } from '@snl-basics/react'

// Macro DB entry: { katex_react: { arity: 'variadic', mode: 'block', react_renderer_key: 'callout', template: '' } }
const Callout: SnlBlockRenderer = ({ node, renderChild }) => (
  <aside className="callout">
    {node.children.map((child, i) => (
      <span key={i}>{renderChild(child)}</span>
    ))}
  </aside>
)

<SnlSyntaxTreeView
  tree={tree}
  query={query}
  templateDb={db}
  hooks={{ renderers: { ...defaultRenderers, callout: Callout } }}
/>
```

The library also ships sample block macros in
`@snl-basics/react/snl-macro-db-samples.json` (`sample.list`, `sample.table`,
`sample.centered`) that you can merge into your DB to try the built-in renderers.

## Output backends

```ts
import { toLatex, buildLatexPreamble, toTypst, toMarkdown, toText } from '@snl-basics/react'
```

`toLatex` / `toTypst` / `toMarkdown` / `toText` convert a tree to the respective
format (Typst/LaTeX also expose `build*Preamble` for collected `built_in`
declarations). These are currently stubs pending Phase 2.5+.

## API

The full public surface is the grouped barrel in
[`src/snl-react-view/index.ts`](src/snl-react-view/index.ts); TypeScript
declarations are published at `dist-lib/index.d.ts`.

## Development

```bash
npm install
npm run build:lib   # emits dist-lib/ (JS + types + style.css + macro DBs)
npm test            # vitest
npm run dev         # interactive demo (src/App.tsx)
```
