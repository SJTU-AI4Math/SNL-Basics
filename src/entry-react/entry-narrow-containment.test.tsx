// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { MacroDataDriver } from '../snl-macro/macro-data-driver'
import { EntryDataDriver, type EntryData } from './entry-data-driver'
import { EntrySurface } from './entry-render'

const macroDriver = new MacroDataDriver({ queries: { query_macro: async () => null } })
const entryDriver = new EntryDataDriver({ queries: {
  query_entry: async () => null,
  query_entry_kind: async () => null,
} })
const entry = (content: EntryData['content'], extra: Partial<EntryData> = {}): EntryData => ({
  id: 'entry-with-an-uninterrupted-identifier'.repeat(5),
  kind: 'definition',
  title: 'T'.repeat(200),
  content,
  ...extra,
})

describe('Entry narrow-width containment contract', () => {
  it('constrains the root, header, title, source action, and body boxes', () => {
    const view = render(<EntrySurface entry={entry({ text: 'body' }, { pointer: {} })} kind={null} entry_data_driver={entryDriver} macro_data_driver={macroDriver} />)
    const root = view.container.querySelector<HTMLElement>('section')!
    const header = view.container.querySelector<HTMLElement>('.snl-entry-header')!
    const title = view.container.querySelector<HTMLElement>('.snl-entry-title')!
    const source = view.getByRole('button', { name: /source/i })
    const body = view.container.querySelector<HTMLElement>('[data-entry-body]')!

    expect(root.style.boxSizing).toBe('border-box')
    expect(root.style.maxWidth).toBe('100%')
    expect(root.style.minWidth).toBe('0px')
    expect(header.style.minWidth).toBe('0px')
    expect(title.style.minWidth).toBe('0px')
    expect(title.style.overflowWrap).toBe('anywhere')
    expect(source.style.flexShrink).toBe('0')
    expect(body.style.minWidth).toBe('0px')
    expect(body.style.maxWidth).toBe('100%')
    expect(body.style.overflowX).toBe('auto')
  })

  it.each(['text', 'typst'] as const)('wraps whitespace-free direct %s content', (surface) => {
    const view = render(<EntrySurface entry={entry({ [surface]: 'x'.repeat(200) })} kind={null} entry_data_driver={entryDriver} macro_data_driver={macroDriver} />)
    const pre = view.container.querySelector<HTMLPreElement>('pre')!
    expect(pre.style.whiteSpace).toBe('pre-wrap')
    expect(pre.style.overflowWrap).toBe('anywhere')
    expect(pre.style.wordBreak).toBe('break-word')
    expect(pre.style.maxWidth).toBe('100%')
    expect(pre.style.minWidth).toBe('0px')
  })

  it('keeps emergency prose wrapping separate from intrinsic math/code scrolling', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/entry-react/style.css'), 'utf8')
    expect(css).toMatch(/\.snl-markdown-body[^{}]*\{[^}]*overflow-wrap:\s*anywhere/s)
    expect(css).toMatch(/\.snl-markdown-body pre[^{}]*\{[^}]*white-space:\s*pre[^}]*overflow-x:\s*auto/s)
    expect(css).toMatch(/\.snl-markdown-body code[^{}]*\{[^}]*overflow-wrap:\s*normal/s)
    expect(css).toMatch(/\.snl-latex-body[^{}]*\{[^}]*overflow-x:\s*auto/s)
    expect(css).toMatch(/\.snl-markdown-body img[^{}]*\{[^}]*max-width:\s*100%/s)
    expect(css).toMatch(/\[data-entry-body\] \.snl-text[^{}]*\{[^}]*overflow-wrap:\s*anywhere/s)
    expect(css).toMatch(/\[data-entry-body\] \.snl-text \.snl-math-span[^{}]*\{[^}]*overflow-wrap:\s*normal/s)
    expect(css).toMatch(/\[data-entry-body\] \.katex-panel[^{}]*\{[^}]*overflow-x:\s*auto/s)
  })
})
