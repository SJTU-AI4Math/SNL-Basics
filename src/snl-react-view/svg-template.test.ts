// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { parseSanitizedSvgTemplate } from './svg-template'

describe('svg-template', () => {
  it('parses inert SVG templates and returns ordered positional slots', () => {
    const parsed = parseSanitizedSvgTemplate(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20">' +
        '<defs>' +
          '<linearGradient id="grad0"><stop offset="0%" stop-color="#0f0" /></linearGradient>' +
          '<clipPath id="clip0"><rect width="40" height="20" /></clipPath>' +
        '</defs>' +
        '<g data-snl-slot="1" transform="translate(20 0)" />' +
        '<path id="shape0" fill="url(#grad0)" clip-path="url(#clip0)" d="M0 0H40V20H0Z" />' +
        '<use href="#shape0" />' +
        '<g data-snl-slot="0" transform="translate(0 0)" />' +
      '</svg>',
    )

    expect(parsed.viewBox).toBe('0 0 40 20')
    expect(parsed.root.tagName.toLowerCase()).toBe('svg')
    expect(parsed.slots.map((slot) => slot.index)).toEqual([0, 1])
    expect(parsed.root.querySelector('#shape0')?.getAttribute('fill')).toBe('url(#grad0)')
    expect(parsed.root.querySelector('#shape0')?.getAttribute('clip-path')).toBe('url(#clip0)')
    expect(parsed.root.querySelector('use')?.getAttribute('href')).toBe('#shape0')
  })

  it('rejects active or external SVG content fail-closed', () => {
    for (const source of [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script /></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><g onclick="alert(1)" /></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><use href="javascript:alert(1)" /></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><image href="https://example.com/x.png" /></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><foreignObject /></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><animate attributeName="x" /></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path style="fill:url(https://example.com/fill.svg#x)" /></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:evil="http://example.com/evil" viewBox="0 0 1 1"><evil:g /></svg>',
    ]) {
      expect(() => parseSanitizedSvgTemplate(source)).toThrow()
    }
  })

  it('rejects javascript hrefs', () => {
    expect(() => parseSanitizedSvgTemplate(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">' +
        '<use href="javascript:alert(1)" />' +
      '</svg>',
    )).toThrow(/href/i)
  })

  it('requires an SVG root with a real viewBox', () => {
    expect(() => parseSanitizedSvgTemplate('<svg xmlns="http://www.w3.org/2000/svg"><g /></svg>'))
      .toThrow(/viewBox/i)
    expect(() => parseSanitizedSvgTemplate('<div />')).toThrow(/svg/i)
  })
})
