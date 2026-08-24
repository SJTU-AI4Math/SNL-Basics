import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8')

describe('0.3.3 packed-consumer release contract', () => {
  it('versions the candidate and wires a non-recursive release verifier', () => {
    const pkg = JSON.parse(read('package.json')) as {
      version: string
      scripts: Record<string, string>
    }
    const lock = JSON.parse(read('package-lock.json')) as {
      version: string
      packages: Record<string, { version?: string }>
    }

    expect(pkg.version).toBe('0.3.3')
    expect(lock.version).toBe('0.3.3')
    expect(lock.packages[''].version).toBe('0.3.3')
    expect(pkg.scripts['test:version-contract']).toBe('vitest run scripts/readme-version.test.mjs --maxWorkers=1')
    expect(pkg.scripts['verify:packed-consumer']).toBe('node scripts/verify-packed-consumer.mjs')
    expect(pkg.scripts['verify:release']).toBe('npm run test:version-contract && npm run verify:packed-consumer && npm run verify:packed-entry-i18n')
    const entryVerifier = read('scripts/verify-packed-entry-i18n.mjs')
    expect(entryVerifier).toContain("execFileSync('npm', ['run', 'build:lib']")
    expect(entryVerifier.indexOf("['run', 'build:lib']")).toBeLessThan(entryVerifier.indexOf("'pack', '--json'"))
    expect(pkg.scripts.prepublishOnly).toBe('npm run test:version-contract && npm run build:lib')
  })

  it('builds, packs, and validates only public runtime, Entry, and CSS surfaces', () => {
    const verifier = read('scripts/verify-packed-consumer.mjs')

    expect(verifier).toContain("execFileSync('npm', ['run', 'build:lib']")
    expect(verifier.indexOf("['run', 'build:lib']")).toBeLessThan(verifier.indexOf("'pack', '--json'"))
    expect(verifier).toContain("from '@sjtu-ai4math/snl-basics';")
    expect(verifier).toContain("from '@sjtu-ai4math/snl-basics/entry';")
    expect(verifier).toContain("from '@sjtu-ai4math/snl-basics/runtime';")
    expect(verifier).not.toContain("import '@sjtu-ai4math/snl-basics/style.css';")
    expect(verifier).toContain("import '@sjtu-ai4math/snl-basics/entry/style.css';")
    expect(verifier).toContain('builtFontFaceCount !== sourceFontFaceCount')
    expect(verifier).toContain('skipLibCheck: false')
    expect(verifier).toContain("'.bin', 'vite'")
    expect(verifier).toContain("['build']")
    expect(verifier).toContain('.snl-foreign-box')
    expect(verifier).toContain('.snl-svg-template')
    expect(verifier).toContain('.snlFormulaForeignMarker')
    expect(verifier).toContain('SNL Noto Serif SC')
    expect(verifier).toContain("'dist-lib', 'fonts'")
    expect(verifier).toContain('OFL.txt')
    expect(verifier).toContain('.woff2')
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

  it('loads the complete Entry stylesheet exactly once in consumers and docs', () => {
    const main = read('examples/basic-demo/src/main.tsx')
    expect(main).not.toContain("import '@sjtu-ai4math/snl-basics/style.css'")
    expect(main).toContain("import '@sjtu-ai4math/snl-basics/entry/style.css'")
    for (const path of ['README.md', 'README(ZH).md', 'docs/api.md', 'docs/entry-rendering.md']) {
      const document = read(path)
      expect(document).not.toMatch(/snl-basics\/style\.css['"]\s*\n\s*import ['"]@sjtu-ai4math\/snl-basics\/entry\/style\.css/)
    }
  })

  it('documents the honest static/no-measurement limit', () => {
    const api = read('docs/api.md')
    expect(api).toMatch(/SSR\/no-measurement[\s\S]{0,500}visible accessible label fallback/i)
    expect(api).toMatch(/trusted precomputed metrics/i)
    expect(api).toMatch(/does not preserve[\s\S]{0,160}live rich child/i)
  })
})
