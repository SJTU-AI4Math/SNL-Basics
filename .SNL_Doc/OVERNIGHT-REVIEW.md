# Iroha 夜班日志 — 2026-07-11 → 07-12

猫猫睡了 (~10:35 起), 我按你 Phase 2 + 3 的方向连做的一批, 醒来 review 用.

## 一句话结果

**Phase 2 术语化 + Phase 3 全量 SNL 化 都跑通了.** 73/73 条 entry 已从
`content.markdown` 迁到 `content.snl`, tryParseSnlSyntaxTree 全通,
snl-lint-entry `--strict-macros` 0 errors.

## Push 汇总 (按仓库时间线)

**SNL-Basics**:
- `dec25f1` — Phase 2 + Phase 3 first-pass. 新 `term_macros/api-doc.json`
  (18 个 macros, xcolor 命名颜色), 73 条 entry 全体 SNL 化.

**SNL-Agent-Toolkit**:
- `c24a64d` — `lint-package.ts` fix `\#` escape false-positive
  (blocked hex colors in templates). 加了 regression test, 46/46 pass.
- `dbb82de` — AGENT.md 补 Phase 1 clarification ("起稿" = 蓝图不是散文) +
  Phase 2 code-token rendering pattern (`\textcolor` + `\texttt` + dvipsnames).

## Phase 2 决策 (你 review)

### 10 个 entry_kinds (已锁, 之前定的)
NpmPackage / Module / Interface / Class / Field / Function /
ReactComponent / Property / Constant / Concept

### 18 个 macros (`api-doc` 包)

**Inline term refs** (formula_inline, 单参数,
render 为 `\textcolor{name}{\texttt{#0}}`):

| macro | color | 用途 |
|---|---|---|
| `api.iface` | Cerulean | TS interface / type alias |
| `api.class` | Teal | TS class |
| `api.field` | OliveGreen | Class 成员字段 |
| `api.fn` | Orange | 函数 / 方法 |
| `api.const` | Goldenrod | 导出常量 / 默认实现 |
| `api.prop` | RubineRed | React prop |
| `api.comp` | Magenta | React component |
| `api.mod` | RoyalBlue | 模块 / 命名空间 |
| `api.pkg` | Purple | npm 包 |
| `api.concept` | Gray | 横切概念 |
| `api.kw` | Gray | 小写通用词 (bvar/fvar/macro/parser/...) |
| `api.file` | MidnightBlue | 文件路径 |
| `api.code` | Black | 兜底 monospace |

**Connectors** (text mode, variadic): `api.slash` `api.plus`
`api.arrow` `api.list` — 按不同分隔符拼接 (`" / "` `" + "` `" → "` `"、"`).

**Structural** (每条 entry 的 SNL 根):
- `api.para` — text mode variadic, 子节点顺序拼接. 目前每条 entry 的
  SNL 都是 `api.para(...)` 单根.

### 命名 / 颜色决策记录

- **xcolor dvipsnames, 不用 hex.** `#` 撞 `fillLatexTemplate` 的 `#N`
  占位符; `\#` 转义在 render 时 work 但在 (old) linter 里失效. 直接
  绕开, 用 `Cerulean/Teal/...`. dvipsnames 在 light/dark theme 都清晰
  可辨.
- **kind = 'const' vs 'fvar'.** term-ref 类都设 kind='const', 意为
  "已解析的 API artefact"; `api.kw` 单独 kind='fvar' 表示"公共词汇不
  指向具体 entry". Palette 上 const 是绿色边框, fvar 是红色边框 —
  但因为我们用 `\textcolor` 硬覆盖了字体颜色, 边框仅在 SNL 结构
  hover 时可见.
- **structural macro 用 text mode 不用 block.** `block` mode 需要
  `react_renderer_key` 派发, 加一个 'paragraphs' renderer 是 SNL-Basics
  改动. text mode + `variadic_join=""` 就够用了.

## Phase 3 结果

### 重写流程 (机械, 幂等)

