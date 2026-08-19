# Parameterized SVG Templates + Formula Foreign Boxes Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task. Bind every review to an exact commit/tree. Do not merge or publish until the production gates at the end are satisfied.

**Goal:** Build one stable “foreign rendered subtree” substrate that supports parameterized, precompiled SVG term/block Macros and later allows block Macro nodes inside KaTeX-owned formulas without remounting live React content or corrupting formula geometry.

**Architecture:** Treat both features as consumers of a common measured foreign-box system. A foreign renderer owns a persistent React subtree outside KaTeX/SVG-owned markup, reports intrinsic metrics, and is positioned over a trusted marker. Parameterized SVG uses SVG-native `data-snl-slot` markers for child placement; formula embedding uses Basics-generated KaTeX `data-snl-foreign-slot` markers whose dimensions are known before the final KaTeX layout. Share identity, staging, measurement, overlay positioning, convergence, interaction, lifecycle, and export infrastructure, but keep SVG asset semantics separate from formula-layout policy.

**Tech Stack:** TypeScript, React 19, KaTeX 0.16, inline sanitized SVG, `ResizeObserver`, `requestAnimationFrame`, Vitest/jsdom, real Chromium geometry fixtures, Vite library/packed-consumer gates.

**Pinned planning baseline:** `SNL-Basics@c489bd0a56e71a8e525ea112f0ce582b1a12b21f` (`main`, clean when this plan was archived).

**Related prior plan:** `.hermes/plans/2026-08-10_175049-snl-0.3-formula-layout-foreign-block-slots.md`. This plan supersedes its milestone ordering but preserves its measured-placeholder architecture and rejection of post-render phantom resizing.

---

## 1. Required semantic boundaries

### 1.1 One shared substrate, two distinct slot protocols

- `data-snl-slot="N"`: a parameter position inside a sanitized SVG template.
- `data-snl-foreign-slot="<stable-id>"`: the location reserved by KaTeX for one complete foreign React box.
- Do not overload one marker for both layers.
- Do not make every foreign box pretend to be SVG.
- Do not make SVG templates carry KaTeX-specific policy unless the SVG Macro is actually embedded in a formula.

### 1.2 No new SNL call syntax

Authors continue to write ordinary Macro applications:

```snl
CommutativeSquare(A,B,C,D,f,g,h,k)
```

SVG slot markers are backend metadata, not SNL syntax. Do not introduce `{{slot:0}}`, `$SLOT_0`, raw textual replacement, or a second author-facing placeholder grammar.

### 1.3 Never run the LaTeX placeholder substituter over SVG text

The current `#0/#1/#*` scanner is LaTeX-contextual and conflicts with ordinary SVG constructs such as:

```svg
fill="#0f0"
href="#path0"
clip-path="url(#clip0)"
```

Reuse the existing arity *contract* and child rendering, not `fillLatexTemplate()` over serialized SVG. SVG slots must be discovered only from validated `data-snl-slot` attributes.

### 1.4 Parameter children remain SNL trees

A slot receives `renderChild(node.children[index])`. Never stringify a child and interpolate it into XML. This preserves hover, kind, source, tree path, binding metadata, nested formula rendering, and future renderer behavior.

### 1.5 Formula layout must know dimensions before KaTeX constructs vlists

Rejected path:

```text
render KaTeX → enlarge a phantom span with CSS → expect fraction/matrix geometry to repair itself
```

Required path:

```text
mount persistent foreign subtree in staging layer
→ measure or load trusted fixed metrics
→ render surrounding KaTeX with a sized marker
→ locate marker
→ position persistent subtree over marker
```

A size change causes a bounded, batched KaTeX rerender. The live foreign subtree must not remount.

### 1.6 First release scope

Supported initially:

- fixed/intrinsic SVG viewBox;
- fixed positional slots;
- formula/text children in SVG slots;
- fixed metrics when SVG is embedded inside a formula;
- baseline policy `alphabetic | axis-center | bottom`;
- fail-visible fallback.

Deferred:

