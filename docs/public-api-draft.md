# SNL-Basics 对外接口 — Phase 1 起稿

> **状态**: Phase 1 (起稿). 目标是把当前 `@snl-basics/react` 的公共 API 从"裸露所有 export"整理成一份带 stability 标签的清单, 为后续 Phase 2 (术语化) + SNL 化落库 (dogfood) 做输入.
>
> **审阅方式**: 猫 现场读, 有意见直接口头, 我改稿; 通过后进 Phase 2 提取 entry_kinds / macro_kinds.

---

## 0. 范围与前提

- **包名**: `@snl-basics/react`, 版本 0.7.0 (`package.json`, 目前 `"private": true`).
- **npm 分发面**: `dist-lib/index.js` + `dist-lib/index.d.ts` + `style.css` + 两份 macro-db JSON. 由 `package.json#files: ["dist-lib"]` 白名单锁死, tarball ~29 kB.
- **仓库源头**: `src/snl-react-view/index.ts` (`vite.config.ts` 的 lib build entry). 这份文件就是 API 的 single source of truth. 本文档把它规整.
- **两个下游 consumer** (真实 import 面, 2026-07-11 扫盘):
  - **SNL-Doc-Extension** (webview bundle): 通过 npm-alias `@snl-basics/react` import.
  - **SNL-Agent-Toolkit** (Node CLI): **绕过 npm 包**, 直接从 `external/SNL-Basics/src/snl-syntax-tree/*.ts` 深路径 import parser + types. React-bundled 的 npm entry 在 Node CLI 里跑不了.
- **对外 vs 内部**: 只要不在 `src/snl-react-view/index.ts` 里 re-export 的都是内部, 不受本文档约束. Toolkit 的深路径 import 走的是 **另一个对外表面** (纯 TS parser subset), 单列.

---

## 1. 对外表面的两个 tier

SNL-Basics 目前实际上服务两类消费者, 分两个 surface 讨论:

### Surface A — `@snl-basics/react` (npm entry, 浏览器/Webview 用)

React + KaTeX 依赖. 面向能跑 React 的宿主 (VS Code webview, 一般前端).

Re-export 自 `src/snl-react-view/index.ts`, 编译产物在 `dist-lib/index.js`.

### Surface B — Parser-only 深路径 (Node / CLI 用)

`external/SNL-Basics/src/snl-syntax-tree/{parser,types,annotate-bind,...}.ts`. 纯 TS, 无 React / KaTeX / DOM 依赖. **目前 Toolkit 通过 git submodule 深路径 import 消费**, 不走 npm.

需要决策 (见 §5): 要不要把这份也变成正式的 subpath export (比如 `@snl-basics/parser`), 让 Toolkit 换成 `import { parseSnlSyntaxTree } from '@snl-basics/parser'` 而不是深路径.

---

## 2. Surface A 分组 (按功能维度先分, stability 标签晚一步)

以下按语义分区列所有当前 export. **★** 标注 = SNL-Doc-Extension 里实际有 import 的 symbol (被验证过在用).

### 2.1 核心数据类型 (Core types)

- `SnlMacro` ★ — macro 的完整定义 (name, kind, styles[], source).
- `SnlMacroDb` ★ — `Record<string, SnlMacro>`, 整个 macro 池.
- `SnlMacroStyle` ★ — 单个 style 变体 (mode, template, react_renderer_key, ...).
- `SnlMacroSource` — macro 的来源引用 ({ entries[], urls[] }).
- `SnlSyntaxTree` ★ — 语法树节点主类型 (name, kind, children, mdata, envMode, style, scope).
- `SnlSyntaxTreeBase` / `SnlSyntaxTreeFormulaNode` / `SnlSyntaxTreeTextNode` / `SnlSyntaxTreeBlockNode` — envMode-区分的细分类型 (不常用, 但 re-export 了).
- `createSnlSyntaxTreeNode` — 工厂函数, 建一个默认字段填齐的节点.
- `isSnlSyntaxTree` — type guard.

### 2.2 Parser + Serializer

- `parseSnlSyntaxTree` ★ — 主 parser. throw on error.
- `tryParseSnlSyntaxTree` ★ — 非 throw 版, 返回 `{ ok: true, tree } | { ok: false, error }`.
- `SnlSyntaxTreeParseError` — parse 异常类.
- `serializeSnlSyntaxTree` ★ — tree → SNL 源码 (双向 roundtrip).
- `annotateBindings` — 独立的 annotate 步骤 (parser 已内嵌调用, 极少数场景需要单独跑, 比如子树重标).

