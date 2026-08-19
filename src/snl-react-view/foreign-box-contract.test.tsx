// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { MacroDataDriver } from '../snl-macro/macro-data-driver'
import type { SnlMacroRecord } from '../snl-macro/types'
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'
import { resolveRootLatex } from './render-source'
import { bindSvgTemplateChildren, parseSanitizedSvgTemplate } from './svg-template'

function driver(db: SnlMacroRecord): MacroDataDriver {
  return new MacroDataDriver({
    queries: {
      async query_macro({ macro_name }) {
        return db[macro_name] ?? null
      },
    },
  })
}

describe('foreign rendered subtree contracts', () => {
  it('preserves ordinary SVG fragment syntax instead of treating it as Macro placeholders', () => {
    const parsed = parseSanitizedSvgTemplate(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
        '<defs><clipPath id="clip0"><rect width="10" height="10" /></clipPath></defs>' +
        '<path id="path0" fill="#0f0" clip-path="url(#clip0)" d="M0 0L10 10" />' +
        '<use href="#path0" />' +
      '</svg>',
    )

    expect(parsed.viewBox).toBe('0 0 10 10')
    expect(parsed.slots).toEqual([])
    expect(parsed.root.querySelector('path')?.getAttribute('fill')).toBe('#0f0')
    expect(parsed.root.querySelector('path')?.getAttribute('clip-path')).toBe('url(#clip0)')
    expect(parsed.root.querySelector('use')?.getAttribute('href')).toBe('#path0')
  })

  it('rejects invalid fixed SVG slot sets', () => {
    for (const source of [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g data-snl-slot="0" /><g data-snl-slot="0" /></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g data-snl-slot="1" /></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g data-snl-slot="-1" /></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g data-snl-slot="1.5" /></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g data-snl-slot="0" /><g data-snl-slot="2" /></svg>',
    ]) {
      expect(() => parseSanitizedSvgTemplate(source)).toThrow(/slot/i)
    }
  })

  it('keeps SVG slot children as live SNL subtrees passed through renderChild', () => {
    const parsed = parseSanitizedSvgTemplate(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
        '<g data-snl-slot="0" /><g data-snl-slot="1" />' +
      '</svg>',
    )
    const child0: SnlSyntaxTree = { macro_name: 'left', kind: '', mdata: null, children: [] }
    const child1: SnlSyntaxTree = { macro_name: 'right', kind: '', mdata: null, children: [] }
    const seen: SnlSyntaxTree[] = []
    const rendered = bindSvgTemplateChildren(parsed, [child0, child1], (child) => {
      seen.push(child)
      return { child }
    })

    expect(seen).toEqual([child0, child1])
    expect(rendered.map(({ slot }) => slot.index)).toEqual([0, 1])
    expect(rendered[0].rendered).toBe(rendered[0].rendered)
    expect(rendered[0].rendered).toEqual({ child: child0 })
    expect(rendered[1].rendered).toEqual({ child: child1 })
  })

  it('keeps the current visible block-in-formula fallback', async () => {
    const db: SnlMacroRecord = {
      sum: {
        name: 'sum',
        description: '',
        source: { entries: [], urls: [] },
        kind: 'const',
        dynamic_arity: false,
        tags: [],
        styles: [{ style_name: 'default', tags: [], template: { mode: 'formula_inline', body: '#0 + #1' } }],
      },
      panel: {
        name: 'panel',
        description: '',
        source: { entries: [], urls: [] },
        kind: 'const',
        dynamic_arity: true,
        tags: [],
        styles: [{ style_name: 'default', tags: [], template: { mode: 'block', body: '#*' } }],
      },
    }
    const latex = await resolveRootLatex(
      {
        macro_name: 'sum',
        kind: '',
        mdata: null,
        children: [
          { macro_name: 'x', kind: '', mdata: null, children: [] },
          { macro_name: 'panel', kind: '', mdata: null, children: [{ macro_name: 'y', kind: '', mdata: null, children: [] }] },
        ],
      },
      driver(db),
    )

    expect(latex).toContain("block macro `panel` cannot be used inside a formula")
  })
})
