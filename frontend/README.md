# OperatorTree React Demo

一个轻量级的 React + TypeScript 示例，展示以下能力：

- 将 `a[b](c,d(e))` 语法解析为 `OperatorTree`
- 通过可插拔异步查询函数获取 LaTeX 模板
- 递归替换 `{{child0}}`、`{{child1}}` 占位符
- 使用 KaTeX 渲染 HTML
- 通过 GUI 编辑 `OperatorTree`

> 注：`mdata` 当前作为预留扩展字段，不参与 parser 语法与默认渲染流程。

## 目录结构

- `src/operator-tree/types.ts`: `OperatorTree` 类型与工具函数
- `src/operator-tree/parser.ts`: 递归下降 parser
- `src/operator-tree/query.ts`: 异步查询接口类型定义
- `src/operator-tree/template.ts`: 模板占位符替换
- `src/components/OperatorTreeKaTeXView.tsx`: 异步渲染组件
- `src/components/OperatorTreeEditor/OperatorTreeEditor.tsx`: GUI 编辑组件
- `src/App.tsx`: 示例串联（mock query + parser + editor + renderer）

## 语法约定

- `name[style](child1,child2(...))`
- `name`: 节点名
- `[style]`: 节点样式字符串
- `( ... )`: 子节点列表

示例：`a[frac](b,d(sum))`

说明：

- `[]` 映射到节点 `style`
- `()` 映射到节点 `children`
- 空子节点列表允许写成 `x[y]()`

## 模板占位符

查询函数返回 LaTeX 模板字符串，支持：

- `{{child0}}`, `{{child1}}`, ... 对应子节点递归计算出的 LaTeX
- `@CHILD1@`, `@CHILD2@`, ...（数据库模板常用写法）

例如：

- 模板：`\\frac{{child0}}{{child1}}`
- children: `x`, `y`
- 结果：`\\frac{x}{y}`

> 注：若模板中未出现某个占位符，替换阶段会忽略该 child；若占位符不存在对应值，默认替换为空字符串。

## 查询接口

`KaTeXTemplateQuery`:

```ts
type KaTeXTemplateQuery = (args: {
  name: string
  style: string
  node: OperatorTree
}) => Promise<string>
```

你可以替换 `App.tsx` 中的 mock query，接入自己的后端查询方式。

## 模拟数据库（JSON）

本 demo 使用 `public/katex-template-db.json` 作为模板库，推荐结构为：

- 第一层 key：语义名（如 `DivRing.div`）
- 第二层 key：渲染 style（如 `frac`）
- 值：`{ "latex": "..." }`
- 每个 style 记录：`{ "latex": "...", "childCount": number }`

示例：

```json
{
  "DivRing.div": {
    "frac": { "latex": "\\frac{@CHILD1@}{@CHILD2@}", "childCount": 2 }
  }
}
```

查询逻辑：

- 命中 `(name, style)` => 使用数据库模板
- 若未提供 `style`（没有 `[]`）=> 默认使用该 `name` 下的第一个 style
- 未命中 => 把 `name` 当临时符号渲染（会做基础转义，尽量避免 KaTeX 语法错误）

编辑器行为：

- 当输入 `name` 后命中数据库且 `style` 为空，会自动填充默认 style
- 编辑器会根据命中 style 的 `childCount` 自动补齐/裁剪子节点数量

## Demo 页面包含

- 左侧：`OperatorTree` GUI 编辑器
- 右侧：当前树结构（字符串 + 文本树示意图）
- 下方：生成的 KaTeX 源码（最终 LaTeX）与渲染结果

## 运行

```bash
npm install
npm run dev
```

测试与构建：

```bash
npm run test
npm run build
```
