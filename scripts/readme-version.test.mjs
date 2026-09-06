import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { MACRO_SCHEMA_VERSION, PACKAGE_VERSION, TREE_SCHEMA_VERSION } from '../src/schema'

const root = new URL('..', import.meta.url)
const read = name => readFileSync(new URL(name, root), 'utf8')
// Current entities are authoritative; entries.json is a frozen migration backup.
const entries = readdirSync(new URL('.SNL_Doc/entries/', root)).filter(name => name.endsWith('.json'))
  .map(name => JSON.parse(read(`.SNL_Doc/entries/${name}`)).entry)

describe('published package version', () => {
  it('matches every current-version surface and derives the packed expectation', () => {
    const packageJson = JSON.parse(read('package.json'))
    const packageLock = JSON.parse(read('package-lock.json'))
    const version = packageJson.version

    expect(packageLock.version).toBe(version)
    expect(packageLock.packages[''].version).toBe(version)
    expect(PACKAGE_VERSION).toBe(version)

    for (const name of ['README.md', 'README(ZH).md']) {
      const readme = read(name)
      expect(readme, name).toContain(`**v${version} · MIT License · Beta**`)
      const label = name === 'README.md' ? '**Version:**' : '**版本：**'
      expect(readme, name).toContain(`${label} \`${version}\``)
    }

    expect(read('docs/api.md')).toContain(`Current beta surface for v${version}.`)
    const manifestEntry = entries.find(entry => entry.id === 'npm.snl-basics-react')
    expect(manifestEntry.content.snl).toContain(`version ${version}`)
    expect(manifestEntry.content.markdown).toContain(`version \`${version}\``)

    const packedVerifier = read('scripts/verify-packed-entry-i18n.mjs')
    expect(packedVerifier).toMatch(/const expectedVersion = .*package\.json/)
    expect(packedVerifier).toContain('packageJson.version !== expectedVersion')
  })

  it('keeps current SNL metadata aligned with exported schema versions', () => {
    const body = id => entries.find(entry => entry.id === id)?.content.markdown
    const macroMigration = body('schema.fn.migrate-macro-document')
    const treeMigration = body('schema.fn.migrate-syntax-tree-document')
    const macroVersion = body('schema.const.macro-schema-version')
    const treeVersion = body('schema.const.tree-schema-version')

    expect(macroMigration).toContain(`current v${MACRO_SCHEMA_VERSION}`)
    expect(treeMigration).toContain(`current v${TREE_SCHEMA_VERSION}`)
    expect(macroVersion).toContain(`(${MACRO_SCHEMA_VERSION})`)
    expect(treeVersion).toContain(`(${TREE_SCHEMA_VERSION})`)
    expect([macroMigration, macroVersion].join(' ')).not.toMatch(/(?:current|to) (?:schema )?v?7\b/i)
    expect([treeMigration, treeVersion].join(' ')).not.toMatch(/(?:current|to) (?:schema )?v?2\b/i)
  })
})
