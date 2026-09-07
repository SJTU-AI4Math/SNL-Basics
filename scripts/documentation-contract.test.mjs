import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'

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
  it('provides distinct connected Specification and Document reading routes', () => {
    for (const [slug, id] of [['specification', 'Basics.Specification'], ['document', 'Basics.Document']]) {
      const graph = JSON.parse(read(`.SNL_Doc/libraries/${slug}/graph.json`))
      const meta = JSON.parse(read(`.SNL_Doc/libraries/${slug}/meta.json`))
      expect(meta.title).toBe(id.split('.')[1])
      const rootNode = graph.nodes.find(node => node.props.entryId === id)
      expect(rootNode).toBeDefined()
      const visited = new Set([rootNode.id])
      for (let changed = true; changed;) {
        changed = false
        for (const edge of graph.relationships) {
          if (edge.label === 'branch' && visited.has(edge.from) && !visited.has(edge.to)) {
            visited.add(edge.to); changed = true
          }
        }
      }
      expect(visited.size).toBe(graph.nodes.length)
      for (const node of graph.nodes) expect(byId.has(node.props.entryId)).toBe(true)
    }
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
