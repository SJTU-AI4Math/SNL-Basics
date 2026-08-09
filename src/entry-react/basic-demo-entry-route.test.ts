import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('basic demo Entry integration route', () => {
  it('renders and previews through the public Entry path rather than the bare syntax-tree view', () => {
    const app = readFileSync(new URL('../../examples/basic-demo/src/App.tsx', import.meta.url), 'utf8')
    const main = readFileSync(new URL('../../examples/basic-demo/src/main.tsx', import.meta.url), 'utf8')
    const pkg = JSON.parse(readFileSync(new URL('../../examples/basic-demo/package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string>; scripts: Record<string, string> }
    const prepareScript = readFileSync(new URL('../../examples/basic-demo/scripts/prepare-local-package.mjs', import.meta.url), 'utf8')
    expect(app).toContain('EntryPreviewProvider')
    expect(app).toContain('EntrySurface')
    expect(app).toContain('EntryDataDriver')
    expect(app).not.toContain('SnlSyntaxTreeView')
    expect(app).not.toContain('prefers-color-scheme: dark')
    expect(app).not.toContain("color_scheme: 'dark'")
    expect(app.match(/color_scheme: 'light'/g)).toHaveLength(2)
    expect(main).toContain('@sjtu-ai4math/snl-basics/entry/style.css')
    expect(pkg.dependencies['@sjtu-ai4math/snl-basics']).toBe('file:../..')
    expect(pkg.scripts.postinstall).toBe('node scripts/prepare-local-package.mjs')
    expect(pkg.scripts.predev).toBe('node scripts/prepare-local-package.mjs')
    expect(pkg.scripts.prebuild).toBe('node scripts/prepare-local-package.mjs')
    expect(prepareScript).toContain("process.platform === 'win32'")
    expect(prepareScript).toContain("['run', 'build:lib']")
  })
})
