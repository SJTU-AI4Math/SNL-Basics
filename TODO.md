# SNL-Basics TODO — 库表面精简（lightening）

> 本仓库定位是 SNL 语法树机制库。所有 Macro 数据都由 consumer 拥有，
> Basics 不附带 DB，也不通过 Macro 名字硬编码领域语义。

## 已确认的边界

- [x] 删除 `bundledMacroDb`、`./snl-macro-db.json` 包导出及 bundled DB。
- [x] 删除 `bundledSampleMacroDb`、sample JSON 与对应文档 Entry。
- [x] Bundled DB 不收录普通四则运算宏：`Add.add`、`Sub.sub`、
  `Mul.mul`、`DivRing.div`。


## 仍待处理

- [ ] 评估是否把 `SnlSyntaxTreeEditor` 从公共 barrel 移出，改为独立 UI 子包。
- [ ] 确认 `vite.lib.config.ts` 始终只 emit 库入口。
- [ ] 发布前再次核对 README、MIGRATION 与实际 package exports 一致。
