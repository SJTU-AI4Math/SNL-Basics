# SNL-Basics TODO — 库表面精简（lightening）

> 立场：本仓库定位是**渲染库**（SNL 语法树 → KaTeX-in-React + hover 交互）。
> 除此之外的一切（具体宏数据、demo 网页、UI 编辑器控件）都不应出现在
> `@snl-basics/react` 的公开 API 表面上。
>
> 宏数据（macro packages）应作为**独立社区分发物**存在，不由本库携带。
> 未来 UI 模块（宏编辑器 / 语法树编辑器 / 条目编辑器）先在 downstream
> consumer（如 SNL-Doc-Extension/webview）里孵化，成熟稳定后再考虑
> 抽回来做成独立的 `@snl-basics/react-ui`（或类似）子包。

**状态：** 暂缓，提上日程。当前 downstream（SNL-Doc-Extension）已在
先行改造：把 preview 用的 `bundledMacroDb` 换成从项目
`.SNL_Doc/term_macros/` 动态合并的 DB。等 downstream 稳定后再回来动这里。

---

## 待办

### 1. 从库 API 表面移除三类"非渲染"东西

- [ ] **`SnlSyntaxTreeEditor` 从 `src/snl-react-view/index.ts` 拿掉 export**
  - 组件文件 `src/components/SnlSyntaxTreeEditor/*` 保留（demo `App.tsx`
    直接从相对路径 import），仅从公共 barrel 里去掉。
  - 现状：`index.ts` 底部注释已经写了
    "Optional demo editor (not part of the core library)"，但仍在 export
    列表里 — 名不副实。

- [ ] **`bundledMacroDb` / `bundledSampleMacroDb` 从公共 API 拿掉**
  - `src/snl-macro/bundled-db.ts` 保留（供 demo App 直接 import）。
  - `src/snl-react-view/index.ts` 拿掉这两个 export。
  - `package.json#exports` 拿掉 `"./snl-macro-db.json"` 和
    `"./snl-macro-db-samples.json"` 两个子路径。
  - `scripts/copy-lib-assets.mjs` 不再把 `public/*.json` 复制到 `dist-lib/`。
  - `public/*.json` 保留给 demo 本地 `npm run dev`，语义降级为 **sample data**。

- [ ] **确认 `vite.lib.config.ts` 只 emit 库入口**（已 OK：`entry: src/snl-react-view/index.ts`）。

### 2. README 重写

- [ ] 头部定位改成 "pure SNL syntax-tree render library"，删掉所有
  bundled DB accessor 的段落（`bundledMacroDb` / `bundledSampleMacroDb`）。
- [ ] **5-minute quickstart** 改用 `loadSnlMacroDb(url)` +
  consumer-owned DB；示例展示 consumer 自己维护 `.json` 文件的姿态。
- [ ] 新增章节 **"Macro packages live downstream"**：解释宏数据是社区
  分发物，本库不携带；指向 SNL-Doc-Extension 的 `.SNL_Doc/term_macros/`
  作为一个 consumer 端实践。
- [ ] "Offline / bundled usage" 那节整个删除（Offline 现在的正确姿势是
  consumer 自己 vendor JSON，跟本库无关）。
- [ ] "Output backends" 那节保留（现有描述已经正确：consumer-side concern）。

### 3. Demo 页调整（可选，跟 1/2 同时做更干净）

- [ ] `src/App.tsx`：从直接 import `bundledMacroDb` 改成
  `loadSnlMacroDb('/snl-macro-db.json')`（`public/` 已经 serve 它）。
- [ ] `src/main.tsx` 保持不变。
- [ ] 效果：demo 跟其他 consumer 走同一条路径，验证 API 表面。

### 4. Version bump 与 changelog

- [ ] BREAKING：这几个改动至少是 `0.7.0`（`bundledMacroDb` 从 `@snl-basics/react`
  的公开 API 消失是显然的 breaking change）。
- [ ] 在 `MIGRATION.md` 里加一节 `0.6.x → 0.7.0` 说明 downstream 迁移路径：
  - `import { bundledMacroDb } from '@snl-basics/react'` → vendor 自己的
    macro DB，或用 `loadSnlMacroDb(url)` 从项目路径拉。
  - `import { SnlSyntaxTreeEditor } from '@snl-basics/react'` → 目前唯一的
    在野 consumer 只有本 repo 自己的 demo，无外部影响；未来若有需要，
    抽到独立 `@snl-basics/react-ui`。

---

## 何时开工

**触发条件**（任一满足即可开：）

1. SNL-Doc-Extension 已完成从 `bundledMacroDb` 到项目 `term_macros/` 的切换，
   `@snl-basics/react` 的 `bundledMacroDb` 变成"没有活跃 consumer"的僵尸 export。
2. 有第二个 downstream consumer（社区 / 其他项目）明确表达了对
   "只想要渲染，不想要 Fulcrum 特定宏"的需求。
3. 决定发布 npm（现在还是 `"private": true`，发布前必须先精简 API 表面）。

**不要在** downstream 还在依赖 `bundledMacroDb` 时动手，否则 downstream 的
webview 会因为 API 消失当场炸掉。

---

_草拟：彩叶 🍂 · 2026-07-04_
