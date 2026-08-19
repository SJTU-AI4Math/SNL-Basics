# Foreign-rendered subtree substrate audit

This note freezes the pre-implementation contract surface for Tasks 1–3 only. It records what is actually shipped today in SNL-Basics and the downstream Extension at exact commit `8a335687609158744fda09122956721a7cbbf618` (inspected read-only from `/home/argustest/SNL-Doc-Extension-issue1`).

## Current shipped representation

- **No dedicated SVG Macro representation is shipped yet.** Repository-wide inspection found no persisted `svg-template`, `data-snl-slot`, `svg_template_version`, or `formula_embed` fields in SNL-Basics or the downstream Extension.
- **The only shipped Macro render payload in Basics is the v11 `style.template` projection.** `src/snl-macro/types.ts` defines one complete template projection with `mode`, `body`, `separator?`, `block_template_name?`, plus opaque consumer-owned extension fields on the projection object.
- **The Extension persists a superset of that same projection, not a separate SVG asset model.** `src/snlDoc.ts` and `webview/src/render/macroWire.ts` both keep the Basics projection boundary and add Extension-owned output backends / opaque fields around it.
- **Current asset brokering is generic workspace-image brokering, not SVG-template storage.** The inspected downstream asset path is `src/workspaceAssets.ts` + `webview/src/runtime/workspaceAssetBroker.ts`; it brokers `.png/.jpg/.gif/.webp/.svg/.avif` files for `<img>` consumers. The Extension also has a block `image` renderer in `webview/src/render/blockRenderers.tsx`, but that is an image macro preset, not a parameterized SVG subtree protocol.

## Current consumers and evidence paths

### Basics

| Surface | Evidence path | Current behavior |
| --- | --- | --- |
| Template projection contract | `src/snl-macro/types.ts` | One complete template projection owns `mode/body/separator/block_template_name` plus opaque consumer fields. |
| LaTeX placeholder scan/fill | `src/snl-syntax-tree/template.ts` | `#0..#99` and `#*` are LaTeX-only placeholder syntax. |
| Runtime template validation / resolution | `src/snl-react-view/render-source.ts` | Validates one projection, resolves localized projections atomically, and derives arity from placeholder analysis. |
| Text-mode renderer that still depends on placeholders | `src/components/SnlSyntaxTreeView.tsx` | `TextRun` scans template text for `#N/#*` and splices children through `renderChild`. |
| Block renderers | `src/snl-react-view/block-renderers.tsx` | Built-in block renderers ignore `template.body` and render `node.children` directly through `renderChild`. |
| Formula fallback contract | `src/snl-react-view/render-source.ts` | A block descendant inside a formula emits the visible red `block macro ... cannot be used inside a formula` fallback. |
| Entry surface consumption | `src/entry-react/entry-render.tsx` | `EntrySurface` routes SNL content into `SnlSyntaxTreeView`; no foreign subtree layer exists yet. |

### Downstream Extension (read-only audit, `8a335687609158744fda09122956721a7cbbf618`)

| Surface | Evidence path | Current behavior |
| --- | --- | --- |
| Macro authoring arity derivation | `src/templatePlaceholders.ts`, `webview/src/render/macroPreviewPlaceholders.ts`, `webview/src/CreateMacroApp.tsx`, `webview/src/PackagePanelApp.tsx` | Mirrors Basics placeholder analysis and derives preview arg counts from `#N` in `template.body`. |
| Preview / Infoview rendering | `webview/src/render/EntryRender.tsx`, `webview/src/render/EntrySurface.tsx`, `webview/src/EntryInfoviewApp.tsx`, `webview/src/App.tsx` | Routes preview, Infoview, and popovers through the published Basics `EntrySurface`. |
| Export consumer | `webview/src/export/htmlExport.ts`, `src/exportRuntime.ts` | HTML export snapshots already-rendered DOM and rewrites `<img>` assets; it does not know any SVG-template protocol yet. |
| Workspace asset broker | `src/workspaceAssets.ts`, `webview/src/runtime/workspaceAssetBroker.ts`, `src/preferencesHost.ts` | Host/webview broker resolves trusted-cache image URLs keyed by authored workspace paths and invalidation messages. |
| Existing block image preset | `webview/src/render/blockRenderers.tsx`, `webview/src/CreateMacroApp.tsx` | Uses brokered `<img>` rendering via `block_template_name`, not inline SVG subtree parsing. |

## Current arity derivation and placeholder dependence

- **Basics schema/runtime arity today is derived from the maximum numbered placeholder index, not from contiguous slot declarations.** `src/snl-syntax-tree/template.ts` reports `positional_arity = maxIndex + 1`, with `#*` tracked independently and `#100+` rejected.
- **Downstream authoring mirrors the same rule.** `src/templatePlaceholders.ts` and `webview/src/render/macroPreviewPlaceholders.ts` copy the same escape-aware analysis for validation and preview argument counts.
- **Some renderers depend on placeholders while others ignore `body`.**
  - `src/snl-react-view/render-source.ts` depends on placeholders for KaTeX rendering.
  - `src/components/SnlSyntaxTreeView.tsx` depends on placeholders for text-mode React splicing.
  - `src/snl-react-view/block-renderers.tsx` and custom downstream block renderers consume `renderChild` directly and do not read `body`.

## Phase decision for persisted representation and migration

- **This phase keeps the existing persisted representation boundary:** `style.template` remains the only managed render projection, and any SVG-specific data must live as consumer-owned projection fields on that same object.
- **This phase does not introduce a new persisted asset schema or migration.** No dedicated SVG representation exists today, and the only shipped asset broker is the downstream generic image broker.
- **LaTeX placeholder semantics and migration stay byte-for-byte unchanged.** SVG-local slots must therefore be discovered only from `data-snl-slot="N"` metadata, never from scanning `body` text for `#0/#1/#*`.

## Explicit boundary for Tasks 1–3

- Task 3 includes parser/sanitizer infrastructure **and** a backend-neutral asset registry. Asset authority is bound to authored source, base/workspace identity, revision/hash, and request epoch; loaders are consumer-supplied and AbortSignal-aware.
- The registry retains inactive authority tombstones in a separate LRU, bounded by `maxAuthorityHistory` (default `max(32, maxSettled * 2)`). Within that retained horizon, lower epochs and same-epoch/different-revision identities are rejected without loading; active authority state is never history-evicted. Once an inactive authority is evicted from this explicitly bounded history, an ancient epoch for that authority can be accepted again, so stale detection is deliberately bounded rather than eternal. Registry-global monotonic generations still reject late results from invalidation or authority changes independently of cancellation.
- Task 3 also exposes explicit safe instantiation: every clone receives a deterministic caller-supplied instance scope, IDs are rewritten, and all local references are rewritten consistently.
- It is **not** user-visible SVG rendering, persistent foreign-box hosting, KaTeX marker geometry, or Extension workspace policy. Tasks 4+ remain responsible for persistent hosting, ordinary SVG rendering, formula embedding, convergence, and downstream integration changes.
