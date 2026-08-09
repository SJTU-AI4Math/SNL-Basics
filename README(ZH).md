# SNL-Basics

**v0.2.0 · MIT License · Beta** — [English README](README.md)

结构化自然语言（Structured Natural Language, SNL）基础库 —— 将宏 DSL 解析为语法树，
并渲染为带悬停交互的 KaTeX-in-React。

输出后端（Typst / LaTeX / Markdown / 纯文本）属于**使用方的关注点**，位于下游扩展中
（例如 SNL-Doc-Extension），不属于这个只负责渲染的库。

设计目标：**接口简洁清晰 · 高度模块化 · 深度可定制。** 每一处交互（tooltip、悬停高亮、
来源解析、块级渲染）都可以通过单一的 `hooks` prop 覆盖。

---

## ⚠️ 依赖 SNL-Basics 之前请先读这一节

### Beta 阶段 —— `1.0.0` 之前不承诺 Schema 稳定

所有 `0.x` 版本都是 **beta** 版本，可能包含对 API **以及**序列化数据 schema
（语法树文档与宏数据库）的破坏性变更。

对于每一次破坏性变更，我们承诺提供以下**维护手段**：

- **Deprecation（弃用）声明** —— 被移除的接口会在移除它的那个版本中明确声明；在可行的
  情况下会先保留一个 minor 版本并带上标注移除版本号的弃用标记。
- **数据迁移函数** —— 每一次序列化 schema 的破坏性变更都会附带可运行的迁移脚本
  （`scripts/migrate-*.mjs`，以及可编程调用的 `migrateMacroDocument` /
  `migrateSyntaxTreeDocument`），并在 [MIGRATION.md](MIGRATION.md) 中留下记录。

我们明确地**不承诺** `1.0.0` 之前的 schema 稳定性。迁移函数是我们对"破坏性变更可被
安全跨越"的承诺，而不是"不会发生破坏性变更"的承诺。第一个冻结 schema 的版本是 `1.0.0`。

### 本项目由 AI 完成，接口尚未经过人工整理

SNL-Basics 由 **Claude Opus + 基于 ChatGPT 的 Hermes Agent 通过 vibe coding** 完成。
其公开接口**尚未经过人工的设计审查**。具体来说：

- 命名、参数形态、模块边界**未必高效或合理**，其中一部分是历史遗留的产物。
- 在通往 `1.0.0` 的路上，我们预期会**大幅重构接口**。

**因此：如果你是古法编程（手工写代码）的开发者，我们目前不建议你依赖本库。**
未来的接口整理很可能会让大量精心手写的集成代码作废。如果你现在就要用，我们建议把集成层
写得尽量薄、尽量可自动生成、或者尽量易于重新生成，并锁定精确版本号。

需要说明的是，本库本身有**完整的自动化测试套件**，并已在 SNL-Doc-Extension 中
投入实际使用。上面的警告针对的是接口的*稳定性与设计品味*，而不是正确性。

---

## 可运行的示例

[`examples/basic-demo`](examples/basic-demo) 是一个自包含的 Vite + React 本地集成应用。
它通过 `file:../..` 链接仓库根包，只从公开包入口导入，并完整走
`EntryPreviewProvider` + `EntrySurface` 的 Entry 渲染路径。生命周期脚本会自动安装
缺失的根构建依赖并重建 `dist-lib`，fresh clone 不需要预先生成 tarball。

```bash
cd examples/basic-demo
npm install                        # 自动准备并构建本地根包
npm run dev                        # 或者：npm run build
```

它演示实时 SNL 编辑、Entry 渲染、由 Macro source 触发的递归 Entry 浮窗、点击 pin
以及点击空白处清除。序列化语法树和 outline 仅作为 Parser 诊断，不参与渲染或悬浮。

发布 tarball 的兼容性由独立的 clean-consumer 发布门禁验证；这个 source-linked demo
是本地参考集成，不能作为 npm 已发布字节的证据。

## 功能与接口一览

