import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

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
})