### 2.3 Macro DB 加载 / 查询

- `bundledMacroDb` ★ — 内置的核心数学 macro DB.
- `bundledSampleMacroDb` — sample 示例 DB.
- `loadSnlMacroDb` — 从 URL 加载 macro DB.
- `DEFAULT_SNL_MACRO_DB_URL` — 内置 DB 的默认 URL.
- `setSnlMacroDbCache` / `clearSnlMacroDbCache` — DB 缓存控制.
- `createDefaultMacroTemplateQuery` — 从内置 DB 直接构建 template query.
- `createMacroTemplateQueryFromDb` ★ — 从传入 DB 构建 template query.
- `DefaultMacroTemplateQueryOptions` — 上面这俩的 options 类型.
- `SnlMacroTemplateQuery` ★ — template query 函数签名类型.
- `SnlMacroTemplateQueryArgs` — 上面的 args 类型.

### 2.4 Rendering (React 组件)

- `SnlSyntaxTreeView` ★ — **主渲染组件**. 输入 tree + macroDb + query + hooks, 输出 KaTeX-in-React.
- `SnlSyntaxTreeViewProps` — 上面的 props 类型.
- `SnlSyntaxTreeEditor` ★ — GUI 语法树编辑器 (Inductive 编辑). 现在被 CreateEntryApp 用作 SNL 输入的备选 UI.

### 2.5 Hooks / Renderer 定制

- `defaultRenderHooks` ★ — hooks 默认实现 (onHover / resolveMacroInfo / resolveSource / ...).
- `defaultHighlightStrategy` — 默认 bvar-scope 高亮策略.
- `defaultRenderers` — 默认的 block renderer 注册表 (list / enumerate / matrix / ...).
- `HTMLDATA_KATEX_DEFAULTS` — KaTeX `\htmlData` 允许属性名的默认白名单.
- `SnlRenderHooks` ★ — hooks 接口.
- `SnlHoverEvent` — hover 事件 payload.
- `SnlMacroInfo` — tooltip 里显示的 macro 说明.
- `SnlResolvedSource` — source 解析后的形态.
- `SnlTooltipState` — 悬浮提示内部状态类型.
- `SnlHighlightStrategy` / `SnlHighlightSet` — 高亮策略接口.
- `SnlRendererRegistry` — block-renderer 注册表类型.
- `SnlBlockRenderer` — 单个 block renderer 类型.
- `SnlBlockRendererProps` — block renderer 的 props.

### 2.6 Palette (kind 配色)

- `DEFAULT_KIND_PALETTE` — 内置 kind 配色 (bvar 紫 / fvar 红 / rule 绿 / ...).
- `alpha` — 颜色 alpha helper.
- `paletteToCss` — palette → CSS 字符串.
- `assertSafeKindName` — kind 名合法性校验.
- `KindColoring` — 单个 kind 的配色 ({ stroke, background }).
- `KindPalette` ★ — 整份 palette 类型.

### 2.7 Advanced / low-level

- `fillLatexTemplate` — template `#N` / `#*` 填充工具 (下游偶尔用).

### 2.8 副产物

- `import '@snl-basics/react/style.css'` ★ — 组件必需的 CSS.
- `snl-macro-db.json` / `snl-macro-db-samples.json` — 通过 `exports` map 暴露, 极少直接被 import.

---

## 3. 实际下游 import 面 (证据)

扫盘结果 (2026-07-11):

### SNL-Doc-Extension (通过 `@snl-basics/react`, 8 处 import 站点)

真实用到的 symbol union:

- `parseSnlSyntaxTree`, `tryParseSnlSyntaxTree`, `serializeSnlSyntaxTree`, `createSnlSyntaxTreeNode`
- `createMacroTemplateQueryFromDb`, `defaultRenderHooks`, `bundledMacroDb`
- `SnlSyntaxTreeView`, `SnlSyntaxTreeEditor`
- Types: `SnlMacro`, `SnlMacroDb`, `SnlMacroStyle`, `SnlSyntaxTree`, `SnlMacroTemplateQuery`, `SnlRenderHooks`, `KindPalette`
- CSS: `@snl-basics/react/style.css`