1. 建 title→macro 索引 (73 titles) + hand-picked 关键词表 (bvar / fvar /
   binder / macro / envMode / parser / ...) + 文件路径.
2. Left-to-right longest-match tokenize 每条 markdown.
3. 每个 token 要么变 `%text%` leaf, 要么 `api.X(%ident%)`; 用 `,`
   拼进 `api.para(...)`.
4. Prose 里的 `%` 转成全角 `％` (语料里罕见).

`content.markdown` **保留不动** — 万一 SNL 版本渲染不对, 删掉
`content.snl` 就掉回 markdown fallback (Extension `d3cbc38` 的
surface-priority).

### 验证
- **Parse**: 73/73 tryParseSnlSyntaxTree ok, 0 fail.
- **Lint** (strict-macros): 每条 entry 的每个 identifier 都能匹配
  registered macro, 0 error / 0 warn / 0 info.
- **Package lint**: `snl-lint-package api-doc.json` 0 issues.

### 已知 first-pass 局限 (欢迎 review)

1. **过度高亮.** Longest-match 是纯 lexical, prose 里出现 `template`
   一律 wrap 成 `api.kw(%template%)`, 有些地方读起来会 punchy 过头.
   人工 tuning 是接下来的活.
2. **Concept 交叉引用没做.** 4 条 entry 提到 Stable / Extension /
   Toolkit 名字, 应该链到对应 concept entry (`x@con.stability-stable`
   语法), 但机械 rewriter 处理不了 title 里带 em-dash 的 concept.
   全部当成普通 prose 处理了.
3. **`api.para` 单一 root.** 长条目 (max 260 chars) 其实需要分段, 但
   目前都是一段. 如果视觉上太挤, 要么加换行到 text run, 要么给
   `api.doc` 补一个 `paragraphs` React renderer.
4. **一个 idempotent 隐患.** 重跑 `/tmp/rewrite-entries.py` 会正常
   覆盖 (读 markdown → 生成 snl), 但如果你手改了 snl, 重跑会丢. 覆盖
   前记得备份 (或者把脚本改成 skip-when-snl-nonempty).

## 附带 sweep

- Toolkit `lint-package.ts` `\#` escape 处理修好了 (`c24a64d`), 顺
  手也给以后写 hex-color 模板的人减了个坑.
- AGENT.md 里 Phase 1 "起稿=蓝图不是散文" 的 clarification 固化.
- AGENT.md 里 Phase 2 加了 code-token rendering pattern (`\texttt` +
  `\textcolor` + dvipsnames) 参考实现 = 我今天写的 api-doc 包.

## 明天做 (等你 review 后拍板)

- **Concept 交叉引用** — 用 `x@con.stability-stable` 之类给
  stability / consumer 名字加 hover-jump.
- **Property props 扩充** — draft 里 §3.1 说 `SnlSyntaxTreeViewProps`
  可能有 8-10 个 props 但只列了 6 个占位, Phase 3 收尾时应对着源码
  interface 补齐.
- **library graph 结构化** — 目前 4 个 library 里所有 entry 都挂
  root 下扁平; Phase 4 restructure 成 Class → Field, ReactComponent →
  Property 的真实层级.
- **Extension `EntryData.tags` 字段** — 之前答应做的 tag schema 通道
  还没做. 今天没做因为它跟渲染路径没关, 属于纯 schema 迁移, 你能不
  能 review draft 先我再动.

## 睡醒 review 优先级建议

1. **打开 Dashboard**, 视觉扫 3 条 entry (随便挑 `st.fn.parse-snl-syntax-tree`
   / `rv.comp.snl-syntax-tree-view` / `mac.const.bundled-macro-db`),
   看颜色 + 字体 + 排版是不是你想要的效果.
2. 觉得颜色 OK 就 done; 觉得某类 kind 颜色不对, 告诉我调 dvipsname 即可.
3. 觉得 tokenizer 过度高亮, 具体指哪个词 / 哪种模式, 我改 rewriter
   然后重跑.

好, 我去休息模式了. 👋