- author-controlled path/attribute substitution;
- arbitrary geometry parameters;
- fill-width/self-wrapping foreign blocks;
- recursive foreign block inside an SVG slot;
- equation numbering/tag/fleqn replacement;
- generic interactive widgets before fixed SVG passes the vlist gate.

---

## 2. Proposed public/internal contracts

Names may change during Task 1 after the exact current surface audit, but the separation of responsibilities is mandatory.

```ts
export type ForeignBoxBaseline = 'alphabetic' | 'axis-center' | 'bottom'

export interface ForeignBoxMetrics {
  width: number
  height: number
  depth: number
  baseline: ForeignBoxBaseline
}

export interface FormulaEmbedPolicy {
  width: 'intrinsic' | { px: number }
  baseline: ForeignBoxBaseline
  overflow: 'visible' | 'clip' | 'fallback-block'
  accessible_text?: string
}

export interface SvgTemplateSlot {
  index: number
  marker: SVGGElement
}

export interface ForeignBoxIdentity {
  tree_path: string
  render_generation: number
}
```

The persistent registry must bind every metric and DOM callback to its complete producer identity. A result from a previous tree path, renderer, asset revision, or render generation must not be accepted.

A renderer-owned SVG extension may live on the complete TemplateSpec projection, because the existing schema permits opaque consumer-owned projection fields. Before choosing exact persisted fields, Task 1 must audit the already-shipped SVG representation and avoid creating a parallel asset model.

Illustrative shape only:

```json
{
  "mode": "block",
  "body": "<sanitized svg or existing SVG reference representation>",
  "block_template_name": "svg-template",
  "svg_template_version": 1,
  "formula_embed": {
    "width": "intrinsic",
    "baseline": "axis-center",
    "overflow": "fallback-block"
  }
}
```

Do not commit this exact JSON shape until the current SVG Macro implementation and downstream Extension/export representation have been audited.

---

## 3. Task sequence

### Task 1: Audit and freeze the existing SVG and formula contracts

**Objective:** Establish the exact current representations and write RED contract tests before adding infrastructure.

**Files:**
- Inspect: `src/snl-macro/types.ts`
- Inspect: `src/snl-syntax-tree/template.ts`
- Inspect: `src/snl-react-view/hooks.tsx`
- Inspect: `src/components/SnlSyntaxTreeView.tsx`
- Inspect: `src/snl-react-view/render-source.ts`
- Inspect: `src/snl-react-view/block-renderers.tsx`
- Inspect: `src/entry-react/entry-render.tsx`
- Inspect: `src/snl-react-view/view-integration.test.tsx`
- Inspect: `README.md`, `MIGRATION.md`, `docs/api.md`
- Inspect downstream: current SNL-Doc-Extension SVG Macro authoring, preview, Infoview, asset broker, HTML export, and packed `@sjtu-ai4math/snl-basics` consumption paths.
- Create: `docs/foreign-rendered-subtrees.md`
- Test: `src/snl-react-view/foreign-box-contract.test.tsx`

**Steps:**

1. Record the exact on-disk SVG Macro representation and whether SVG bytes are inline, data URL, workspace asset, or opaque TemplateSpec extension.
2. Record every consumer that renders or exports that SVG representation.
3. Audit real Macro data to determine current arity derivation and whether any renderer ignores `body` while depending on its placeholders.
4. Add a failing test proving ordinary SVG fragment/color syntax cannot be interpreted as Macro placeholders.
5. Add a failing test proving duplicate, missing, negative, non-integer, or sparse `data-snl-slot` values are rejected for fixed arity.
6. Add a failing test proving an SVG child remains an SNL subtree passed through `renderChild`, not a serialized string.
7. Add a failing test for the current formula behavior: a block descendant emits the visible “cannot be used inside a formula” fallback.
8. Document the chosen exact persisted representation and migration decision in `docs/foreign-rendered-subtrees.md` before implementation.
9. Run focused tests and confirm the new behavior tests fail for the intended missing capability, not fixture/type errors.
10. Commit only the contract document and RED tests.

**Commit:**

