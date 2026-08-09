import { readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const snlDocRoot = fileURLToPath(new URL('../../.SNL_Doc', import.meta.url))

function jsonFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    return entry.isDirectory() ? jsonFiles(path) : extname(path) === '.json' ? [path] : []
  })
}

type Graph = {
  nodes?: Array<{ id: string; props?: { entryId?: string } }>
  relationships?: Array<{ from: string; to: string }>
  edges?: Array<{ from: string; to: string }>
}

describe('SNL documentation distribution claims', () => {
  it('keeps package metadata publication-neutral and count-neutral', () => {
    const entries = readFileSync(new URL('../../.SNL_Doc/entries.json', import.meta.url), 'utf8')
    const normalized = entries.toLowerCase()
    for (const stale of [
      'public on npm',
      'bundled macro database',
      'bundled macro data',
      "package.json#files: ['dist-lib']",
      'seven files',
      '29 kB',
      'depending on the schedule for actually publishing',
    ]) expect(normalized).not.toContain(stale.toLowerCase())
    expect(entries).toContain('Publication status is external registry state')
    expect(entries).toContain('README.md, README(ZH).md, MIGRATION.md, and LICENSE')
    expect(entries).toContain('exact file count and byte size are measured afresh')
  })

  it('keeps every active graph free of stale claims and dangling references', () => {
    const files = jsonFiles(snlDocRoot)
    const allText = files.map((path) => readFileSync(path, 'utf8')).join('\n').toLowerCase()
    expect(allText).not.toContain('bundled macro database')
    expect(allText).not.toContain('bundled macro data')
    expect(allText).not.toContain('bundled data')

    const entries = JSON.parse(readFileSync(join(snlDocRoot, 'entries.json'), 'utf8')) as Array<{ id: string }>
    const entryIds = new Set(entries.map(({ id }) => id))
    for (const path of files.filter((value) => value.endsWith('graph.json'))) {
      const graph = JSON.parse(readFileSync(path, 'utf8')) as Graph
      const nodeIds = new Set((graph.nodes ?? []).map(({ id }) => id))
      for (const node of graph.nodes ?? []) {
        if (node.props?.entryId) expect(entryIds.has(node.props.entryId), `${path}: ${node.props.entryId}`).toBe(true)
      }
      for (const edge of [...(graph.relationships ?? []), ...(graph.edges ?? [])]) {
        expect(nodeIds.has(edge.from), `${path}: edge.from ${edge.from}`).toBe(true)
        expect(nodeIds.has(edge.to), `${path}: edge.to ${edge.to}`).toBe(true)
      }
    }
  })
})