| 领域 | 提供的能力 | 入口 |
|---|---|---|
| **解析** | SNL 源码 → 语法树，含不抛异常的变体与带类型的错误 | `parseSnlSyntaxTree`、`tryParseSnlSyntaxTree`、`SnlSyntaxTreeParseError` |
| **序列化** | 语法树 → Parser 可读的源码（可 round-trip，含 `[style]`） | `serializeSnlSyntaxTree`、`SnlDslFormatter` |
| **绑定分析** | 推断 binder / 约束变量 / 自由变量的 kind，供悬停使用 | `annotateBindings` |
| **渲染** | 语法树 → KaTeX-in-React，自动注入 `\htmlData` 悬停元数据 | `SnlSyntaxTreeView` |
| **宏数据** | 只读查询的数据层，带 LRU 缓存与并发请求去重 | `MacroDataDriver`、`MacroDataQueries` |
| **交互** | 可注入的 hover / leave / click / ctrl-click 驱动，及树路径 | `SnlInteractionDriver`、`encodeTreePath`、`resolveTreePath` |
| **定制** | 覆盖 tooltip、悬停、来源解析、高亮策略、块渲染器 | `SnlRenderHooks`、`defaultRenderHooks`、`defaultRenderers` |
| **主题** | kind → 配色调色板，及 CSS 生成 | `DEFAULT_KIND_PALETTE`、`paletteToCss` |
| **运行时注入** | 通过 Reader monad 注入语言/主题/偏好，不假设宿主环境 | `ReaderRuntime`、`ReaderM` |
| **浮层** | 可递归的悬停浮层栈，带视口边界钳制 | `HoverPopoverProvider`、`useHoverPopovers` |
| **Entry 卡片**（子路径） | 完整的 Entry 渲染器 —— SNL / Markdown / LaTeX / 文本正文 | `@sjtu-ai4math/snl-basics/entry` |
| **Schema 迁移** | 可编程调用 + CLI 的跨 schema 版本迁移 | `migrateMacroDocument`、`scripts/migrate-schema.mjs` |

除 Entry 渲染器外，以上全部从包根导出。Entry 渲染器位于可 tree-shake 的 `/entry`
子路径下，这样包根永远不会引入 Markdown 依赖链。

## 安装

```bash
npm i @sjtu-ai4math/snl-basics katex react react-dom
```