```bash
git add docs/foreign-rendered-subtrees.md src/snl-react-view/foreign-box-contract.test.tsx
git commit -m "test: specify SVG and formula foreign-box contracts"
```

---

### Task 2: Extract a backend-neutral slot-contract validator

**Objective:** Share arity invariants without applying LaTeX token rules to SVG.

**Files:**
- Create: `src/snl-syntax-tree/slot-contract.ts`
- Modify: `src/snl-syntax-tree/template.ts`
- Modify: `src/snl-react-view/render-source.ts`
- Modify: `src/core/index.ts`
- Modify: `src/snl-react-view/index.ts`
- Test: `src/snl-syntax-tree/slot-contract.test.ts`
- Test: existing `src/snl-syntax-tree/template.test.ts`

**Steps:**

1. Write RED tests for a pure validator accepting an ordered set of positional indices and returning the same fixed/dynamic arity contract used by Macro validation.
2. Cover unique contiguous indices, duplicates, gaps, negative values, non-integers, fixed/dynamic disagreement, `#*`, and `#0..#99` limits.
3. Implement the pure validator without DOM, React, SVG, or KaTeX dependencies.
4. Keep `analyzeLatexTemplatePlaceholders()` as the LaTeX adapter; route its result through the shared contract where practical.
5. Do not change existing LaTeX placeholder behavior or migration output.
6. Mutation-check by reintroducing acceptance of a sparse slot set and require the test to fail.
7. Run all template/schema/render-source tests.
8. Commit.

**Commit:**

```bash
git add src/snl-syntax-tree/slot-contract.ts src/snl-syntax-tree/template.ts src/snl-react-view/render-source.ts src/core/index.ts src/snl-react-view/index.ts src/snl-syntax-tree/slot-contract.test.ts src/snl-syntax-tree/template.test.ts
git commit -m "refactor: share backend-neutral Macro slot contracts"
```

---

### Task 3: Implement sanitized SVG template parsing and slot discovery

**Objective:** Turn trusted SVG content/reference output into inert geometry plus validated positional markers.

**Files:**
- Create: `src/snl-react-view/svg-template.ts`
- Create: `src/snl-react-view/svg-template.test.ts`
- Modify: `src/snl-react-view/index.ts`
- Modify: `src/snl-react-view/style.css`
- Potentially modify the existing SVG asset broker rather than creating a second loader.

**Steps:**

1. Write RED tests for parsing valid SVG and returning `viewBox`, sanitized root, and ordered `data-snl-slot` markers.
2. Add malicious fixtures containing `script`, event attributes, `javascript:` URLs, external image/font/style URLs, `foreignObject`, animation, and namespace tricks.
3. Require fail-closed sanitization; do not silently preserve unsupported active content.
4. Preserve only the minimal safe SVG elements/attributes required by actual TeX-generated fixtures plus `data-snl-slot` and the agreed anchor metadata.
5. Validate slot indices using Task 2’s common contract.
6. Ensure IDs, clip paths, gradients, and `url(#local-id)` continue working without being mistaken for slots.
7. Bind loaded/cached assets to authored source, base/workspace identity, content revision/hash, and request epoch. Reuse the existing broker if one exists.
8. Bound settled caches and remove pending work after the last live consumer detaches.
9. Test source changes, late old asset replies, unmount, invalidation, and StrictMode replay.
10. Run focused tests, then the full suite.
11. Commit.

**Commit:**

```bash
git add src/snl-react-view/svg-template.ts src/snl-react-view/svg-template.test.ts src/snl-react-view/index.ts src/snl-react-view/style.css
git commit -m "feat: parse sanitized SVG templates with positional slots"
```

---

### Task 4: Build the persistent ForeignBox registry and overlay host

**Objective:** Own foreign React subtree identity, staging, geometry, observers, and teardown independently of KaTeX-owned DOM.

**Files:**
- Create: `src/snl-react-view/foreign-box.ts`
- Create: `src/snl-react-view/foreign-box-host.tsx`
- Create: `src/snl-react-view/use-foreign-box.ts`
- Create: `src/snl-react-view/foreign-box-host.test.tsx`
- Modify: `src/snl-react-view/hooks.tsx`
- Modify: `src/snl-react-view/index.ts`
- Modify: `src/snl-react-view/style.css`

