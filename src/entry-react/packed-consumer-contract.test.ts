import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8')

describe('0.3 packed-consumer release contract', () => {
  it('versions the candidate and wires a non-recursive release verifier', () => {
    const pkg = JSON.parse(read('package.json')) as {
      version: string
      scripts: Record<string, string>
    }
    const lock = JSON.parse(read('package-lock.json')) as {
      version: string
      packages: Record<string, { version?: string }>
    }

    expect(pkg.version).toBe('0.3.0')
    expect(lock.version).toBe('0.3.0')
    expect(lock.packages[''].version).toBe('0.3.0')
    expect(pkg.scripts['verify:packed-consumer']).toBe('node scripts/verify-packed-consumer.mjs')
    expect(pkg.scripts['verify:release']).toBe('npm run verify:packed-consumer')
    expect(pkg.scripts.prepublishOnly).not.toContain('verify:release')
  })

  it('builds, packs, and validates only public runtime, Entry, and CSS surfaces', () => {
    const verifier = read('scripts/verify-packed-consumer.mjs')

    expect(verifier).toContain("execFileSync('npm', ['run', 'build:lib']")
    expect(verifier.indexOf("['run', 'build:lib']")).toBeLessThan(verifier.indexOf("'pack', '--json'"))
    expect(verifier).toContain("from '@sjtu-ai4math/snl-basics';")
    expect(verifier).toContain("from '@sjtu-ai4math/snl-basics/entry';")
    expect(verifier).toContain("from '@sjtu-ai4math/snl-basics/runtime';")
    expect(verifier).toContain("import '@sjtu-ai4math/snl-basics/style.css';")
    expect(verifier).toContain("import '@sjtu-ai4math/snl-basics/entry/style.css';")
    expect(verifier).toContain('skipLibCheck: false')
    expect(verifier).toContain("'.bin', 'vite'")
    expect(verifier).toContain("['build']")
    expect(verifier).toContain('.snl-foreign-box')
    expect(verifier).toContain('.snl-svg-template')
    expect(verifier).toContain('.snlFormulaForeignMarker')
    expect(verifier).not.toMatch(/\.\.\/src\//)
    expect(verifier).not.toMatch(/from ['"]\.\.?\//)
  })

  it('does not claim that the packed library contains the retired Macro DB assets', () => {
    const readme = read('README.md')
    const readmeZh = read('README(ZH).md')
    const copier = read('scripts/copy-lib-assets.mjs')
    expect(copier).toContain("rmSync(join(root, 'dist-lib/snl-macro-db.json')")
    expect(copier).toContain("rmSync(join(root, 'dist-lib/snl-macro-db-samples.json')")
    expect(readme).not.toMatch(/build:lib[^\n]*core macro DB/i)
    expect(readmeZh).not.toMatch(/build:lib[^\n]*核心宏数据库/)
  })

  it('loads root CSS in the source-linked Entry demo', () => {
    const main = read('examples/basic-demo/src/main.tsx')
    expect(main).toContain("import '@sjtu-ai4math/snl-basics/style.css'")
    expect(main).toContain("import '@sjtu-ai4math/snl-basics/entry/style.css'")
  })

  it('documents the honest static/no-measurement limit', () => {
    const api = read('docs/api.md')
    expect(api).toMatch(/SSR\/no-measurement[\s\S]{0,500}visible accessible label fallback/i)
    expect(api).toMatch(/trusted precomputed metrics/i)
    expect(api).toMatch(/does not preserve[\s\S]{0,160}live rich child/i)
  })
})