约 15 个 symbol + CSS import. **没被 import 的** (从 §2 列表里减去): `SnlMacroSource`, `SnlSyntaxTreeBase/Formula/Text/BlockNode`, `isSnlSyntaxTree`, `annotateBindings`, `bundledSampleMacroDb`, `loadSnlMacroDb`, `DEFAULT_SNL_MACRO_DB_URL`, `setSnlMacroDbCache`, `clearSnlMacroDbCache`, `createDefaultMacroTemplateQuery`, `DefaultMacroTemplateQueryOptions`, `SnlMacroTemplateQueryArgs`, `defaultHighlightStrategy`, `defaultRenderers`, `HTMLDATA_KATEX_DEFAULTS`, `SnlHoverEvent`, `SnlMacroInfo`, `SnlResolvedSource`, `SnlTooltipState`, `SnlHighlightStrategy`, `SnlHighlightSet`, `SnlRendererRegistry`, `SnlBlockRenderer`, `SnlBlockRendererProps`, `DEFAULT_KIND_PALETTE`, `alpha`, `paletteToCss`, `assertSafeKindName`, `KindColoring`, `fillLatexTemplate`, `SnlSyntaxTreeViewProps`.

### SNL-Agent-Toolkit (深路径, 完全绕过 npm entry)

`lib/snl-parser.ts` 一个文件, 只 import 3 个:

- `parseSnlSyntaxTree` (来自 `external/SNL-Basics/src/snl-syntax-tree/parser.ts`)
- `SnlSyntaxTreeParseError` (同上)
- `SnlSyntaxTree` type (来自 `.../snl-syntax-tree/types.ts`)

**含义**: parser + types 有一份天然的"最小 Node-safe subset"事实边界. 目前作为深路径 import 存在, 是 §5 subpath-export 决策的候选面.

---

## 4. Stability 提议 (待猫拍板)

给每个 §2 里的 symbol 打一个 stability 标签. 提议三档:

- **Stable**: 语义 + 签名冻结, 变更走 semver-major.
- **Experimental**: 对外可用但保留改动权, 变更只在 minor 里公告.
- **Internal**: 编译产物里意外泄漏, 不承诺任何兼容. 下一次 minor 可以从 `index.ts` 撤掉.

我的**初始提议** (强意见, 猫可推翻):

### Stable

Extension 已经在用的 15 个符号, 加 CSS import. 见 §3 上半部分那份 union.

具体列举:
`SnlMacro`, `SnlMacroDb`, `SnlMacroStyle`, `SnlSyntaxTree`, `SnlMacroTemplateQuery`, `SnlRenderHooks`, `KindPalette`, `parseSnlSyntaxTree`, `tryParseSnlSyntaxTree`, `serializeSnlSyntaxTree`, `createSnlSyntaxTreeNode`, `createMacroTemplateQueryFromDb`, `defaultRenderHooks`, `bundledMacroDb`, `SnlSyntaxTreeView`, `SnlSyntaxTreeEditor`, `@snl-basics/react/style.css`.

### Experimental

明显是给下游"高级用法"预留但目前没被消费的, 暂定 Experimental (给未来六个月观察窗口):

`SnlSyntaxTreeViewProps`, `SnlMacroSource`, `defaultRenderers`, `defaultHighlightStrategy`, `SnlBlockRenderer`, `SnlBlockRendererProps`, `SnlRendererRegistry`, `SnlHighlightStrategy`, `SnlHighlightSet`, `SnlHoverEvent`, `SnlMacroInfo`, `SnlResolvedSource`, `DEFAULT_KIND_PALETTE`, `paletteToCss`, `alpha`, `KindColoring`, `fillLatexTemplate`, `annotateBindings`, `HTMLDATA_KATEX_DEFAULTS`.

### Internal (提议从 `index.ts` 撤掉)

看起来是实现细节, 现在也没人用:

`isSnlSyntaxTree`, `SnlSyntaxTreeBase`, `SnlSyntaxTreeFormulaNode`, `SnlSyntaxTreeTextNode`, `SnlSyntaxTreeBlockNode`, `SnlTooltipState`, `bundledSampleMacroDb`, `loadSnlMacroDb`, `DEFAULT_SNL_MACRO_DB_URL`, `setSnlMacroDbCache`, `clearSnlMacroDbCache`, `createDefaultMacroTemplateQuery`, `DefaultMacroTemplateQueryOptions`, `SnlMacroTemplateQueryArgs`, `assertSafeKindName`.

