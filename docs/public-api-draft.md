# SNL-Basics 对外接口 — Phase 1 起稿 (v2)

> **状态**: Phase 1 (起稿). 目的是把 npm 包 `@snl-basics/react` 的对外表面**逐条落成 entry 清单**, 交付物是一张能直接喂给 Phase 2 (术语化) + Phase 3 (条目预制) 的施工蓝图.
>
> **起稿 = 清单**: 每一行就是未来一个 entry, 明确 `id / kind / title / 父 entry`. 内容 (content.snl) Phase 3 才填. **散文性讨论**在本稿一律砍掉, 转成 `Concept` kind 的 entry (占位, 内容 Phase 3 写).

---

## 决策记录 (供后续 phase 引用, 已定不再讨论)

- **entry_kinds** (8): `Interface` / `Class` / `Field` / `Function` / `ReactComponent` / `Property` / `Constant` / `Concept`.
  - `Interface`: 成员**不**独立成 entry, field 写在 content 里.
  - `Class`: 成员独立成 sub-entry — 数据成员 = `Field`, 方法 = `Function` (复用, 不新开 `Method`).
  - `ReactComponent`: props 独立成 sub-entry, kind = `Property` (写全称避开 Lean `Prop` = Proposition 歧义).
  - `Constant`: 覆盖纯数据 + 可扩展默认值 (`defaultRenderHooks`, `defaultRenderers`, `defaultHighlightStrategy`), 不为后者单开 kind.
- **macro_kinds** (Phase 2 拍板, 目前占位): 至少一个 `Signature` 用于在 content 里塞 TS 签名 formula. 抄数学模式.
- **relationships labels** (Phase 4 建库时用): `imports` (Consumer→Symbol), `stability` (Symbol→StabilityLevel entry). 与 auto-managed 的 `depends` / `uses_context` 不冲突.
- **Stability 走 tags 字段**: Extension `EntryData` schema 目前**没有** `tags: string[]`, 本 Phase 后需补上 (data-only, 不做筛选功能, 数据通道先开出来). 三档 tag: `stable` / `experimental` / `internal`.
- **library 切分**: 按源码 module 切 3 个 library — `snl-syntax-tree` / `snl-react-view` / `snl-macro`. 概念 entry 汇到一个 `concepts` library.
- **父子表达**: 用 library graph 的 `branch` 结构, 不额外建 relationship.
- **命名规则** (entry id): `<library>.<kind-prefix>.<name>[.<member>]`. 全小写连字符; kind-prefix 缩写: `iface` / `cls` / `fn` / `comp` / `const` / `field` / `prop` / `concept`. 例: `snl-syntax-tree.iface.snl-syntax-tree`, `snl-syntax-tree.cls.parse-error.field.position`.

---

## Library 1 — `snl-syntax-tree`

对应 `src/snl-syntax-tree/`. 纯 TS, 无 React / KaTeX / DOM. Toolkit 深路径 import 就是这块.

### 1.1 Interfaces & Types

| id | kind | title | 备注 |
|---|---|---|---|
| `snl-syntax-tree.iface.snl-syntax-tree` | Interface | `SnlSyntaxTree` | 语法树主类型 (macro_name/kind/children/mdata/env_mode/style_name/scope) |
| `snl-syntax-tree.iface.snl-syntax-tree-base` | Interface | `SnlSyntaxTreeBase` | 基类型 (env_mode 四分支的共同字段) |
| `snl-syntax-tree.iface.snl-syntax-tree-formula-node` | Interface | `SnlSyntaxTreeFormulaNode` | formula env_mode 分支 |
| `snl-syntax-tree.iface.snl-syntax-tree-text-node` | Interface | `SnlSyntaxTreeTextNode` | text env_mode 分支 |
| `snl-syntax-tree.iface.snl-syntax-tree-block-node` | Interface | `SnlSyntaxTreeBlockNode` | block env_mode 分支 |

### 1.2 Classes

| id | kind | title | parent |
|---|---|---|---|
| `snl-syntax-tree.cls.parse-error` | Class | `SnlSyntaxTreeParseError` | — |
| `snl-syntax-tree.cls.parse-error.field.position` | Field | `.position` | `snl-syntax-tree.cls.parse-error` |
| `snl-syntax-tree.cls.parse-error.field.message` | Field | `.message` (来自 Error 基类) | `snl-syntax-tree.cls.parse-error` |

### 1.3 Functions

| id | kind | title |
|---|---|---|
| `snl-syntax-tree.fn.parse-snl-syntax-tree` | Function | `parseSnlSyntaxTree` |
| `snl-syntax-tree.fn.annotate-bindings` | Function | `annotateBindings` |
| `snl-syntax-tree.fn.create-snl-syntax-tree-node` | Function | `createSnlSyntaxTreeNode` |
| `snl-syntax-tree.fn.is-snl-syntax-tree` | Function | `isSnlSyntaxTree` |
| `snl-syntax-tree.fn.fill-latex-template` | Function | `fillLatexTemplate` |

