// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { instantiateSvgTemplate, parseSanitizedSvgTemplate } from './svg-template'

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
  it('accepts the SVG four-number viewBox comma-wsp grammar', () => {
    const valid = [
      '0 0 10 10',
      '-1.5, 2e1, 4.5, 6',
      '+.5,-.25,1.,2E+1',
      '\t0 ,\n0\r 10,\t10 ',
    ]
    for (const viewBox of valid) {
      expect(() => parseSanitizedSvgTemplate(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" />`,
      ), viewBox).not.toThrow()
    }
  })

  it('rejects malformed, non-finite, and non-positive viewBox values', () => {
    for (const viewBox of [
      '0 0 10', '0 0 10 10 20', 'garbage', '0 0 NaN 10', '0 0 Infinity 10',
      '0 0 0 10', '0 0 -1 10', '0 0 10 0', '0 0 10 -1',
      '0,,0,,10,,10', '0, ,0,10,10', '0 0 10 10,', ',0 0 10 10', '0 0,,10 10',
    ]) {
      expect(() => parseSanitizedSvgTemplate(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" />`,
      ), viewBox).toThrow(/viewBox/i)
    }
  })

  it('preserves xml:space in the XML namespace and rejects namespace aliases', () => {
    const parsed = parseSanitizedSvgTemplate(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
        '<text xml:space="preserve"> spaced </text>' +
      '</svg>',
    )
    const text = parsed.root.querySelector('text')!
    expect(text.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'space')).toBe('preserve')
    expect(text.getAttributeNodeNS('http://www.w3.org/XML/1998/namespace', 'space')?.name).toBe('xml:space')

    for (const source of [
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:alias="http://www.w3.org/XML/1998/namespace" viewBox="0 0 10 10"><text alias:space="preserve" /></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:evil="http://example.com/evil" viewBox="0 0 10 10"><text evil:space="preserve" /></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text xml:space="invalid" /></svg>',
    ]) {
      expect(() => parseSanitizedSvgTemplate(source)).toThrow()
    }
  })

  it('accepts only empty g elements as typed positional anchors', () => {
    for (const marker of [
      '<svg data-snl-slot="0" />',
      '<path data-snl-slot="0" />',
      '<text data-snl-slot="0" />',
      '<g data-snl-slot="0"><path d="M0 0" /></g>',
    ]) {
      expect(() => parseSanitizedSvgTemplate(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${marker}</svg>`,
      )).toThrow(/slot|anchor|empty|g/i)
    }
    const parsed = parseSanitizedSvgTemplate(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g data-snl-slot="0" /></svg>',
    )
    expect(parsed.slots[0].element.localName).toBe('g')
  })

  it('rejects CSS escapes, protocols, and unsupported style values fail-closed', () => {
    const badValues = [
      String.raw`u\72l(https://example.com/x)`,
      String.raw`url(\68ttps://example.com/x)`,
      String.raw`url(\64ata:image/svg+xml,x)`,
      String.raw`url(\66ile:///tmp/x)`,
      'data:image/svg+xml,x', 'file:///tmp/x', ' URL ( HTTPS://example.com/x ) ',
    ]
    for (const value of badValues) {
      expect(() => parseSanitizedSvgTemplate(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path fill="${value}" /></svg>`,
      ), `fill=${value}`).toThrow()
      expect(() => parseSanitizedSvgTemplate(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path style="fill:${value}" /></svg>`,
      ), `style=${value}`).toThrow()
    }
    const safe = parseSanitizedSvgTemplate(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g" /></defs><path fill="#0f0" stroke="currentColor" style="fill:url(#g); opacity:0.5" /></svg>',
    )
    expect(safe.root.querySelector('path')?.getAttribute('style')).toBe('fill:url(#g); opacity:0.5')
  })

  it('scopes root IDs and rejects root/descendant duplicates', () => {
    const parsed = parseSanitizedSvgTemplate(
      '<svg xmlns="http://www.w3.org/2000/svg" id="root" viewBox="0 0 10 10">' +
        '<defs><clipPath id="clip"><rect width="1" height="1" /></clipPath></defs>' +
        '<g clip-path="url(#root)" /><use href="#clip" />' +
      '</svg>',
    )
    const first = instantiateSvgTemplate(parsed, 'instance-a')
    const second = instantiateSvgTemplate(parsed, 'instance-b')

    expect(first.id).toBe('instance-a--root')
    expect(first.querySelector('g')?.getAttribute('clip-path')).toBe('url(#instance-a--root)')
    expect(second.id).toBe('instance-b--root')
    const allIds = [first, ...first.querySelectorAll('[id]'), second, ...second.querySelectorAll('[id]')]
      .map((node) => node.id)
    expect(new Set(allIds).size).toBe(allIds.length)

    expect(() => parseSanitizedSvgTemplate(
      '<svg xmlns="http://www.w3.org/2000/svg" id="duplicate" viewBox="0 0 10 10">' +
        '<g id="duplicate" />' +
      '</svg>',
    )).toThrow(/duplicate id/i)
  })

  it('requires every local fragment target and scopes IDs per explicit instance', () => {
    for (const reference of ['href="#missing"', 'fill="url(#missing)"', 'style="clip-path:url(#missing)"']) {
      expect(() => parseSanitizedSvgTemplate(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><use ${reference} /></svg>`,
      )).toThrow(/target|fragment|id/i)
    }
    const parsed = parseSanitizedSvgTemplate(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><clipPath id="clip"><rect width="1" height="1" /></clipPath></defs><path id="shape" clip-path="url(#clip)"/><use href="#shape" /></svg>',
    )
    const first = instantiateSvgTemplate(parsed, 'instance-a')
    const second = instantiateSvgTemplate(parsed, 'instance-b')
    expect(first.querySelector('path')?.id).toBe('instance-a--shape')
    expect(first.querySelector('path')?.getAttribute('clip-path')).toBe('url(#instance-a--clip)')
    expect(first.querySelector('use')?.getAttribute('href')).toBe('#instance-a--shape')
    expect(second.querySelector('path')?.id).toBe('instance-b--shape')
    expect(new Set([...first.querySelectorAll('[id]'), ...second.querySelectorAll('[id]')].map((node) => node.id)).size).toBe(4)
  })
})