**Steps:**

1. Write RED tests for stable identity, registration, metric publication, marker attachment, overlay positioning, and unregister.
2. Implement a provider/host that mounts each foreign child once in a persistent layer.
3. Keep staging/measurement DOM separate from final positioned overlay state.
4. Bind every metric report and marker association to `{treePath, generation, producer}`.
5. Add `ResizeObserver` with retained-callback tests after disconnect.
6. Batch geometry writes in one `requestAnimationFrame`; cancel RAF and observers before external cleanup callbacks.
7. Add real teardown and StrictMode layout/passive replay tests.
8. Add scroll, resize, transformed host, and visual zoom update seams; do not install one global listener per slot.
9. Expose narrow internal contracts; do not expose test snapshots in the production bundle.
10. Commit after focused and full tests pass.

**Commit:**

```bash
git add src/snl-react-view/foreign-box.ts src/snl-react-view/foreign-box-host.tsx src/snl-react-view/use-foreign-box.ts src/snl-react-view/foreign-box-host.test.tsx src/snl-react-view/hooks.tsx src/snl-react-view/index.ts src/snl-react-view/style.css
git commit -m "feat: add persistent measured foreign-box host"
```

---

### Task 5: Implement parameterized SVG rendering outside formulas

**Objective:** Deliver the first user-visible consumer of the shared substrate in ordinary block/text ancestry.

**Files:**
- Create: `src/snl-react-view/svg-template-renderer.tsx`
- Create: `src/snl-react-view/svg-template-renderer.test.tsx`
- Modify: `src/snl-react-view/hooks.tsx`
- Modify: `src/snl-react-view/block-renderers.tsx`
- Modify: `src/components/SnlSyntaxTreeView.tsx` only if the existing block-renderer contract lacks required resolved TemplateSpec data.
- Modify: `src/snl-react-view/style.css`
- Modify: `README.md`, `README(ZH).md`, `docs/api.md`

**Steps:**

1. Write RED tests with a real sanitized SVG fixture containing multiple transformed markers.
2. Render each child through the existing `renderChild` callback and preserve its semantic metadata.
3. Position child overlays from marker geometry without replacing SVG strings.
4. Preserve default renderer behavior. Remember hook merging is shallow: consumers that supply a renderer map must spread `defaultRenderers` unless the implementation deliberately and compatibly changes that contract.
5. Support language/style changes without remounting unaffected child subtrees.
6. Initially reject block-mode children inside SVG slots to avoid recursive foreign boxes; show a visible fallback.
7. Add tests for long labels, nested formula children, hover/tree path/source metadata, missing children, excess children, malformed slots, and narrow host width.
8. Add a real browser fixture and screenshot for a commutative square or universal-property diagram.
9. Verify no new SNL author syntax appears in documentation or persisted calls.
10. Commit.

**Commit:**

```bash
git add src/snl-react-view/svg-template-renderer.tsx src/snl-react-view/svg-template-renderer.test.tsx src/snl-react-view/hooks.tsx src/snl-react-view/block-renderers.tsx src/components/SnlSyntaxTreeView.tsx src/snl-react-view/style.css README.md 'README(ZH).md' docs/api.md
git commit -m "feat: render parameterized SVG Macro templates"
```

---

### Task 6: Embed fixed-metric SVG foreign boxes inside formulas

**Objective:** Use SVG as the first low-risk formula foreign-box consumer and validate KaTeX vlist geometry.

**Files:**
- Create: `src/snl-react-view/formula-foreign-box.ts`
- Create: `src/snl-react-view/formula-foreign-box.test.tsx`
- Modify: `src/snl-react-view/render-source.ts`
- Modify: `src/components/SnlSyntaxTreeView.tsx`
- Modify: `src/snl-react-view/svg-template-renderer.tsx`
- Modify: `src/snl-react-view/style.css`
- Create browser fixture under `test-fixtures/formula-foreign-box/`
- Create/modify a deterministic browser verification script under `scripts/`.

