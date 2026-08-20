import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'

const root = new URL('..', import.meta.url)
const read = name => readFileSync(new URL(name, root), 'utf8')
const entries = JSON.parse(read('.SNL_Doc/entries.json'))
const entryIds = new Set(entries.map(candidate => candidate.id))

function filesNamed(directory, name) {
  const result = []
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const url = new URL(item.name + (item.isDirectory() ? '/' : ''), directory)
    if (item.isDirectory()) result.push(...filesNamed(url, name))
    else if (item.name === name) result.push(url)
  }
  return result
}

function assertGraphIntegrity(graph, source) {
  const nodeIds = new Set(graph.nodes.map(node => node.id))
  expect(nodeIds.size, `${source}: duplicate node ID`).toBe(graph.nodes.length)
  for (const node of graph.nodes) {
    expect(entryIds.has(node.props?.entryId), `${source}: node ${node.id} points to missing entry ${node.props?.entryId}`).toBe(true)
  }
  for (const relationship of graph.relationships) {
    expect(nodeIds.has(relationship.from), `${source}: edge source ${relationship.from} is missing`).toBe(true)
    expect(nodeIds.has(relationship.to), `${source}: edge target ${relationship.to} is missing`).toBe(true)
  }
}

const entry = id => {
  const result = entries.find(candidate => candidate.id === id)
  if (!result) throw new Error(`missing SNL metadata entry ${id}`)
  return result
}

function interfaceProperties(source, interfaceName) {
  const match = source.match(new RegExp(`export\\s+interface\\s+${interfaceName}\\s*\\{([\\s\\S]*?)\\n\\}`))
  if (!match) throw new Error(`missing authoritative interface ${interfaceName}`)
  return [...match[1].matchAll(/^\s*(\w+)(\?)?:\s*([^\n]+)/gm)].map(([, name, optional, type]) => ({
    name,
    required: optional !== '?',
    type: type.trim(),
  }))
}

function documentedFields(snl, interfaceName) {
  return [...snl.matchAll(new RegExp(`Type\\.judge\\(${interfaceName}\\.(\\w+)`, 'g'))].map(field => field[1])
}

function styleFieldEntries(candidateEntries = entries) {
  return candidateEntries.filter(candidate =>
    candidate.kind === 'field' && (
      candidate.parent === 'mac.iface.snl-macro-style' ||
      candidate.id?.startsWith('mac.iface.snl-macro-style.')
    ),
  )
}

function assertCurrentStyleMetadata(candidateEntries = entries) {
  const authoritative = read('src/snl-macro/types.ts')
  const properties = interfaceProperties(authoritative, 'SnlMacroStyle')
  const metadata = candidateEntries.find(candidate => candidate.id === 'mac.iface.snl-macro-style')?.content
  if (!metadata) throw new Error('missing SnlMacroStyle metadata')

  expect(properties).toEqual([
    { name: 'style_name', required: true, type: 'string' },
    { name: 'tags', required: true, type: 'string[]' },
    { name: 'template', required: true, type: 'SnlMacroTemplate | I18n<string, SnlMacroTemplate>' },
  ])
  expect(documentedFields(metadata.snl, 'SnlMacroStyle')).toEqual(properties.map(property => property.name))
  expect(styleFieldEntries(candidateEntries).map(candidate => candidate.id)).toEqual([
    'mac.iface.snl-macro-style.style_name',
    'mac.iface.snl-macro-style.template',
    'mac.iface.snl-macro-style.tags',
  ])

  const template = candidateEntries.find(candidate => candidate.id === 'mac.iface.snl-macro-style.template')
  const tags = candidateEntries.find(candidate => candidate.id === 'mac.iface.snl-macro-style.tags')
  expect(template?.content?.markdown).toMatch(/SnlMacroTemplate\s*\|\s*I18n<string,\s*SnlMacroTemplate>/)
  expect(template?.content?.markdown).not.toMatch(/LaTeX(?:-native)?\s+(?:string|template)/i)
  expect(tags?.content?.markdown).toMatch(/required/i)
  expect(tags?.content?.markdown).not.toMatch(/optional/i)

  const currentClaims = candidateEntries
    .filter(candidate => candidate.id !== 'schema.fn.migrate-macro-document')
    .map(candidate => JSON.stringify(candidate))
    .join('\n')
  expect(currentClaims).not.toMatch(/SnlMacroStyle\[\\?"(?:mode|block_template_name|separator)\\?"\]/)
}

describe('SNL metadata referential integrity', () => {
  it('keeps every graph node entry and relationship endpoint resolvable', () => {
    const graphUrls = filesNamed(new URL('.SNL_Doc/', root), 'graph.json')
    expect(graphUrls.length).toBeGreaterThan(0)
    for (const url of graphUrls) assertGraphIntegrity(JSON.parse(readFileSync(url, 'utf8')), url.pathname)
  })

  it('rejects dangling graph entry and edge references', () => {
    const graph = JSON.parse(readFileSync(filesNamed(new URL('.SNL_Doc/', root), 'graph.json')[0], 'utf8'))
    const missingEntry = structuredClone(graph)
    missingEntry.nodes[0].props.entryId = 'missing.entry'
    expect(() => assertGraphIntegrity(missingEntry, 'mutated graph')).toThrow()

    const missingEndpoint = structuredClone(graph)
    missingEndpoint.relationships[0].to = 'missing-node'
    expect(() => assertGraphIntegrity(missingEndpoint, 'mutated graph')).toThrow()
  })

  it('does not retain removed SnlMacroStyle entry IDs in current metadata', () => {
    const removedIds = [
      'mac.iface.snl-macro-style.mode',
      'mac.iface.snl-macro-style.block_template_name',
      'mac.iface.snl-macro-style.separator',
    ]
    const pending = [new URL('.SNL_Doc/', root)]
    while (pending.length > 0) {
      const directory = pending.pop()
      for (const item of readdirSync(directory, { withFileTypes: true })) {
        const url = new URL(item.name + (item.isDirectory() ? '/' : ''), directory)
        if (item.isDirectory()) pending.push(url)
        else if (item.name.endsWith('.json')) {
          const content = readFileSync(url, 'utf8')
          for (const id of removedIds) expect(content, `${url.pathname}: stale ${id}`).not.toContain(id)
        }
      }
    }
  })
})

describe('current public API metadata contracts', () => {
  it('documents exactly the authoritative current SnlMacroStyle shape', () => {
    assertCurrentStyleMetadata()
  })

  it('rejects stale style fields, bare-string templates, and optional required tags', () => {
    for (const mutate of [
      copy => copy.push({ id: 'mac.iface.snl-macro-style.mode', kind: 'field', content: { markdown: 'legacy mode' } }),
      copy => { copy.find(candidate => candidate.id === 'mac.iface.snl-macro-style.template').content.markdown = 'LaTeX-native string template.' },
      copy => { copy.find(candidate => candidate.id === 'mac.iface.snl-macro-style.tags').content.markdown = 'Optional style labels.' },
    ]) {
      const copy = structuredClone(entries)
      mutate(copy)
      expect(() => assertCurrentStyleMetadata(copy)).toThrow()
    }
  })

  it('keeps SnlBlockRendererProps names and Task5 containment semantics authoritative', () => {
    const authoritative = read('src/snl-react-view/hooks.tsx')
    const metadata = entry('rv.iface.snl-block-renderer-props').content
    const fields = interfaceProperties(authoritative, 'SnlBlockRendererProps').map(property => property.name)

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
