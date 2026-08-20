import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const root = new URL('..', import.meta.url)
const read = name => readFileSync(new URL(name, root), 'utf8')
const entries = JSON.parse(read('.SNL_Doc/entries.json'))
const entry = id => {
  const result = entries.find(candidate => candidate.id === id)
  if (!result) throw new Error(`missing SNL metadata entry ${id}`)
  return result
}

function interfaceFields(source, interfaceName) {
  const match = source.match(new RegExp(`export\\s+interface\\s+${interfaceName}\\s*\\{([\\s\\S]*?)\\n\\}`))
  if (!match) throw new Error(`missing authoritative interface ${interfaceName}`)
  return [...match[1].matchAll(/^\s*(\w+)\??:\s/gm)].map(field => field[1])
}

function documentedFields(snl, interfaceName) {
  return [...snl.matchAll(new RegExp(`Type\\.judge\\(${interfaceName}\\.(\\w+)`, 'g'))].map(field => field[1])
}

describe('current public API metadata contracts', () => {
  it('documents the complete localized SnlMacroStyle template projection', () => {
    const authoritative = read('src/snl-macro/types.ts')
    const metadata = entry('mac.iface.snl-macro-style').content

    expect(documentedFields(metadata.snl, 'SnlMacroStyle')).toEqual(interfaceFields(authoritative, 'SnlMacroStyle'))
    expect(authoritative).toMatch(/template:\s*SnlMacroTemplate\s*\|\s*I18n<string,\s*SnlMacroTemplate>/)
    expect(metadata.snl).toContain('I18n<string, SnlMacroTemplate>')
    expect(metadata.snl).toContain('SnlMacroTemplate')
    expect(metadata.markdown).toMatch(/complete[^.]*template[^.]*invariant[^.]*localized/i)
    expect(`${metadata.snl} ${metadata.markdown}`).not.toMatch(/native LaTeX string|template,string/)
  })

  it('keeps SnlBlockRendererProps names and Task5 containment semantics authoritative', () => {
    const authoritative = read('src/snl-react-view/hooks.tsx')
    const metadata = entry('rv.iface.snl-block-renderer-props').content
    const fields = interfaceFields(authoritative, 'SnlBlockRendererProps')

    expect(fields).toEqual([
      'node',
      'macro_data_driver',
      'template',
      'dynamicArity',
      'treePath',
      'childMode',
      'childContainsBlock',
      'renderChild',
    ])
    expect(documentedFields(metadata.snl, 'SnlBlockRendererProps')).toEqual(fields)
    expect(metadata.snl).toContain('SnlBlockMacroTemplate')
    expect(metadata.snl).toMatch(/childContainsBlock,Type\.opt/)
    expect(metadata.markdown).toMatch(/complete, localized[^.]*TemplateSpec[^.]*projection/i)
    expect(metadata.markdown).toMatch(/recursive block capability/i)
    expect(metadata.markdown).toMatch(/fail closed[^.]*SVG/i)
  })
})
