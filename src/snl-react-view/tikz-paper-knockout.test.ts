// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { instantiateSvgTemplate, parseSanitizedSvgTemplate } from './svg-template'

const root = dirname(fileURLToPath(import.meta.url))
const fixture = join(root, '..', '..', 'examples', 'basic-demo', 'tikz', 'generated', 'higher-category.template.svg')

describe('generated TikZ paper knockouts', () => {
  it('survive the public sanitizer with scoped local mask references', () => {
    const parsed = parseSanitizedSvgTemplate(readFileSync(fixture, 'utf8'))
    const instance = instantiateSvgTemplate(parsed, 'tikz-theme-test')
    expect(instance.querySelectorAll('mask')).toHaveLength(12)
    expect(instance.querySelectorAll('[mask]').length).toBeGreaterThanOrEqual(12)
    for (const element of instance.querySelectorAll('[mask]')) {
      expect(element.getAttribute('mask')).toMatch(/^url\(#tikz-theme-test--snl-paper-knockout-\d+\)$/)
    }
  })
})
