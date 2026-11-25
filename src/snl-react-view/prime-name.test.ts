// @vitest-environment jsdom
import katex from 'katex'
import { describe, expect, it } from 'vitest'
import { HTMLDATA_KATEX_DEFAULTS } from './katex-defaults'
import { wrapHtmlData } from './render-source'

describe("macro names with a Lean prime", () => {
  it("survive \\htmlData and come out escaped in the attribute", () => {
    const latex = wrapHtmlData({ macro_name: "Stream'.cons", kind: 'const', children: [] }, 'x', null)
    expect(latex).toContain("name=Stream'.cons")
    const html = katex.renderToString(latex, { ...HTMLDATA_KATEX_DEFAULTS, throwOnError: true })
    expect(html).toContain('data-name="Stream&#x27;.cons"')
    const el = document.createElement('div')
    el.innerHTML = html
    expect(el.querySelector('[data-name]')?.getAttribute('data-name')).toBe("Stream'.cons")
  })
})