**Steps:**

1. Write a RED test for `a + SvgMacro(...) + b` proving current code emits the block-in-formula warning.
2. Add a trusted formula-embed policy resolved from the complete selected TemplateSpec; authored text must never directly become TeX dimensions or slot IDs.
3. For the first implementation, require fixed/intrinsic metrics from sanitized SVG `viewBox` plus a declared baseline policy.
4. Emit a sized KaTeX marker before final KaTeX render. Calibrate px/em/rule/depth conversion with a real Chromium test; do not assume CSS pixels map directly to TeX dimensions.
5. Attach the persistent SVG surface to the committed marker without remounting it.
6. Test ordinary inline, numerator, denominator, square root, superscript, subscript, matrix/array cell, sum limits, and nested delimiters.
7. Assert surrounding KaTeX bounding boxes include the foreign box and no slot visibly overflows.
8. Assert hover, click, focus, and child state survive a surrounding KaTeX rerender.
9. Reject/fallback when metrics or marker resolution are unavailable.
10. Treat any irreparable vlist misalignment as an architecture BLOCK before continuing to generic blocks.
11. Commit only if the real-browser geometry gate passes.

**Commit:**

```bash
git add src/snl-react-view/formula-foreign-box.ts src/snl-react-view/formula-foreign-box.test.tsx src/snl-react-view/render-source.ts src/components/SnlSyntaxTreeView.tsx src/snl-react-view/svg-template-renderer.tsx src/snl-react-view/style.css test-fixtures/formula-foreign-box scripts
git commit -m "feat: embed fixed SVG foreign boxes in formulas"
```

---

### Task 7: Add bounded dynamic measurement and convergence

**Objective:** Allow label/language/style changes to update the formula-reserved box without loops or stale writes.

**Files:**
- Modify: `src/snl-react-view/foreign-box.ts`
- Modify: `src/snl-react-view/foreign-box-host.tsx`
- Modify: `src/snl-react-view/formula-foreign-box.ts`
- Modify: `src/components/SnlSyntaxTreeView.tsx`
- Test: `src/snl-react-view/foreign-box-convergence.test.tsx`
- Extend real-browser fixture.

**Steps:**

1. Write RED tests where a child changes from a short to a long label and reports new metrics.
2. Add metric epochs and reject late results from previous assets, languages, styles, paths, or generations.
3. Ignore deltas no larger than 0.5 px.
4. Batch all slot changes into one surrounding-root rerender per animation frame.
5. Cap convergence at four iterations per update epoch.
6. Detect A→B→A oscillation and switch to a visible out-of-formula fallback instead of continuing.
7. Ensure multiple sibling slots resolving in one commit compose rather than overwrite each other.
8. Assert no focus loss, remount, duplicate observer, pending RAF, or post-unmount write.
9. Add a real-browser language/style transition and inspect exact before/after geometry.
10. Commit.

**Commit:**

```bash
git add src/snl-react-view/foreign-box.ts src/snl-react-view/foreign-box-host.tsx src/snl-react-view/formula-foreign-box.ts src/components/SnlSyntaxTreeView.tsx src/snl-react-view/foreign-box-convergence.test.tsx test-fixtures/formula-foreign-box
git commit -m "feat: converge dynamic formula foreign-box metrics"
```

---

### Task 8: Generalize from SVG to selected block renderers

**Objective:** Permit explicitly opted-in block Macro renderers inside formulas using the proven foreign-box substrate.

**Files:**
- Modify: `src/snl-react-view/hooks.tsx`
- Modify: `src/snl-react-view/foreign-box.ts`
- Modify: `src/components/SnlSyntaxTreeView.tsx`
- Test: `src/snl-react-view/formula-block-integration.test.tsx`
- Modify docs.

**Steps:**

