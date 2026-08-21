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
      sparseRepeated: /indices may be omitted or repeated/i,
      omittedPlacement: /omitted index[\s\S]{0,100}no visual placement/i,
      outOfRange: /(?:an? )?index outside the actual child array[\s\S]{0,80}fails\s+closed/i,
      blockChildren: /text, formula, and block\s+child subtrees[\s\S]{0,160}`renderChild` path/i,
      placementAuthority: /same semantic child identity[\s\S]{0,140}independent foreign-box authority/i,
      fixedFormulaEmbedding: /formula_embed[\s\S]{0,800}fixed-metric/i,
    },
    {
      file: 'README(ZH).md',
      sparseRepeated: /索引可以缺失或重复/i,
      omittedPlacement: /缺失索引[\s\S]{0,100}没有视觉落点/i,
      outOfRange: /超出实际 child 数组范围[\s\S]{0,100}fail\s+closed/i,
      blockChildren: /text、formula 与 block 子树[\s\S]{0,100}普通 `renderChild`/i,
      placementAuthority: /共享同一语义 child[\s\S]{0,140}独立的 foreign-box placement authority/i,
      fixedFormulaEmbedding: /formula_embed[\s\S]{0,800}固定 metric/i,
    },
    {
      file: 'docs/api.md',
      sparseRepeated: /slot indices[\s\S]{0,80}sparse or repeated/i,
      omittedPlacement: /omitted children[\s\S]{0,80}no visual placement/i,
      outOfRange: /(?:an? )?index outside the actual child array[\s\S]{0,80}rejected/i,
      blockChildren: /text, formula, and block\s+child subtrees[\s\S]{0,160}`renderChild` path/i,
      placementAuthority: /one semantic child identity[\s\S]{0,140}independent foreign-box authority/i,
      fixedFormulaEmbedding: /formula_embed[\s\S]{0,800}fixed-metric/i,
    },
  ])('$file documents sparse/repeated slots and block-child projection', ({ file, ...claims }) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8')
    for (const claim of Object.values(claims)) expect(source).toMatch(claim)
    expect(source).not.toMatch(/SVG accepts only a contiguous|恰好连续的空/)
    expect(source).not.toMatch(/Any block descendant triggers|任何 block 后代都会/)
  })
})