---

## Library 2 — `snl-macro`

对应 `src/snl-macro/`. macro DB 数据模型.

### 2.1 Interfaces & Types

| id | kind | title |
|---|---|---|
| `snl-macro.iface.snl-macro` | Interface | `SnlMacro` |
| `snl-macro.iface.snl-macro-style` | Interface | `SnlMacroStyle` |
| `snl-macro.iface.snl-macro-source` | Interface | `SnlMacroSource` |
| `snl-macro.iface.macro-data-queries` | Interface | `MacroDataQueries` |

### 2.2 Classes

| id | kind | title |
|---|---|---|
| `snl-macro.cls.macro-data-driver` | Class | `MacroDataDriver` |
| `snl-macro.cls.macro-data-driver.field.query-macro` | Field | `.query_macro({macro_name, signal?})` |
| `snl-macro.cls.macro-data-driver.field.clear-cache` | Field | `.clear_cache(name?)` |

### 2.3 Query boundary

Macro 数据访问只公开 `MacroDataDriver` 与 `MacroDataQueries`。存储适配由消费端实现，不列入包 API entry。

---

## Library 3 — `snl-react-view`

对应 `src/snl-react-view/` + `src/components/`. React 组件层, KaTeX + React 依赖.

### 3.1 React Components

| id | kind | title | 备注 |
|---|---|---|---|
| `snl-react-view.comp.snl-syntax-tree-view` | ReactComponent | `SnlSyntaxTreeView` | 主渲染组件 |
| `snl-react-view.comp.snl-syntax-tree-editor` | ReactComponent | `SnlSyntaxTreeEditor` | GUI 编辑器 (Inductive) |

`SnlSyntaxTreeView` 的 props (来自 `SnlSyntaxTreeViewProps` interface). Props 逐条独立成 sub-entry, kind = `Property`, 挂在组件下:

| id | kind | title | parent |
|---|---|---|---|
| `snl-react-view.comp.snl-syntax-tree-view.prop.tree` | Property | `tree` | `snl-react-view.comp.snl-syntax-tree-view` |
| `snl-react-view.comp.snl-syntax-tree-view.prop.macro-data-driver` | Property | `macro_data_driver` | ↑ |
| `snl-react-view.comp.snl-syntax-tree-view.prop.interaction-driver` | Property | `interaction_driver` | ↑ |
| `snl-react-view.comp.snl-syntax-tree-view.prop.hooks` | Property | `hooks` | ↑ |
| `snl-react-view.comp.snl-syntax-tree-view.prop.palette` | Property | `palette` | ↑ |
| `snl-react-view.comp.snl-syntax-tree-view.prop.display-mode` | Property | `displayMode` | ↑ |

> **待补**: `SnlSyntaxTreeViewProps` 全字段清单我扫过入口签名但没跟具体 props 逐一对照 (源码在 `src/components/SnlSyntaxTreeView.tsx:397`). Phase 3 起 entry 时对着 interface 定义把 props 补齐 — 现在的表是"最常见 6 个"占位, 数量可能会补到 8~10. Editor 的 props 同理留到 Phase 3.

### 3.2 Interfaces & Types (hooks / palette 相关)

| id | kind | title |
|---|---|---|
| `snl-react-view.iface.snl-syntax-tree-view-props` | Interface | `SnlSyntaxTreeViewProps` |
| `snl-react-view.iface.snl-render-hooks` | Interface | `SnlRenderHooks` |
| `snl-react-view.iface.snl-hover-event` | Interface | `SnlHoverEvent` |
| `snl-react-view.iface.snl-macro-info` | Interface | `SnlMacroInfo` |
| `snl-react-view.iface.snl-resolved-source` | Interface | `SnlResolvedSource` |
| `snl-react-view.iface.snl-tooltip-state` | Interface | `SnlTooltipState` |
| `snl-react-view.iface.snl-highlight-strategy` | Interface | `SnlHighlightStrategy` |
| `snl-react-view.iface.snl-highlight-set` | Interface | `SnlHighlightSet` |
| `snl-react-view.iface.snl-renderer-registry` | Interface | `SnlRendererRegistry` |
| `snl-react-view.iface.snl-block-renderer` | Interface | `SnlBlockRenderer` |
| `snl-react-view.iface.snl-block-renderer-props` | Interface | `SnlBlockRendererProps` |
| `snl-react-view.iface.kind-palette` | Interface | `KindPalette` |
| `snl-react-view.iface.kind-coloring` | Interface | `KindColoring` |
| `snl-react-view.iface.snl-interaction-context` | Interface | `SnlInteractionContext` |

### 3.3 Functions

Parser / serializer 的 non-throw 变体 (源码在 `snl-react-view/parse.ts`, 但语义归 syntax-tree — 通过入口 re-export, 决策: **写在 syntax-tree library 还是 react-view library?**). 目前的判断: **按 re-export 入口归类, 而不是源码物理位置**. 那这条挪回 §1.3:

