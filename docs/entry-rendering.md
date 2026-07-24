# Generic Entry rendering (`@sjtu-ai4math/snl-basics/entry`)

The optional `/entry` subpath renders complete query-backed Entries without owning
a database, filesystem, pointer resolver, or host message protocol. It is kept out
of the package root so applications that only render SNL trees do not pull in the
Markdown pipeline.

## Setup

```tsx
import { MacroDataDriver, ReaderRuntime } from '@sjtu-ai4math/snl-basics'
import {
  EntryDataDriver,
  EntryPreviewProvider,
  EntryView,
} from '@sjtu-ai4math/snl-basics/entry'
import '@sjtu-ai4math/snl-basics/style.css'
import '@sjtu-ai4math/snl-basics/entry/style.css'
import 'katex/dist/katex.min.css'

const entries = new EntryDataDriver({
  queries: {
    async query_entry({ entry_id, signal }) {
      const response = await fetch(`/entries/${encodeURIComponent(entry_id)}`, { signal })
      return response.status === 404 ? null : response.json()
    },
    async query_entry_kind({ kind_id, signal }) {
      const response = await fetch(`/entry-kinds/${encodeURIComponent(kind_id)}`, { signal })
      return response.status === 404 ? null : response.json()
    },
  },
})

const runtime = new ReaderRuntime({
  queries: { query_environment: () => ({ language: readLanguageSetting() }) },
})

<EntryPreviewProvider entry_data_driver={entries} macro_data_driver={macros} reader_runtime={runtime}>
  <EntryView entry_id="definition.ring" entry_data_driver={entries} macro_data_driver={macros} reader_runtime={runtime} />
</EntryPreviewProvider>
```

## Rendering contract

- Body priority is nonblank SNL, Markdown, Typst, LaTeX, text, then a header-only card.
- Markdown, Typst, LaTeX, and text may be invariant strings or serialized
  `I18n<string,string>` maps. SNL is always a language-invariant string.
- A localized body is resolved through the injected `ReaderRuntime`; Basics
  never reads a locale or settings backend itself. Invariant legacy strings do
  not require a runtime.
- SNL parse and context-query errors preserve the original source.
- Titles are prose with balanced `$...$` inline-math islands; escaped or
  unbalanced dollars remain prose.
- Entry-kind stroke/background colors are applied literally, with neutral and
  transparent fallbacks.
- `mdata.src` references are resolved only through `EntryDataDriver`. Matching
  declarations become `bvar`; missing Entries get `dangling`; existing Entries
  without the declaration get `srcResolvedNoDecl`.
- Macro `source.entries` drive recursive previews through the same Entry and
  Macro drivers.

`EntryDataDriver` has a bounded hit-and-miss LRU, unsignalled in-flight
request deduplication, independently cancellable signalled requests, and epoch
protection so `clear_cache()` cannot be undone by stale completions.

## Host ports

Use `on_title_activate`, `on_source_activate`, and `on_preview_activate` to adapt
to routing, editor, or VS Code behavior. Pointer values are opaque and passed
back unchanged. Async callback rejection is contained by the renderer.

The package does not resolve paths, access storage, or prescribe host message
shapes. Those remain consumer adapters.
