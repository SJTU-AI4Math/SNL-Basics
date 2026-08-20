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
})
