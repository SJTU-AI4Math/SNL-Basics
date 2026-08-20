import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { extractTemplate } from './build-tikz-assets.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const generated = join(here, '..', 'tikz', 'generated')

function fullSvg(artwork) {
  const formulas = Array.from({ length: 9 }, (_, index) =>
    `<g data-snl-formula='${index}'>\n<g transform='translate(0 0)'><path d='M0 0'/></g>\n</g>\n` +
    `<g data-snl-anchor='${index}' data-snl-bbox='${index} ${index} 2 2'/>`,
  ).join('\n')
  return `<svg viewBox='0 0 100 100'><g id='page1'>${artwork}${formulas}</g></svg>`
}

describe('TikZ white-paper postprocessing', () => {
  it('preserves black A -> white fill/stroke erase -> later black B painter order', () => {
    const template = extractTemplate(fullSvg([
      `<path data-paint='A' d='M0 0H40V40H0Z' fill='#000'/>`,
      `<path data-paint='white-fill' d='M10 10H30V30H10Z' fill='#fff'/>`,
      `<path data-paint='white-stroke' d='M0 20H40' fill='none' stroke='#ffffff' stroke-width='4'/>`,
      `<path data-paint='B' d='M20 0V40' fill='none' stroke='rgb(0,0,0)' stroke-width='2'/>`,
    ].join('\n')))

    expect(template).not.toMatch(/data-paint="white-(?:fill|stroke)"[^>]*(?:fill|stroke)="(?:#fff(?:fff)?|white|rgb\(255,\s*255,\s*255\))"/i)
    expect(template.match(/<mask id="snl-paper-knockout-\d+"/g)).toHaveLength(2)
    expect(template).toContain('data-paint="A"')
    expect(template).toContain('data-paint="B"')
    expect(template.match(/currentColor/g)?.length).toBeGreaterThanOrEqual(2)

    const artwork = template.slice(template.indexOf('</defs>') + 7, template.indexOf('<g data-snl-slot="0"'))
    const b = artwork.indexOf('data-paint="B"')
    const finalMaskClose = artwork.lastIndexOf('</g>', b)
    expect(finalMaskClose).toBeGreaterThan(artwork.indexOf('data-paint="A"'))
    expect(b).toBeGreaterThan(finalMaskClose)
  })

  it('turns the generated fixture nine white fills and three white strokes into ordered knockouts', () => {
    const full = readFileSync(join(generated, 'higher-category.full.svg'), 'utf8')
    const template = extractTemplate(full)
    expect(full.match(/fill='#fff'/g)).toHaveLength(9)
    expect(full.match(/stroke='#fff'/g)).toHaveLength(3)
    expect(template.match(/<mask id="snl-paper-knockout-\d+"/g)).toHaveLength(12)
    const ordinaryArtwork = template.replace(/<defs>[\s\S]*?<\/defs>/, '')
    expect(ordinaryArtwork).not.toMatch(/(?:fill|stroke)="(?:#fff(?:fff)?|white|rgb\(255,\s*255,\s*255\))"/i)
    expect(ordinaryArtwork).not.toMatch(/(?:fill|stroke)="#000(?:000)?"/i)
    expect(ordinaryArtwork).toContain('currentColor')
  })
})