`react`、`react-dom` 与 `katex` 是 **peerDependencies** —— 本库绝不打包自己的副本
（参见[打包](#打包vite--webpack)）。

引入一次样式表（KaTeX + SNL 的悬停/块级样式）：

```ts
import 'katex/dist/katex.min.css'
import '@sjtu-ai4math/snl-basics/style.css'
```

## 5 分钟上手

创建一个只读查询的 `MacroDataDriver`，解析表达式，然后渲染：

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

// 你自己的宏定义（也可以从服务器或文件读取）
import macroDb from './my-macros.json'

export function Demo() {
  // 1. 创建 MacroDataDriver —— View 唯一的只读数据源。
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

  // 2. 解析 SNL 源码，然后标注 binder / 约束变量以支持悬停。
  const tree: SnlSyntaxTree = useMemo(() => {
    const t = parseSnlSyntaxTree('quantifier(@x, equals(x, x))')
    annotateBindings(t)
    return t
  }, [])

  // 3. 渲染。启用悬停所需的 KaTeX 选项已默认应用（见下文）。
  return (
    <SnlSyntaxTreeView
      tree={tree}
      macro_data_driver={driver}
      katexOptions={{ displayMode: true }}
    />
  )
}
```

对于异步/远程后端，直接实现 `MacroDataQueries`：

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

## 可选的完整 Entry 渲染器

完整的 Entry 卡片仅通过可 tree-shake 的 `@sjtu-ai4math/snl-basics/entry` 子路径提供。
包根不会引入它的 Markdown 依赖。

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

该渲染器按 SNL、Markdown、LaTeX、纯文本的顺序选取第一个非空正文，处理空卡片/错误卡片与
标题公式，查询上下文绑定的来源，并支持递归的宏来源预览。存储、指针与宿主动作仍然是注入的
适配器。详见 [Generic Entry rendering](docs/entry-rendering.md)。

### KaTeX 选项 —— 按命令限定的信任策略

`SnlSyntaxTreeView` 使用一个 KaTeX trust 回调，只允许 `\htmlData`（悬停元数据）与
`\htmlClass`（占位符样式）。URL、图片、元素 ID 与内联样式类命令一律拒绝，包括 `\href`、
`\url`、`\includegraphics`、`\htmlId` 和 `\htmlStyle`。

传入 `trust: false` 会禁用悬停所需的 HTML 扩展并静默地破坏悬停功能。传入 `trust: true`
会替换掉这个按命令限定的策略并启用全部受 trust 门控的 KaTeX 命令 —— 只有在输入完全可信时
才这么做。

如果你为自定义块渲染器直接调用 `katex.renderToString`，请导入并展开同一份预设，让输出保留
悬停钩子：

```tsx
import katex from 'katex'
import { HTMLDATA_KATEX_DEFAULTS } from '@sjtu-ai4math/snl-basics'

katex.renderToString(latex, { throwOnError: false, ...HTMLDATA_KATEX_DEFAULTS })
```

## 消费者自有的 Macro 数据

SNL-Basics 不附带 Macro 数据库。应用自行拥有 Macro 记录，并通过
`MacroDataDriver` 暴露查询；底层可以是内存对象、workspace 文件或远程服务：

```tsx
import { MacroDataDriver, parseSnlSyntaxTree } from '@sjtu-ai4math/snl-basics'

const macros = {} // 消费者自有的 Record<string, SnlMacro>
const driver = new MacroDataDriver({
  queries: {
    async query_macro({ macro_name }) {
      return macros[macro_name] ?? null
    },
  },
})
const tree = parseSnlSyntaxTree('群.示例(@x, x)')
```

## 打包（Vite / webpack）

`@sjtu-ai4math/snl-basics` 将 `react` 与 `react-dom` 列为 **peerDependencies**
（绝不是 `dependencies`），因此它不会携带自己嵌套的 React 副本。如果你的打包器仍然复制了
React（运行时会看到 **"Invalid hook call"**），请去重：

```js
// vite.config.ts
export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom', 'react/jsx-runtime'] },
})
```

这是所有导出 React 组件的库的通用做法，并非 SNL 特有 —— 但这个解决办法很容易被忽略。

## 宏命名约定

普通 Macro/Style 标识符保留既有 ASCII 白名单（`A-Z`、`a-z`、`0-9`、`_`、
首位 `\\` 以及后续的 `.`/`-`），同时允许可见的非 ASCII Unicode，例如
`群.是群`、`Ελληνικά.Ομάδα`、`Théorie.groupe`。其他 ASCII 标点因承载 SNL 语法而
继续禁止；Unicode 空白、控制字符、格式控制字符（含零宽/Bidi 控制）和孤立 UTF-16
代理项同样会被拒绝。当点缀后缀确实标识了一个不同的宏
（例如 arity 不同）时，它就是该宏身份的一部分：`quantifier` 与 `quantifier.typed`
（2 个 vs. 3 个子节点）。*保持相同 arity 的渲染变体*属于 **style**，而不是不同的宏 —— 见下节。

## Style 与 `[style]` 方括号

一个宏声明一个或多个以 `style_name` 为键的渲染 **style**。`styles[0]` 是唯一隐式默认 style。
一个宏的所有 style **必须接受相同的 arity** —— style 只改变渲染输出，绝不改变子节点数量。
正是这条不变量保证了切换 style 永远是安全的：

```
node := IDENT ('[' IDENT ']')? ('(' args ')')?
```

可选的 `[style]` 方括号用于显式选定 style，并且永远优先。不写时使用 `styles[0]`。语言只解析所选 text style 内部的本地化 template，不会切换 style。

```ts
parseSnlSyntaxTree('Pow.pow(x, 2)')          // styles[0]
parseSnlSyntaxTree('operator[double](a, b)')     // 'double' style → a \Rightarrow b
```

选中的标签会暴露在节点的 `node.style_name` 上，并且（当它是显式写出的时）作为
`data-style="<tag>"` 输出到渲染元素上。未知的标签是渲染错误。

`serializeSnlSyntaxTree` 会保留显式的 style 方括号，因此 parse → serialize 是
round-trip 闭合的。

## 核心概念

- **Macro（宏）** —— 一个具名的渲染器。顶层字段为 `name`、`description`、`source`、
  可选的 `kind`、`dynamic_arity`，以及一个有序 `styles` 数组（`styles[0]` 是隐式默认）。
  使用方自有的输出策略（`typst` / `latex` / `markdown` / `text`）位于下游。字段与语义定义在
  [`src/snl-macro/types.ts`](src/snl-macro/types.ts)：

  ```ts
  const macro: SnlMacro = {
    name: 'operator',
    description: '…',
    source: { entries: [], urls: [] },
    dynamic_arity: false,
    tags: [],
    styles: [
      { style_name: 'prose', mode: 'text', template: { type: 'i18n', default_language: 'en', values: { en: '#0 implies #1', 'zh-CN': '#0 蕴含 #1' } }, tags: [] },
      { style_name: 'double', mode: 'formula_inline', template: '#0 \\Rightarrow #1', tags: [] },
    ],
  }
  ```

  formula 与 block style 的 template 是语言无关字符串；`text` style 的 template 可以是字符串或 `I18n`。语言在同一个 style 内解析 projection，不改变 `style_name`。

- **Kind** —— 单一语义标签。Basics 只有 `sub`、`binder`、`bvar`、`fvar`
  四种内置特殊行为；其他 Entry Kind 保留原始标签用于外观，但行为均等同 `const`。
  持久 Macro 只使用 `const | sub`。临时根节点默认是无 metadata 的 `sub`；
  未命中 Macro 的名称经语义解析后成为 `fvar`。
- **Syntax tree（语法树）** —— 解析后的表示
  （`{ macro_name, style_name?, kind, mdata, children }`）。渲染时每个节点按其 style 的
  `mode` 分派：`formula_inline`/`formula_display`（KaTeX）、`text`（`<span>`）、
  或 `block`（通过 `block_template_name` 注册的块渲染器）。
- **MacroDataDriver** —— View 与宏数据之间唯一的只读查询数据访问层。提供
  `query_macro({macro_name})`，带有限容量的 LRU 缓存与并发去重。用
  `new MacroDataDriver({ queries })` 创建，其中 queries 实现 `MacroDataQueries`；
  存储与传输适配留在使用方。
- **ReaderRuntime / ReaderM** —— 语言、主题、动效、偏好以及一切使用方自有运行时依赖的
  标准做法。纯计算是 Reader；由 query 初始化的 `ReaderRuntime` 提供新鲜的环境，使 Basics
  不必假设 VS Code、浏览器全局对象、文件系统或任何其他后端。见
  [Query-injected runtime standard](docs/query-injected-runtime.md)。
- **Hooks** —— 每一处交互都可通过 `SnlRenderHooks` 定制：提供你自己的 `renderTooltip`、
  `onHover` / `onHover1s` / `onHover2s` / `onLeave`、`resolveMacroInfo`、`resolveSource`、`highlightStrategy`
  或 `renderers`。任何你省略的项都会回退到 `defaultRenderHooks`。
- **Arity 与占位符** —— 固定 arity 的宏使用 `#0`、`#1`、…；可变 arity 的宏使用 `#*`
  并以 `separator` 连接（例如 `pmatrix` / `matrix.row`）。见 [模板 DSL](#模板-dsl)。

### 模板 DSL

模板使用 LaTeX 原生的宏参数语法：

- `#0` / `#1` / … —— 0 起始索引的子节点（固定 arity 的宏）
- `#*` —— 连接全部子节点（`dynamic_arity` 宏，使用 `separator` 字符串）
- `\#` —— 字面量 `#`（在 KaTeX 中渲染为 `#`）

`\htmlData` 由 View 层自动添加 —— **不要**在模板里自己写。每个节点都会被包裹为
`\htmlData{name=<macro>,kind=<node.kind>[,style=<tag>][,tree-path=<path>]}{...}`，
因此悬停交互零样板代码即可工作。

## 定制示例

### 自定义 tooltip

默认交互时序：

- 立即悬浮：只高亮；
- 在同一节点悬浮 1 秒：打开浮窗；
- 悬浮 2 秒：锁定浮窗（`state.locked === true`）；
- 点击：立即打开并锁定浮窗。

`onHover`、`onHover1s`、`onHover2s` 是三个独立、可分别覆盖的 hook。指针在阈值前离开
会取消尚未触发的 hook。锁定后的浮窗在指针离开后继续显示，并忽略后续悬浮移动，直到点击另一节点。
三个阶段收到同一个 `event.session`：稳定的 `session.id` 标识本次连续悬浮生命周期，
`session.data` Map 是正式的跨阶段通讯通道：

```ts
const hooks: SnlRenderHooks = {
  onHover1s: (event) => event.session.data.set('popover', openPopover(event)),
  onHover2s: (event) => {
    const popover = event.session.data.get('popover') as Popover | undefined
    popover?.lock()
  },
}
```

切换节点或整棵 tree 会建立新 session 并取消旧阶段。consumer hook 即使抛错，也不会打断默认的显示/锁定状态机。

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

### 完全禁用 tooltip

`renderTooltip` 返回 `null` 会在保留悬停高亮的同时抑制 tooltip：

```tsx
import { defaultRenderHooks, type SnlRenderHooks } from '@sjtu-ai4math/snl-basics'

const hooks: SnlRenderHooks = { ...defaultRenderHooks, renderTooltip: () => null }
```

### 自定义来源解析器（entry id → 本地池，URL 兜底）

`resolveSource` 是**同步**的 —— 做本地查找（entry 池、Map 之类）并返回
`SnlResolvedSource` 或 `null`。`source` 参数是导出的 `SnlMacroSource`
（`{ entries: string[]; urls: string[] }`）：

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

### 将悬停转发给宿主（例如 VS Code webview 消息）

`onHover` 是**发出即不管**的（不会被 await）—— 非常适合宿主侧的日志或消息传递：

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

### 自定义块渲染器

以解析出的 style 的 `block_template_name` 为键注册渲染器。展开 `defaultRenderers`
以保留内置的 `list` / `table` / `centered` 渲染器：

```tsx
import { defaultRenderers, type SnlBlockRenderer } from '@sjtu-ai4math/snl-basics'

// 宏数据库条目（v7 形态）：
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

## 输出后端

输出后端（Typst / LaTeX / Markdown / 纯文本）属于**使用方的关注点**，已不再是本库的一部分
（在 0.4.0 中移除）。`SnlMacro` 现在只携带渲染字段（`name`、`description`、`source`、
`dynamic_arity`、`tags`、`styles`）。需要输出这些格式的下游扩展自行拥有其扩展后的宏形态
（带 per-style 后端）与转换代码（参见 SNL-Doc-Extension）。

## API 参考

完整的公开接口就是
[`src/snl-react-view/index.ts`](src/snl-react-view/index.ts) 中分组的 barrel。
每个导出的完整 TypeScript 声明 —— props、hooks、类型以及 `MacroDataDriver` 类 —— 发布在
[`dist-lib/index.d.ts`](dist-lib/index.d.ts)，也就是你在
`import type { … } from '@sjtu-ai4math/snl-basics'` 时编辑器解析到的内容。

## 开发

```bash
npm install
npm run build:lib   # 产出 dist-lib/（JS + 类型 + style.css + 核心宏数据库）
npm test            # vitest —— 300 个测试
npm run dev         # 交互式 demo（src/App.tsx）
npm pack            # 产出可发布的 tarball
```

## 版本与许可证

- **版本：** `0.2.0`（beta —— 见 [beta 说明](#beta-阶段--100-之前不承诺-schema-稳定)）
- **许可证：** [MIT](LICENSE)
