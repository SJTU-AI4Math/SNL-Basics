import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const root = new URL('..', import.meta.url)

describe('published README version', () => {
  it('matches package.json in both languages', () => {
    const version = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).version
    for (const name of ['README.md', 'README(ZH).md']) {
      const readme = readFileSync(new URL(name, root), 'utf8')
      expect(readme, name).toContain(`**v${version} · MIT License · Beta**`)
      const label = name === 'README.md' ? '**Version:**' : '**版本：**'
      expect(readme, name).toContain(`${label} \`${version}\``)
    }
  })
})