1. Add an explicit renderer capability/policy; do not make every generic block formula-embeddable by default.
2. Add RED tests for a fixed icon/badge renderer and a fixed-width table/list renderer.
3. Require `intrinsic` or fixed pixel width initially. Reject fill-width/self-dependent wrapping.
4. Define baseline and overflow policy per renderer/template projection.
5. Preserve nested block→formula rendering and unique tree paths.
6. Keep recursive foreign block→foreign block disabled until a separate depth/cycle policy is designed.
7. Add accessibility fallback text at the KaTeX reading-order marker.
8. Test selection/copy behavior and document its limits honestly.
9. Run all SVG tests unchanged to prove the generalization did not specialize the substrate around tables/lists.
10. Commit.

**Commit:**

```bash
git add src/snl-react-view/hooks.tsx src/snl-react-view/foreign-box.ts src/components/SnlSyntaxTreeView.tsx src/snl-react-view/formula-block-integration.test.tsx README.md 'README(ZH).md' docs/api.md
git commit -m "feat: opt selected block renderers into formula layout"
```

---

### Task 9: Static export, packed package, and Extension integration

**Objective:** Prove the feature outside source tests and define no-measurement fallback behavior.

**Files:**
- Modify/create SNL Basics export documentation and public API tests.
- Modify `scripts/copy-lib-assets.mjs` if new public CSS/assets are required.
- Modify `scripts/verify-subpath-types.ts`.
- Create packed-consumer fixture for parameterized SVG and formula embedding.
- Modify SNL-Doc-Extension preview, Infoview, editor preview, asset broker, and HTML export consumers as established by Task 1.
- Add real Entry fixture in a consumer repository; do not use an isolated source-only demo as the release gate.

**Steps:**

1. Define static export behavior:
   - live DOM export may freeze measured overlays into deterministic positioned markup;
   - SSR/no-measurement path must render accessible fallback or use trusted precomputed metrics;
   - never silently omit the foreign child.
2. Add packed tarball fresh-consumer tests for root and `./entry` imports, public CSS closure, and type declarations.
3. Fix any existing packed gate whose version is stale before crediting package validation.
4. Run a fresh consumer using only registry/tarball public entry points; no source-relative imports.
5. Integrate one actual `.SNL_Doc` Entry with a parameterized SVG diagram into Extension preview and Infoview.
6. Test editor language/style changes, save/reload, hover, popovers, and static HTML export.
7. Verify CSP permits only the required local asset flow; no remote SVG/script/font fetches.
8. Run browser screenshot regression in light/dark themes and narrow/wide widths.
9. Commit Basics and Extension separately, with exact dependency SHA/version recorded.

---

### Task 10: Exact-tree review and release decision

**Objective:** Decide whether the implementation is a 0.3 feature, remains experimental, or must be reduced.

**Steps:**

1. Freeze the exact Basics candidate commit/tree.
2. Run an independent semantic/API review:
   - no new SNL call syntax;
   - no Macro-name semantic hardcoding;
   - arity remains one coherent contract;
   - SVG and formula slot protocols remain distinct;
   - unsupported contexts fail visibly.
3. Run an independent lifecycle/security review:
   - sanitizer is fail-closed;
   - old async replies cannot mutate current DOM;
   - observer/RAF/listener/cache ownership is bounded;
   - StrictMode and teardown tests are load-bearing;
   - no raw `innerHTML` path receives untrusted SVG.
4. Run full gates:

```bash
npm test
npm run build:lib
npm pack --json
npm run verify:packed-entry-i18n
```

5. Run all real-browser geometry fixtures and inspect screenshots/DOM.
6. Run Extension compile, webview build, tests, F5/full Extension host verification, and real Entry export.
7. Fix every BLOCK, freeze a new exact tree, and repeat both reviews.
8. Race guard against `origin/main` immediately before integration.
9. Do not publish npm or push downstream dependency updates until fresh packed-consumer and exact-tree reviews are green.

---

## 4. Test matrix

### SVG template contract

- Valid contiguous slots `0..N-1`.
- Duplicate/gapped/negative/non-integer slots rejected.
- SVG `#fff`, `#0f0`, `href="#id"`, and `url(#clip0)` unaffected.
- Malicious script/event/URL/foreignObject fixtures rejected or stripped according to one documented fail-closed policy.
- Local gradients, clip paths, masks, and symbols survive if allowed.
- Parameter children retain SNL metadata and hover behavior.

