import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PACKAGE_VERSION } from '../src/schema'

const root = new URL('..', import.meta.url)
const read = name => readFileSync(new URL(name, root), 'utf8')

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
    const entries = JSON.parse(read('.SNL_Doc/entries.json'))
    expect(entries[0].content.snl).toContain(`version ${version}`)
    expect(entries[0].content.markdown).toContain(`version \`${version}\``)

    const packedVerifier = read('scripts/verify-packed-entry-i18n.mjs')
    expect(packedVerifier).toMatch(/const expectedVersion = .*package\.json/)
    expect(packedVerifier).toContain('packageJson.version !== expectedVersion')
  })
})
