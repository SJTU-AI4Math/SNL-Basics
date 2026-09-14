import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')
const config = JSON.parse(read('.SNL_Doc/config.json'))
const entries = readdirSync(new URL('.SNL_Doc/entries/', root))
  .filter(name => name.endsWith('.json'))
  .map(name => JSON.parse(read(`.SNL_Doc/entries/${name}`)).entry)
const byId = new Map(entries.map(entry => [entry.id, entry]))
const luminance = hex => {
  expect(hex).toMatch(/^#[0-9a-f]{6}$/i)
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
  return rgb.reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0)
}
function assertSystemTree(graph) {
  const ids = new Set(graph.nodes.map(node => node.id))
  expect(ids.size).toBe(graph.nodes.length)
  expect(new Set(graph.nodes.map(node => node.props.entryId)).size).toBe(graph.nodes.length)
  const rootNode = graph.nodes.find(node => node.props.entryId === 'Basics.Specification')
  expect(rootNode).toBeDefined()
  expect(graph.relationships.length).toBe(graph.nodes.length - 1)
  for (const edge of graph.relationships) {
    expect(edge.label).toBe('branch')
    expect(ids.has(edge.from)).toBe(true)
    expect(ids.has(edge.to)).toBe(true)
  }
  for (const node of graph.nodes) {
    const parents = graph.relationships.filter(edge => edge.to === node.id)
    expect(parents.length, node.id).toBe(node.id === rootNode.id ? 0 : 1)
  }
  const visited = new Set([rootNode.id])
  for (let changed = true; changed;) {
    changed = false
    for (const edge of graph.relationships) {
      if (visited.has(edge.from) && !visited.has(edge.to)) {
        visited.add(edge.to); changed = true
      }
    }
  }
  expect(visited.size).toBe(graph.nodes.length)
}

function assertDarkPalette(kinds) {
  for (const kind of kinds) {
    const { light, dark } = kind.coloring
    expect(light).toBeDefined()
    expect(dark).toBeDefined()
    if (kind.id === 'sub') {
      expect(dark).toEqual({ stroke: 'inherit', background: 'transparent' })
      continue
    }
    const fill = luminance(dark.background)
    const stroke = luminance(dark.stroke)
    expect(fill, kind.id).toBeLessThan(0.04)
    expect((Math.max(fill, stroke) + 0.05) / (Math.min(fill, stroke) + 0.05), kind.id).toBeGreaterThanOrEqual(4.5)
  }
}

