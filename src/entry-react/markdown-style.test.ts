import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/entry-react/style.css'), 'utf8')

function declarations(selector: string): Map<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...css.matchAll(new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)}`, 'g'))]
  expect(matches, `one rule for ${selector}`).toHaveLength(1)
  return new Map(matches[0][1].split(';').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const colon = entry.indexOf(':')
    return [entry.slice(0, colon).trim(), entry.slice(colon + 1).trim()]
  }))
}

describe('public Markdown stylesheet', () => {
  it('defines host-aware prose and code font stacks', () => {
    expect(declarations('.snl-markdown-body').get('font-family')).toContain('--vscode-font-family')
    expect(declarations('.snl-markdown-body').get('line-height')).toBe('1.6')
    expect(declarations('.snl-markdown-body').get('overflow-x')).toBe('auto')
    const code = declarations('.snl-markdown-body code')
    expect(code.get('font-family')).toContain('--vscode-editor-font-family')
    expect(code.get('font-variant-ligatures')).toBe('none')
    expect(code.get('tab-size')).toBe('2')
  })

  it('styles the complete structural Markdown surface', () => {
    for (const selector of [
      '.snl-markdown-body h1',
      '.snl-markdown-body blockquote',
      '.snl-markdown-body a',
      '.snl-markdown-body hr',
      '.snl-markdown-body :not(pre) > code',
      '.snl-markdown-body pre',
      '.snl-markdown-body table',
      '.snl-markdown-body input[type="checkbox"]',
    ]) {
      expect(declarations(selector).size, selector).toBeGreaterThan(0)
    }
  })

  it('keeps dark muted code text above WCAG AA contrast in the built-in dark surface', () => {
    const dark = declarations('.snl-markdown-body[data-color-scheme="dark"]')
    const colors = [
      dark.get('--snl-md-muted'),
      dark.get('--snl-md-comment'),
      dark.get('--snl-md-addition'),
      dark.get('--snl-md-deletion'),
    ].map((value) => value?.match(/#[0-9a-f]{6}/i)?.[0])
    for (const color of colors) expect(color).toMatch(/^#[0-9a-f]{6}$/i)
    const luminance = (hex: string): number => {
      const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
        .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
    }
    const background = luminance('#313131')
    for (const color of colors) {
      const foreground = luminance(color!)
      const contrast = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
      expect(contrast, color).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('wires emitted diff token classes to the contrast-checked palette', () => {
    expect(declarations('.snl-markdown-body .hljs-addition').get('color')).toBe('var(--snl-md-addition)')
    expect(declarations('.snl-markdown-body .hljs-deletion').get('color')).toBe('var(--snl-md-deletion)')
  })

  it('provides light and dark token palettes for every emitted core token family', () => {
    const families = ['keyword', 'built_in', 'type', 'literal', 'comment', 'string', 'number', 'meta', 'title', 'attr', 'variable', 'symbol']
    for (const family of families) {
      expect(css).toContain(`.hljs-${family}`)
    }
    expect(css).toContain('.snl-markdown-body[data-color-scheme="light"]')
    expect(css).toContain('.snl-markdown-body[data-color-scheme="dark"]')
  })
})
