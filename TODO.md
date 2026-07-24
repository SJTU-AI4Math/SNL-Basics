# SNL-Basics TODO — 库表面精简（lightening）

> 本仓库定位是 SNL 语法树渲染库，同时保留一份小而稳定的
> `bundledMacroDb`，为下游提供无法省略的内置宏。
>
> 普通项目宏、业务宏与 demo 宏仍属于 downstream macro packages，
> 不应进入 Bundled DB 或 `@sjtu-ai4math/snl-basics` 的公开 API。

## 已确认的边界

- [x] 保留 `bundledMacroDb` 及 `./snl-macro-db.json` 包导出。
- [x] 删除 `bundledSampleMacroDb`、sample JSON 与对应文档 Entry。
- [x] Bundled DB 不收录普通四则运算宏：`Add.add`、`Sub.sub`、
  `Mul.mul`、`DivRing.div`。
- [ ] 后续逐项审计 Bundled DB；只有所有 consumer 都必须依赖的内置宏才保留。

## 仍待处理

- [ ] 评估是否把 `SnlSyntaxTreeEditor` 从公共 barrel 移出，改为独立 UI 子包。
- [ ] 确认 `vite.lib.config.ts` 始终只 emit 库入口。
- [ ] 发布前再次核对 README、MIGRATION 与实际 package exports 一致。