| id | kind | title |
|---|---|---|
| `snl-syntax-tree.fn.try-parse-snl-syntax-tree` | Function | `tryParseSnlSyntaxTree` |
| `snl-syntax-tree.fn.serialize-snl-syntax-tree` | Function | `serializeSnlSyntaxTree` |

react-view 自己的 functions:

| id | kind | title |
|---|---|---|
| `snl-react-view.fn.alpha` | Function | `alpha` |
| `snl-react-view.fn.palette-to-css` | Function | `paletteToCss` |
| `snl-react-view.fn.assert-safe-kind-name` | Function | `assertSafeKindName` |

### 3.3b Classes

| id | kind | title |
|---|---|---|
| `snl-react-view.cls.snl-interaction-driver` | Class | `SnlInteractionDriver` |

### 3.4 Constants

| id | kind | title |
|---|---|---|
| `snl-react-view.const.default-render-hooks` | Constant | `defaultRenderHooks` |
| `snl-react-view.const.default-highlight-strategy` | Constant | `defaultHighlightStrategy` |
| `snl-react-view.const.default-renderers` | Constant | `defaultRenderers` |
| `snl-react-view.const.default-kind-palette` | Constant | `DEFAULT_KIND_PALETTE` |
| `snl-react-view.const.htmldata-katex-defaults` | Constant | `HTMLDATA_KATEX_DEFAULTS` |

---

## Library 4 — `concepts`

横切概念. 每条都独立成 `Concept` entry, 供其它 entry 通过 `@` 引用 (Phase 3 写内容时用).

| id | kind | title |
|---|---|---|
| `concepts.concept.surface-a-npm` | Concept | Surface A — `@snl-basics/react` npm 入口 |
| `concepts.concept.surface-b-deep-path` | Concept | Surface B — Toolkit 深路径 (parser-only) |
| `concepts.concept.stability-stable` | Concept | 稳定级别 — Stable |
| `concepts.concept.stability-experimental` | Concept | 稳定级别 — Experimental |
| `concepts.concept.stability-internal` | Concept | 稳定级别 — Internal |
| `concepts.concept.consumer-extension` | Concept | Consumer — SNL-Doc-Extension |
| `concepts.concept.consumer-toolkit` | Concept | Consumer — SNL-Agent-Toolkit |
| `concepts.concept.npm-distribution` | Concept | npm 分发面 (`files: [dist-lib]` / tarball 白名单) |
| `concepts.concept.deep-path-import-decision` | Concept | 深路径 import 的正规化决策 (a/b/c 三个选项) |
| `concepts.concept.entry-kinds-catalogue` | Concept | 本文档的 entry_kinds 决策 (元文档) |

Stability 三档实体化成 Concept entry 有两个用处:
1. Symbol → `stability` → StabilityLevel Concept 边, 用于查询.
2. tag `entry.tags = ['stable']` 是 flat 字符串, Concept entry 承载定义 (什么算 stable).

---

## 汇总

- **snl-syntax-tree**: 5 Interface + 1 Class + 2 Field + 7 Function = **15 entries**
- **snl-macro**: 4 Interface + 1 Class + 3 Field = **8 entries**
- **snl-react-view**: 2 Component + 6 Property (待补至 ~10) + 14 Interface + 3 Function + 1 Class + 5 Constant = **31 entries** (含待补)
- **concepts**: **10 entries**

**总计 ~68 entries**, 全部 Phase 3 待填 content.

---

## 已知遗漏 / 待 Phase 3 补

- `SnlSyntaxTreeViewProps` / `SnlSyntaxTreeEditor` 的完整 props 列表需要对着源码 interface 定义补 sub-entry (§3.1 的表是占位, ~6 行可能扩到 ~10~15).
- 每条 entry 的**签名**在这份 draft 里没写 — 是 Phase 3 起 entry 时逐一 `$...$` 写进 content.snl 的活.
- `contribution_info` / `pointer` (EntryData 里已存在但未用) 在本 Phase 不涉及, 也不填.
- `entry.tags` 字段需要 Extension 端加 schema 支持 — 是 Phase 1 结束后的独立 commit, 与本 draft 平行.
- 条目编辑界面的预览框跟 Dashboard / Infoview 主渲染出口不一致, 需要同步 — 也是平行 commit, 记 TODO.

---

## Phase 2 入口

本 draft 定稿后进 Phase 2, 具体做:

1. 在 SNL-Basics/docs/.SNL_Doc/ 建工作区, `config.json` 里锁定上文 8 个 entry_kinds.
2. 起 `term_macros/snl-api.json`, 至少定义 `Signature` macro. 观察填 §1.3 的第一批 Function entry 时是否需要拆更细.
3. 起 `relationships` label 词汇表: `imports` / `stability`.

Phase 3 是逐条填 content, Phase 4 是拉 library graph (每 library 内部按 §1.x/§2.x/§3.x 分区做 outline branch).