**风险**: 撤掉 Internal 是 breaking change. 如果任何一个我看漏了, 需要保留. 猫扫一下.

---

## 5. Surface B 的问题 — Toolkit 深路径 import 该正规化吗?

**现状**: Toolkit `lib/snl-parser.ts` 走的是 `../external/SNL-Basics/src/snl-syntax-tree/{parser,types}.ts`. 这依赖 git submodule 的物理路径, 不经过 npm.

**痛点**:

- Toolkit 独立发布时会带上整份 SNL-Basics 源码 (虽然通过 submodule 是链接的, tarball 会怎么处理待验证).
- 深路径 = SNL-Basics 的 `src/snl-syntax-tree/` 内部结构变了, Toolkit 就断.
- Toolkit 自己在文件顶注释里写了: "Kept as a wrapper so the rest of the toolkit imports from a stable local path; if SNL-Basics ever ships an npm package we swap this file's imports and everything downstream stays put." — 已经预留了迁移接口.

**候选方案**:

- **(a) 什么都不做**: 保留深路径 import + submodule pin. 优点: 零工作. 缺点: 内部重构 SNL-Basics 就有可能砸 Toolkit; 独立发布 Toolkit 时的 tarball 边界不清.
- **(b) 加一个 subpath export `@snl-basics/parser`** (或者叫 `@snl-basics/react/parser`): 在 `package.json#exports` 里加一条, 指向一个新的 lib build entry (纯 parser + types, 无 React). Toolkit 改成 `import { parseSnlSyntaxTree } from '@snl-basics/parser'`.
  - 好处: Toolkit 摆脱 submodule, 走 npm.
  - 代价: 多一个 vite lib build target, 多一份 `dist-lib/parser.{js,d.ts}` 产物; SNL-Basics 需要真的发上 npm (目前 `"private": true`).
- **(c) 拆包**: SNL-Basics 拆成两个 npm 包 `@snl-basics/core` + `@snl-basics/react`. 最干净但工作量最大, 短期不做.

**我倾向**: 短期 (a), 中期 (b) 一起解决 Toolkit 独立发布 + 内部重构不砸下游两件事. 但这依赖 SNL-Basics 走 public npm 的时间表. 猫定.

---

## 6. 下一步 (Phase 2 预告)

一旦本文档定稿, Phase 2 会做:

1. 把 §2 的分区 → `entry_kinds` (`Symbol` / `TypeAlias` / `Interface` / `ReactComponent` / `Concept` / `Module` 之类).
2. 把 stability 标签 → `macro_kinds` (`Stable` / `Experimental` / `Internal` 三个 tag macro).
3. 把 "被谁 import" → 独立的 macro (`ImportedBy(consumer)` 之类) 或 relationships.json 边.
4. `.SNL_Doc/` 建在 `SNL-Basics/docs/.SNL_Doc/` (`package.json#files` 白名单已确认不会打进 tarball).
5. 顺带把 Toolkit 的 AGENT.md 里"Phase 2 术语化 → 一份 pre-authoring 术语审计"这一环用真实经验丰富.

---

## 7. 已知遗漏 / 待补 (给猫读时 poke 用)

- 每个 symbol 的**签名**没列 — 有必要吗? 目前是"分组 + 名字", 后续 Phase 3 (Entry Prefabrication) 就每一项各建一个 entry 承载签名 + 说明 + 用法示例. 现在写不写取决于猫想不想在这一稿里 review 签名细节.
- **版本策略** — 什么算 breaking, 什么算 non-breaking, 现在没写死. 依赖是否真发 npm 的决策.
- **KaTeX / React 版本约束** — 目前 peerDependencies 只写了 katex + react. 需不需要在 API doc 里显式说 "supported React >= 18, KaTeX >= 0.16" 之类, 待定.
- **`react_renderer_key` 的枚举** — block renderer 的可选 key ("list", "enumerate", "matrix", ...) 是 API 一部分吗? 目前是 macro-db 内容 + `defaultRenderers` 注册, 没在类型里 encode. 讨论过一次 "small enum → dropdown with named presets" — 是不是 API 里应该有个 `BuiltInBlockRendererKey` union 类型.
