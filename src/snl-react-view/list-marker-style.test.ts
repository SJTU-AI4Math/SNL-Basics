import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/snl-react-view/style.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

function selectorsForDeclaration(property: string, value: string): string[] {
  const selectors: string[] = []
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = new Map(
      match[2].split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
        const colon = part.indexOf(':')
        return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()]
      }),
    )
    if (declarations.get(property) === value) {
      selectors.push(...match[1].split(',').map((selector) => selector.trim()))
    }
  }
  return selectors
}

describe('native list marker layout', () => {
  it('keeps native React text out of the atomic KaTeX metadata rule', () => {
    const inlineBlocks = selectorsForDeclaration('display', 'inline-block')
    const kinds = ['bvar', 'fvar', 'binder']

    for (const kind of kinds) {
      expect(inlineBlocks).toContain(`.katex-html .katex [data-kind='${kind}']`)
      expect(inlineBlocks).not.toContain(`.katex-html [data-kind='${kind}']`)
    }
  })
})
