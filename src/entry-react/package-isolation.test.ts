import { readFileSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const forbidden = ['react-markdown', 'remark-gfm', 'remark-math', 'rehype-katex']

function localImportClosure(entry: string): Map<string, string> {
  const seen = new Map<string, string>()
  const visit = (path: string): void => {
    if (seen.has(path)) return
    const source = readFileSync(path, 'utf8')
    seen.set(path, source)
    const imports = [...source.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)]
    for (const match of imports) {
      const base = resolve(dirname(path), match[1])
      const candidates = extname(base)
        ? [base]
        : ['.ts', '.tsx', '.js', '.jsx'].map((suffix) => `${base}${suffix}`).concat(['index.ts', 'index.tsx'].map((name) => resolve(base, name)))
      const target = candidates.find((candidate) => {
        try { readFileSync(candidate); return true } catch { return false }
      })
      if (target) visit(target)
    }
  }
  visit(entry)
  return seen
}

describe('Entry package isolation', () => {
  it('exposes Entry only from the dedicated package subpath', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { exports: Record<string, unknown> }
    expect(pkg.exports['./entry']).toBeDefined()
    expect(pkg.exports['./entry/style.css']).toBe('./dist-lib/entry.css')
    expect(readFileSync(resolve(root, 'src/snl-react-view/index.ts'), 'utf8')).not.toMatch(/entry-react|EntryView|MarkdownBody/)
  })

  it('exports every nominal interaction dependency from the Entry subpath', () => {
    const source = readFileSync(resolve(root, 'src/entry-react/index.ts'), 'utf8')
    expect(source).toContain('MacroDataDriver')
    expect(source).toContain('SnlInteractionDriver')
    expect(source).toContain('type SnlInteractionContext')
    expect(source).toContain('SnlRenderHooks')
    expect(source).toContain('KindPalette')
  })

  it('keeps Markdown dependencies outside the root import closure', () => {
    const rootClosure = localImportClosure(resolve(root, 'src/snl-react-view/index.ts'))
    const rootSource = [...rootClosure.values()].join('\n')
    for (const name of forbidden) expect(rootSource).not.toContain(name)

    const entryClosure = localImportClosure(resolve(root, 'src/entry-react/index.ts'))
    const entrySource = [...entryClosure.values()].join('\n')
    for (const name of forbidden) expect(entrySource).toContain(name)
  })
})