### Foreign-box lifecycle

- Stable child DOM identity across KaTeX rerenders.
- No stale metric or asset reply after key/generation change.
- Real unmount blocks retained callbacks.
- StrictMode layout/passive replay recreates live registrations.
- Observer target replacement drops detached targets.
- No pending RAF/listeners/observers after teardown.
- Strong caches remain bounded after high-volume source transitions.

### KaTeX geometry

- Inline arithmetic.
- Fraction numerator/denominator.
- Radical.
- Superscript/subscript.
- Matrix/array.
- Sum limits.
- Nested delimiters.
- Multiple sibling foreign boxes.
- Browser zoom, host CSS transform, scrolling, and resize.
- Dynamic label length/language/style changes.
- Oscillation fallback.

### Accessibility and export

- Accessible fallback appears in formula reading order.
- Keyboard focus remains on the live child across rerender.
- Copy/selection behavior is documented and tested.
- Live DOM export includes measured foreign content.
- SSR/no-measurement path never silently drops it.
- Sanitized SVG has no active external resource path.

---

## 5. Risks and decision points

1. **KaTeX vlist calibration fails:** stop generic block work; retain SVG outside formulas or use a separate formula root rather than shipping misaligned overlays.
2. **Circular width:** do not solve with debounce. Keep v1 intrinsic/fixed-width or fall back outside the formula.
3. **Baseline ambiguity:** require explicit policy; DOM does not expose a universal baseline.
4. **Accessibility/copy:** overlay DOM is not naturally in KaTeX’s textual order. Accessible fallback is mandatory; exact rich-copy parity may remain out of scope.
5. **SVG export flattening:** if positioned HTML children cannot be preserved in standalone SVG, export HTML composition or add a separate build-time flattening path. Do not use `foreignObject` as an undocumented shortcut.
6. **Schema stability:** prefer complete TemplateSpec extension fields and renderer contracts over a new SNL notation. Any persisted schema change requires migration and real consumer-data audit.
7. **Performance:** N dynamic foreign boxes may rerender one surrounding KaTeX root. Batch updates, cap convergence, and measure actual Entry workloads before setting public limits.
8. **Recursive embedding:** defer until tree-path identity, depth limits, and cycle behavior are explicitly specified.

---

## 6. Production acceptance criteria

The feature is not complete until all are true:

- [ ] Ordinary SNL Macro application syntax is unchanged.
- [ ] SVG slot markers are SVG metadata, not raw string substitution.
- [ ] Existing LaTeX placeholder behavior is byte-compatible.
- [ ] Parameter children are rendered through `renderChild` with complete metadata.
- [ ] Sanitization is fail-closed and mutation-checked.
- [ ] Fixed SVG passes every real Chromium KaTeX vlist geometry fixture.
- [ ] Dynamic updates converge or fail visibly within the bounded iteration budget.
- [ ] Persistent children do not remount or lose focus on KaTeX rerender.
- [ ] StrictMode, teardown, stale reply, observer replacement, and cache-bound tests pass.
- [ ] Static export and no-measurement fallback are explicit and tested.
- [ ] Packed tarball fresh-consumer passes using public imports only.
- [ ] SNL-Doc-Extension real Entry preview, Infoview, editing, and export pass.
- [ ] Two independent exact-tree reviews report no BLOCK.

---

## 7. Recommended first session target

Do **Tasks 1–3 only** in the first implementation session:

1. exact SVG/current-consumer audit;
2. RED contract tests;
3. backend-neutral slot validation;
4. sanitized SVG parser and slot discovery.

Do not start KaTeX geometry work until this substrate is committed, reviewed, and proven not to alter existing LaTeX Macro arity or SVG rendering. The second session should implement the persistent foreign-box host and ordinary parameterized SVG. The third should run the fixed-metric formula spike and make the vlist go/no-go decision.
