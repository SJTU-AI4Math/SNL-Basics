# `@sjtu-ai4math/snl-basics` — Public API Reference

Current beta surface for v0.2.0. Import from the package root:

```ts
import { MacroDataDriver, SnlSyntaxTreeView } from '@sjtu-ai4math/snl-basics'
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

interface I18n<Language extends string, Value = string> {
  type: 'i18n'
  default_language: Language
  values: Partial<Record<Language, Value>>
}
type Localized<Language extends string, Value = string> = Value | I18n<Language, Value>

interface SnlMacroStyle {
  style_name: string
  mode: 'formula_inline' | 'formula_display' | 'text' | 'block'
  template: string | I18n<string, string> // I18n only when mode === 'text'
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

When source omits an explicit `[style]`, `styles[0]` is the sole implicit
default. An explicit `[style]` always wins. Formula and block templates are
invariant strings; text templates may be strings or `I18n` values resolved by
the injected language environment.

Plain Macro and style identifiers accept the legacy ASCII set (`A-Z`, `a-z`,
`0-9`, `_`, leading `\\`, and subsequent `.`/`-`) plus visible non-ASCII
Unicode code points. ASCII punctuation outside that allow-list, whitespace,
controls, format controls (including zero-width/bidi controls), and lone UTF-16
surrogates are rejected. `isSnlIdentifier` exposes the exact shared policy.

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

## Query-injected Reader runtime

```ts
type ReaderM<Environment, Value> = (environment: Environment) => Value

interface ReaderRuntimeQueries<Environment> {
  query_environment(): Environment
}

class ReaderRuntime<Environment> {
  constructor(options: { queries: ReaderRuntimeQueries<Environment> })
  query_environment(): Environment
  run_reader<Value>(reader: ReaderM<Environment, Value>): Value
}
```

Every environment-dependent Basics API is expressed as a Reader and executed
through a query-initialized runtime. Basics never chooses the settings, locale,
theme, request context, or persistence backend. `read_localized` resolves a
projection, while `write_localized` merges an edited projection back into the
currently queried language without discarding sibling translations. See
[Query-injected runtime standard](query-injected-runtime.md).

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
  activation_controller?: SnlActivationDispatcher<SnlHoverPhaseEvent>
  onDiagnostics?: (diagnostics: readonly SnlDiagnostic[]) => void
}

function SnlSyntaxTreeView(props: SnlSyntaxTreeViewProps): ReactElement
```

All mode, style, template, kind, description, and source information used by a
render comes from `macro_data_driver`. Formula modes use KaTeX, text mode uses
native React text with optional math islands, and block mode dispatches through
`block_template_name`.

Basics has built-in behavior only for `sub`, `binder`, `bvar`, and `fvar`.
Every other Entry kind uses const behavior while retaining its tag for palette
and appearance. Temporary roots default to metadata-transparent `sub`; unknown
names become `fvar` after Macro-aware semantic resolution. `onDiagnostics`
reports fail-closed source errors and style fallback warnings.

`SnlInteractionDriver` provides delegated hover, leave, click, and literal
Ctrl-click callbacks. Each callback receives the original syntax-tree node and
its stable tree path.

`SnlRenderHooks` exposes independent `onHover`, `onHover1s`, and `onHover2s`
hooks. By default immediate hover only highlights, one second shows the tooltip,
two seconds locks it, and click shows and locks it immediately. `SnlTooltipState`
exposes the lock as optional `locked?: boolean` (`undefined` means false). Every
phase receives a shared `SnlHoverSession` through the hook-specific
`SnlHoverPhaseEvent.session`; its stable
`id` and `data: Map<unknown, unknown>` provide an explicit communication channel
between the independently replaceable hooks.
`SnlActivationController` additionally configures the default phase behavior at
initialization time: disable it, replace handlers for phases 0/1/2, or attach
consumer parameters without rebuilding the view's timers.

## Customization

The root also exports `defaultRenderHooks`, `defaultHighlightStrategy`,
`defaultRenderers`, `DEFAULT_KIND_PALETTE`, palette helpers, hover-popover
helpers, and advanced pure rendering helpers. See the generated declaration
file for their exact signatures.

Import the required styles once:

```ts
import '@sjtu-ai4math/snl-basics/style.css'
import 'katex/dist/katex.min.css'
```

## Optional Entry subpath

The complete Entry renderer is deliberately isolated from the root API:

```ts
import {
  EntryDataDriver,
  EntrySurface,
  EntryView,
  EntryPreviewProvider,
  resolveEntryContextSources,
} from '@sjtu-ai4math/snl-basics/entry'
import '@sjtu-ai4math/snl-basics/entry/style.css'
```

`EntryDataDriver` accepts only `query_entry` and `query_entry_kind` functions.
It applies the same bounded cache, cancellation, in-flight deduplication, and
cache-clear race guarantees as `MacroDataDriver`. `EntryView` queries both the
Entry and its kind, while `EntrySurface` dispatches SNL, Markdown, LaTeX, and
text bodies. See [`entry-rendering.md`](entry-rendering.md) for the complete
rendering and host-port contract.
