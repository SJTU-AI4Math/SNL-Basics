import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('parameterized SVG public examples', () => {
  it.each(['README.md', 'README(ZH).md'])('%s supplies the required settled-cache bound', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8')
    const examples = [...source.matchAll(/new SvgTemplateAssetRegistry\(\{([\s\S]*?)\n\}\)/g)]
    expect(examples).toHaveLength(1)
    expect(examples[0]?.[1]).toMatch(/\bmaxSettled\s*:\s*\d+\b/)
  })

  it.each([
    {
      file: 'README.md',
      recursiveNonBlock: /text and formula child subtrees[\s\S]{0,240}every recursively selected complete\s+`TemplateSpec`\s+descendant is non-block/i,
      recursiveBlockFallback: /any block descendant[\s\S]{0,180}visible\s+fallback[\s\S]{0,120}before\s+`renderChild`/i,
      unavailableCapability: /`childContainsBlock` capability\/resolver\s+is\s+unavailable[\s\S]{0,180}fails closed[\s\S]{0,100}visible\s+fallback/i,
      noRecursiveBoxes: /recursive[\s\S]{0,40}foreign boxes[\s\S]{0,100}(?:not\s+supported|unsupported)/i,
      fixedFormulaEmbedding: /formula_embed[\s\S]{0,800}fixed-metric/i,
    },
    {
      file: 'README(ZH).md',
      recursiveNonBlock: /text 与 formula 子树[\s\S]{0,240}递归选中的每个完整 `TemplateSpec` 后代[\s\S]{0,80}非 block/i,
      recursiveBlockFallback: /任何 block 后代[\s\S]{0,180}`renderChild` 之前[\s\S]{0,120}可见 fallback/i,
      unavailableCapability: /`childContainsBlock` capability\/resolver 不可用[\s\S]{0,180}fail closed[\s\S]{0,100}可见 fallback/i,
      noRecursiveBoxes: /递归[\s\S]{0,40}foreign box[\s\S]{0,100}不支持/i,
      fixedFormulaEmbedding: /formula_embed[\s\S]{0,800}固定 metric/i,
    },
    {
      file: 'docs/api.md',
      recursiveNonBlock: /text and formula child subtrees[\s\S]{0,240}every recursively selected complete\s+`TemplateSpec`\s+descendant is non-block/i,
      recursiveBlockFallback: /any block descendant[\s\S]{0,180}visible\s+fallback[\s\S]{0,120}before\s+`renderChild`/i,
      unavailableCapability: /`childContainsBlock` capability\/resolver\s+is\s+unavailable[\s\S]{0,180}fails closed[\s\S]{0,100}visible\s+fallback/i,
      noRecursiveBoxes: /recursive[\s\S]{0,40}foreign boxes[\s\S]{0,100}(?:not\s+supported|unsupported)/i,
      fixedFormulaEmbedding: /formula_embed[\s\S]{0,800}fixed-metric/i,
    },
  ])('$file documents recursive support and fail-closed boundaries', ({ file, ...claims }) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8')
    for (const claim of Object.values(claims)) expect(source).toMatch(claim)
    expect(source).not.toMatch(/(?:only|仅)\s+(?:a\s+)?direct (?:block-mode )?child/i)
  })
})
