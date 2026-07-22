# `@snl-basics/react` — Public API Reference

Current stable surface for v0.10.0. Import from the package root:

```ts
import { MacroDataDriver, SnlSyntaxTreeView } from '@snl-basics/react'
```

## Data model

```ts
interface SnlSyntaxTree {
  macro_name: string
  kind?: string
  env_mode?: 'formula_inline' | 'formula_display' | 'text' | 'block'
  style_name?: string
  children: SnlSyntaxTree[]
  mdata?: Record<string, unknown>
  scope?: string
}

interface SnlMacroSource {
  entries: string[]
  urls: string[]
}

interface SnlMacroStyle {
  style_name: string
  mode: 'formula_inline' | 'formula_display' | 'text' | 'block'
  template: string
  separator?: string
  block_template_name?: string
  tags: string[]
}

interface SnlMacro {
  name: string
  description: string
  source: SnlMacroSource
  kind?: string
  dynamic_arity: boolean
  styles: SnlMacroStyle[]
  tags: string[]
}
```

Dynamic styles place `#*` in `template`; `separator` joins its expanded children.
`block_template_name` is valid only when `mode === 'block'`. All styles of one
macro must have the same arity contract.

## Parser and serialization

```ts
function parseSnlSyntaxTree(source: string): SnlSyntaxTree
function tryParseSnlSyntaxTree(source: string):
  | { ok: true; tree: SnlSyntaxTree }
  | { ok: false; error: string; position: number }
function serializeSnlSyntaxTree(tree: SnlSyntaxTree): string
function createSnlSyntaxTreeNode(
  macro_name: string,
  options?: Partial<Omit<SnlSyntaxTree, 'macro_name'>>,
): SnlSyntaxTree
```

`parseSnlSyntaxTree` throws `SnlSyntaxTreeParseError`; editors should normally
use the non-throwing `tryParseSnlSyntaxTree` form.

## Query-only `MacroDataDriver`

```ts
interface MacroQueryArgs {
  macro_name: string
  signal?: AbortSignal
}

interface MacroDataQueries {
  query_macro(args: MacroQueryArgs): Promise<SnlMacro | null>
}

interface MacroDataDriverOptions {
  queries: MacroDataQueries
  cache_capacity?: number
}

class MacroDataDriver {
  constructor(options: MacroDataDriverOptions)
  query_macro(args: MacroQueryArgs): Promise<SnlMacro | null>
  clear_cache(name?: string): void
  readonly cache_size: number
}
```

The injected `MacroDataQueries` implementation is the only macro data source.
The driver performs bounded per-name hit/miss caching and in-flight request
deduplication. Consumers own storage and implement `query_macro` for their
chosen transport.

```ts
const driver = new MacroDataDriver({
  queries: {
    async query_macro({ macro_name, signal }) {
      const response = await fetch(`/api/macros/${encodeURIComponent(macro_name)}`, { signal })
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`macro query failed: ${response.status}`)
      return response.json() as Promise<SnlMacro>
    },
  },
  cache_capacity: 256,
})
```

## Rendering

```ts
interface SnlSyntaxTreeViewProps {
  tree: SnlSyntaxTree
  macro_data_driver: MacroDataDriver
  interaction_driver?: SnlInteractionDriver
  katexOptions?: KatexOptions
  kindPalette?: KindPalette
  onResolved?: (latex: string) => void
  hooks?: SnlRenderHooks
}

function SnlSyntaxTreeView(props: SnlSyntaxTreeViewProps): ReactElement
```

All mode, style, template, kind, description, and source information used by a
render comes from `macro_data_driver`. Formula modes use KaTeX, text mode uses
native React text with optional math islands, and block mode dispatches through
`block_template_name`.

`SnlInteractionDriver` provides delegated hover, leave, click, and literal
Ctrl-click callbacks. Each callback receives the original syntax-tree node and
its stable tree path.

## Customization

The root also exports `defaultRenderHooks`, `defaultHighlightStrategy`,
`defaultRenderers`, `DEFAULT_KIND_PALETTE`, palette helpers, hover-popover
helpers, and advanced pure rendering helpers. See the generated declaration
file for their exact signatures.

Import the required styles once:

```ts
import '@snl-basics/react/style.css'
import 'katex/dist/katex.min.css'
```