describe('maintained repository documentation', () => {
  it('keeps real dark surfaces for both Entry and semantic Macro kinds', () => {
    assertDarkPalette([...config.entry_kinds, ...config.macro_kinds])
    for (const id of ['rule', 'const', 'binder', 'bvar', 'fvar', 'sub']) {
      expect(config.macro_kinds.some(kind => kind.id === id), id).toBe(true)
    }
  })
  it('lets the docs inline-code Macro inherit theme ink', () => {
    const macros = readdirSync(new URL('.SNL_Doc/macros/', root))
      .filter(name => name.endsWith('.json'))
      .map(name => JSON.parse(read(`.SNL_Doc/macros/${name}`)).macro)
    const code = macros.find(macro => macro?.name === 'api.code')
    expect(code.styles[0].template.body).toBe(String.raw`\texttt{#0}`)
  })
  it('rejects the original light-palette-copy regression', () => {
    for (const source of [config.entry_kinds, config.macro_kinds]) {
      const copy = structuredClone(source)
      const target = copy.find(kind => kind.id !== 'sub')
      target.coloring.dark = structuredClone(target.coloring.light)
      expect(() => assertDarkPalette(copy)).toThrow()
    }
  })
  it('organizes the system Library as specification parents with implementation children', () => {
    expect(existsSync(new URL('.SNL_Doc/libraries/SNLBasics/graph.json', root))).toBe(true)
    const graph = JSON.parse(read('.SNL_Doc/libraries/SNLBasics/graph.json'))
    const meta = JSON.parse(read('.SNL_Doc/libraries/SNLBasics/meta.json'))
    expect(meta.title).toBe('SNL-Basics')
    for (const slug of ['specification', 'document']) {
      expect(existsSync(new URL(`.SNL_Doc/libraries/${slug}/meta.json`, root))).toBe(false)
    }
    assertSystemTree(graph)
    for (const node of graph.nodes) expect(byId.has(node.props.entryId)).toBe(true)
    for (const [spec, doc] of [
      ['Ownership', 'Setup'], ['Syntax', 'FirstTree'], ['Macros', 'Templates'],
      ['Drivers', 'Drivers'], ['Rendering', 'Entries'], ['Svg', 'Svg'],
      ['Theme', 'Theme'], ['Interaction', 'Interaction'], ['Compatibility', 'Maintenance'],
    ]) {
      const parent = graph.nodes.find(node => node.props.entryId === `Basics.Specification.${spec}`)
      const child = graph.nodes.find(node => node.props.entryId === `Basics.Document.${doc}`)
      expect(parent, spec).toBeDefined()
      expect(child, doc).toBeDefined()
      expect(graph.relationships.some(edge => edge.label === 'branch' && edge.from === parent.id && edge.to === child.id), spec).toBe(true)
    }
    const included = new Set(graph.nodes.map(node => node.props.entryId))
    for (const entry of entries.filter(entry => entry.package === 'basics-docs')) {
      expect(included.has(entry.id), entry.id).toBe(true)
      expect(entry.content.markdown, entry.id).not.toMatch(/(?:Specification|Document)\*\* Library|Specification's Macro chapter|guide chapters below in order/)
    }
    for (const slug of ['concepts', 'snl-syntax-tree', 'snl-macro', 'snl-react-view', 'entry-react', 'public-api']) {
      expect(existsSync(new URL(`.SNL_Doc/libraries/${slug}/graph.json`, root))).toBe(true)
    }
  })
  it('rejects duplicate occurrences, multiple parents, dangling edges and disconnected cycles', () => {
    const graph = JSON.parse(read('.SNL_Doc/libraries/SNLBasics/graph.json'))
    const mutations = [
      copy => { copy.nodes.push(structuredClone(copy.nodes[0])) },
      copy => { copy.nodes[1].props.entryId = copy.nodes[0].props.entryId },
      copy => { copy.relationships[0].from = 'missing-node' },
      copy => { copy.relationships[1].to = copy.relationships[0].to },
      copy => { copy.relationships[0].from = 'Basics.Document.ReferenceMap' },
    ]
    for (const mutate of mutations) {
      const copy = structuredClone(graph)
      mutate(copy)
      expect(() => assertSystemTree(copy)).toThrow()
    }
  })
  it('keeps documentation Package membership exact and current-main prose intact', () => {
    const packages = readdirSync(new URL('.SNL_Doc/packages/', root))
      .filter(name => name.endsWith('.json'))
      .map(name => JSON.parse(read(`.SNL_Doc/packages/${name}`)))
    const docs = packages.find(pkg => pkg.id === 'basics-docs')
    expect(docs.entry_ids).toEqual(entries.filter(entry => entry.package === docs.id).map(entry => entry.id).sort())
    expect(byId.get('Basics.Specification.Rendering').content.markdown).toContain('## Native inline text and authored breaks')
    expect(byId.get('Basics.Specification.Rendering').content.markdown).toContain('## Default dark semantic palette')
    expect(byId.get('Basics.Specification.Interaction').content.markdown).toContain('## Native inline-text highlight geometry')
    expect(byId.get('Basics.Specification.Interaction').content.markdown).toContain('## Overflow clipping of highlight paint')
    expect(byId.get('Basics.Specification.Interaction').content.markdown).toContain('CSS used-value semantics')
  })
  it('keeps authored guide chapters substantive and source pointers resolvable', () => {
    const chapters = entries.filter(entry => entry.package === 'basics-docs')
    expect(chapters.length).toBeGreaterThanOrEqual(19)
    for (const entry of chapters) {
      expect(entry.content.markdown.length, entry.id).toBeGreaterThan(400)
      if (entry.pointer) expect(read(entry.pointer.file), entry.id).toMatch(new RegExp(entry.pointer.pattern))
    }
    expect(byId.get('Basics.Document.FirstTree').content.markdown).toContain('const equals: SnlMacro')
  })
})
