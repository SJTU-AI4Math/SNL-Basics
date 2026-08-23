import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8')

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.replace(/\/\*[\s\S]*?\*\//g, '').match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  expect(match, `missing CSS rule ${selector}`).not.toBeNull()
  return match![1]
}

function expectDeclaration(body: string, property: string, value: string): void {
  const declarations = new Map(body.split(';').map((declaration) => declaration.trim()).filter(Boolean).map((declaration) => {
    const colon = declaration.indexOf(':')
    return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()]
  }))
  expect(declarations.get(property), `${property} in ${body}`).toBe(value)
}

describe('public Entry stylesheet closure', () => {
  it('owns scoped textual SNL wrapping and intrinsic-island resets', () => {
    const css = read('src/entry-react/style.css')
    expect(css.startsWith("@import '../snl-react-view/style.css';")).toBe(true)

    const surface = rule(css, '[data-entry-id]')
    expectDeclaration(surface, '--snl-tex-prose-font-family', "KaTeX_Main, 'SNL Noto Serif SC', serif")
    expectDeclaration(surface, '--snl-tex-prose-scale', '1.21em')

    const title = rule(css, '.snl-entry-title')
    expectDeclaration(title, 'font-family', 'var(--snl-tex-prose-font-family)')

    const text = rule(css, '[data-entry-body] .snl-text')
    expectDeclaration(text, 'font-family', 'var(--snl-tex-prose-font-family)')
    expectDeclaration(text, 'font-size', 'var(--snl-tex-prose-scale)')
    expectDeclaration(text, 'font-style', 'normal')
    expectDeclaration(text, 'font-weight', '400')
    expectDeclaration(text, 'line-height', '1.2')
    expectDeclaration(text, 'min-width', '0')
    expectDeclaration(text, 'max-width', '100%')
    expectDeclaration(text, 'overflow-wrap', 'anywhere')
    expectDeclaration(text, 'word-break', 'break-word')

    const nestedText = rule(css, '[data-entry-body] .snl-text .snl-text')
    expectDeclaration(nestedText, 'font-size', '1em')

    const mathSpan = rule(css, '[data-entry-body] .snl-text .snl-math-span')
    expectDeclaration(mathSpan, 'font-size', 'calc(1em / 1.21)')

    for (const selector of [
      '[data-entry-body] .snl-text .snl-math-span',
      '[data-entry-body] .snl-text .katex',
      '[data-entry-body] .snl-text pre',
      '[data-entry-body] .snl-text code',
    ]) {
      const island = rule(css, selector)
      expectDeclaration(island, 'overflow-wrap', 'normal')
      expectDeclaration(island, 'word-break', 'normal')
    }
  })

  it('owns a scoped local scroller for SNL formula panels', () => {
    const css = read('src/entry-react/style.css')
    const panel = rule(css, '[data-entry-body] .katex-panel')
    expectDeclaration(panel, 'box-sizing', 'border-box')
    expectDeclaration(panel, 'min-width', '0')
    expectDeclaration(panel, 'max-width', '100%')
    expectDeclaration(panel, 'overflow-x', 'auto')

    const katex = rule(css, '[data-entry-body] .katex-panel .katex')
    expectDeclaration(katex, 'overflow-wrap', 'normal')
    expectDeclaration(katex, 'word-break', 'normal')
  })

  it('runs geometry against only the built public Entry stylesheet', () => {
    const harness = read('test-fixtures/entry-narrow/main.tsx')
    expect(harness).toContain("import '../../dist-lib/entry.css'")
    expect(harness).not.toContain('snl-react-view/style.css')
    expect(harness).not.toContain("src/entry-react/style.css")
  })

  it('exports and verifies the byte-copied Entry stylesheet before packing', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.exports['./entry/style.css'].default).toBe('./dist-lib/entry.css')
    expect(read('scripts/copy-lib-assets.mjs')).toContain(".replace(\"@import '../snl-react-view/style.css';\", \"@import './style.css';\")")
    expect(pkg.scripts['build:lib']).toContain('node scripts/verify-entry-style-closure.mjs')
    const verifier = read('scripts/verify-entry-style-closure.mjs')
    expect(verifier).toContain("readFileSync(join(root, 'src/entry-react/style.css'), 'utf8')")
    expect(verifier).toContain("readFileSync(join(root, 'dist-lib/entry.css'), 'utf8')")
    expect(verifier).toContain('public Entry stylesheet is not the normalized source copy')
  })
})
