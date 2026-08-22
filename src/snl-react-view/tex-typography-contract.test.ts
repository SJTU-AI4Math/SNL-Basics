import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8')

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.replace(/\/\*[\s\S]*?\*\//g, '').match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  expect(match, `missing CSS rule ${selector}`).not.toBeNull()
  return match![1]
}

function declaration(body: string, property: string): string | undefined {
  return new Map(body.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const colon = part.indexOf(':')
    return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()]
  })).get(property)
}

function unicodeRangeContains(rangeList: string, codePoint: number): boolean {
  return rangeList.split(',').some((rawRange) => {
    const token = rawRange.trim().replace(/^U\+/i, '')
    const [start, end = start] = token.split('-').map((value) => Number.parseInt(value, 16))
    return Number.isFinite(start) && start <= codePoint && codePoint <= end
  })
}

describe('SNL TeX typography contract', () => {
  it('ships an OFL-licensed deterministic CJK serif face with the public stylesheet', () => {
    const css = read('src/snl-react-view/style.css')
    expect(css.startsWith("@import './fonts/noto-serif-sc-400.css';")).toBe(true)

    const fontCss = read('src/snl-react-view/fonts/noto-serif-sc-400.css')
    const faces = [...fontCss.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) => match[1])
    expect(faces.length).toBeGreaterThan(90)
    expect(faces.every((face) => declaration(face, 'font-family') === "'SNL Noto Serif SC'")).toBe(true)
    expect(faces.every((face) => declaration(face, 'font-display') === 'block')).toBe(true)
    expect(faces.every((face) => /url\('\.\/[^']+\.woff2'\) format\('woff2'\)/.test(declaration(face, 'src') ?? ''))).toBe(true)
    expect(faces.some((face) => unicodeRangeContains(declaration(face, 'unicode-range') ?? '', '中'.codePointAt(0)!))).toBe(true)

    for (const face of faces) {
      const file = declaration(face, 'src')?.match(/url\('\.\/([^']+\.woff2)'\)/)?.[1]
      expect(file, 'every face owns one WOFF2 asset').toBeTruthy()
      expect(existsSync(resolve(root, 'src/snl-react-view/fonts', file!)), file).toBe(true)
    }
    expect(read('src/snl-react-view/fonts/OFL.txt')).toContain('SIL OPEN FONT LICENSE Version 1.1')
  })

  it('uses one TeX prose token for native SNL text and block list markers', () => {
    const css = read('src/snl-react-view/style.css')
    const surface = rule(css, '.katex-html')
    expect(declaration(surface, '--snl-tex-prose-font-family')).toBe("KaTeX_Main, 'SNL Noto Serif SC', serif")
    expect(declaration(surface, '--snl-tex-prose-scale')).toBe('1.21em')

    const text = rule(css, '.snl-text')
    expect(declaration(text, 'font-family')).toBe('var(--snl-tex-prose-font-family)')
    expect(declaration(text, 'font-size')).toBe('var(--snl-tex-prose-scale)')

    for (const selector of ['.snl-block-list > li::marker', '.snl-block-enumerate > li::marker']) {
      const marker = rule(css, selector)
      expect(declaration(marker, 'font-family')).toBe('var(--snl-tex-prose-font-family)')
      expect(declaration(marker, 'font-size')).toBe('var(--snl-tex-prose-scale)')
    }

    for (const selector of ['.snl-text .snl-block-list > li::marker', '.snl-text .snl-block-enumerate > li::marker']) {
      expect(declaration(rule(css, selector), 'font-size')).toBe('1em')
    }
  })

  it('binds the browser gate to its owned ephemeral server and exact fixture', () => {
    const verifier = read('scripts/verify-root-text-typography.mjs')
    const fixture = read('test-fixtures/root-text-typography/main.tsx')

    expect(verifier).toContain("import { createServer } from 'vite'")
    expect(verifier).toContain('reserveEphemeralPort')
    expect(verifier).toContain("listen({ host: '127.0.0.1', port: 0, exclusive: true }")
    expect(verifier).toContain('port: requestedPort')
    expect(verifier).not.toContain('4187')
    expect(verifier).toContain('__SNL_TYPOGRAPHY_VERIFY_NONCE__')
    expect(verifier).toContain('await server.close()')
    expect(fixture).toContain('document.fonts.load(')
    expect(fixture).toContain("performance.getEntriesByType('resource')")
    expect(fixture).toContain('__SNL_TYPOGRAPHY_VERIFY_NONCE__')
    expect(fixture).toContain('cjkFontResources.length > 0')
  })

  it('copies the font stylesheet, WOFF2 files, and license into the packed public artifact', () => {
    const copier = read('scripts/copy-lib-assets.mjs')
    expect(copier).toContain("join(root, 'src/snl-react-view/fonts')")
    expect(copier).toContain("join(root, 'dist-lib/fonts')")
  })
})
