// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { MacroDataDriver } from '../snl-macro/macro-data-driver'
import { ReaderRuntime, type I18n } from '../runtime'
import { EntryDataDriver, type EntryData } from './entry-data-driver'
import { EntrySurface, EntryView, EntryPreviewProvider, titleToKatexSource } from './entry-render'

const macroDriver = new MacroDataDriver({ queries: { query_macro: async () => null } })
const base = (content: EntryData['content'], extra: Partial<EntryData> = {}): EntryData => ({ id: 'e', kind: 'definition', title: 'Ring $R$', content, ...extra })
const dataDriver = (entries: Record<string, EntryData | undefined> = {}) => new EntryDataDriver({ queries: {
  query_entry: async ({ entry_id, signal }) => { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError'); return entries[entry_id] ?? null },
  query_entry_kind: async () => ({ id: 'definition', name: 'Definition', coloring: { stroke: '#123456', background: 'transparent' } }),
} })

afterEach(cleanup)

describe('Entry surface dispatch', () => {
  it('renders localized non-SNL content through the injected Reader runtime', () => {
    const markdown: I18n<string, string> = {
      type: 'i18n',
      default_language: 'en',
      values: { en: '**Group**', 'zh-CN': '**群**' },
    }
    const runtime = new ReaderRuntime({
      queries: { query_environment: () => ({ language: 'zh-CN' }) },
    })
    const view = render(<EntrySurface entry={base({ markdown })} kind={null} entry_data_driver={dataDriver()} macro_data_driver={macroDriver} reader_runtime={runtime} />)
    expect(view.container.querySelector('.snl-markdown-body strong')?.textContent).toBe('群')
  })

  it('rewrites Markdown image sources through the consumer image resolver', () => {
    const resolveImage = vi.fn((src: string) => `vscode-resource:${src}`)
    const view = render(<EntrySurface entry={base({ markdown: '![diagram](assets/proof.png)' })} kind={null} entry_data_driver={dataDriver()} macro_data_driver={macroDriver} markdown_image_url_transform={resolveImage} />)
    const image = view.getByRole('img', { name: 'diagram' })
    expect(image.getAttribute('src')).toBe('vscode-resource:assets/proof.png')
    expect(resolveImage).toHaveBeenCalledWith('assets/proof.png')
  })

  it('renders a localization error instead of throwing for malformed content', () => {
    const markdown: I18n<string, string> = {
      type: 'i18n',
      default_language: 'en',
      values: {},
    }
    const runtime = new ReaderRuntime({
      queries: { query_environment: () => ({ language: 'en' }) },
    })
    const view = render(<EntrySurface entry={base({ markdown })} kind={null} entry_data_driver={dataDriver()} macro_data_driver={macroDriver} reader_runtime={runtime} />)
    expect(view.getByRole('alert').textContent).toMatch(/localization error.*no values/i)
  })

  it('uses SNL > Markdown > LaTeX > text priority', async () => {
    const view = render(<EntrySurface entry={base({ snl: '%SNL wins%', markdown: '**Markdown**', latex: 'L', text: 'T' })} kind={null} entry_data_driver={dataDriver()} macro_data_driver={macroDriver} />)
    await waitFor(() => expect(view.container.textContent).toContain('SNL wins'))
    expect(view.container.querySelector('.snl-markdown-body')).toBeNull()
    view.rerender(<EntrySurface entry={base({ markdown: '**Markdown**', latex: 'L', text: 'T' })} kind={null} entry_data_driver={dataDriver()} macro_data_driver={macroDriver} />)
    await waitFor(() => expect(view.container.querySelector('.snl-markdown-body strong')?.textContent).toBe('Markdown'))
    view.rerender(<EntrySurface entry={base({ latex: 'x^2', text: 'T' })} kind={null} entry_data_driver={dataDriver()} macro_data_driver={macroDriver} />)
    expect(view.container.querySelector('.snl-latex-body .katex')).not.toBeNull()
    view.rerender(<EntrySurface entry={base({ text: 'plain' })} kind={null} entry_data_driver={dataDriver()} macro_data_driver={macroDriver} />)
    expect(view.container.querySelector('pre')?.textContent).toBe('plain')
  })

  it('renders header only for empty content and exposes title/source interactions', () => {
    const title = vi.fn(); const source = vi.fn()
    const view = render(<EntrySurface entry={base({}, { pointer: { downstream: true } })} kind={null} entry_data_driver={dataDriver()} macro_data_driver={macroDriver} interaction_ports={{ on_title_activate: title, on_source_activate: source }} />)
    expect(view.container.querySelector('[data-entry-body]')).toBeNull()
    fireEvent.click(view.container.querySelector('strong')!); fireEvent.click(view.getByRole('button', { name: /source/i }))
    expect(title).toHaveBeenCalledWith('e', expect.anything())
    expect(source).toHaveBeenCalledWith(base({}, { pointer: { downstream: true } }).pointer, 'e', expect.anything())
  })

  it('only shows title activation affordances while Ctrl is held over the title', () => {
    const view = render(<EntrySurface entry={base({})} kind={{ id: 'definition', name: 'Definition', coloring: { stroke: '#123456', background: '#eeeeee' } }} entry_data_driver={dataDriver()} macro_data_driver={macroDriver} interaction_ports={{ on_title_activate: vi.fn() }} />)
    const section = view.container.querySelector('section')!
    const title = view.container.querySelector('strong')!

    fireEvent.mouseEnter(title)
    expect((title as HTMLElement).style.cursor).not.toBe('pointer')
    expect((section as HTMLElement).style.background).toBe('rgb(238, 238, 238)')

    fireEvent.keyDown(window, { key: 'Control', ctrlKey: true })
    expect((title as HTMLElement).style.cursor).toBe('pointer')
    expect((section as HTMLElement).style.background).toBe('rgb(243, 244, 246)')

    fireEvent.keyUp(window, { key: 'Control' })
    expect((title as HTMLElement).style.cursor).not.toBe('pointer')
    expect((section as HTMLElement).style.background).toBe('rgb(238, 238, 238)')
  })

  it('shows parse errors and original SNL source', () => {
    const view = render(<EntrySurface entry={base({ snl: '{broken' })} kind={null} entry_data_driver={dataDriver()} macro_data_driver={macroDriver} />)
    expect(view.container.textContent).toMatch(/SNL parse error/i)
    expect(view.container.textContent).toContain('{broken')
  })

  it('renders title prose with math islands and kind surface colors', () => {
    expect(titleToKatexSource('Ring $R$')).toContain('\\text{Ring }R')
    expect(titleToKatexSource(String.raw`cost \$5 $$ raw $x$`)).toContain(String.raw`\text{cost \$5 \$\$ raw }x`)
    expect(titleToKatexSource('unbalanced $x')).toContain(String.raw`\text{unbalanced \$x}`)
    expect(titleToKatexSource('A&B_{x}')).toBe(String.raw`\text{A\&B\_\{x\}}`)
    const view = render(<EntrySurface entry={base({ text: 'body' })} kind={{ id: 'definition', name: 'Definition', coloring: { stroke: '#123456', background: '#eeeeee' } }} entry_data_driver={dataDriver()} macro_data_driver={macroDriver} counter_label="1.2" />)
    const section = view.container.querySelector('section')!
    expect(section.getAttribute('style')).toContain('rgb(18, 52, 86)')
    expect(view.container.querySelector('[data-entry-body]')?.getAttribute('style')).toContain('color: rgb(17, 17, 17)')
    expect(view.container.textContent).toContain('Definition 1.2')
    expect(view.container.querySelector('.katex')).not.toBeNull()
  })

  it('treats whitespace-only bodies as empty and preserves literal kind colors', () => {
    const view = render(<EntrySurface entry={base({ snl: '  ', markdown: '\n', latex: '\t', text: ' ' })} kind={{ id: 'custom', name: 'Custom', coloring: { stroke: 'rebeccapurple', background: 'transparent' } }} entry_data_driver={dataDriver()} macro_data_driver={macroDriver} />)
    expect(view.container.querySelector('[data-entry-body]')).toBeNull()
    expect(view.container.querySelector('section')?.getAttribute('style')).toContain('rebeccapurple')
    expect(view.container.querySelector('section')?.getAttribute('style')).toContain('transparent')
  })

  it('preserves neutral and theme-aware Entry color fallbacks', () => {
    const neutral = render(<EntrySurface entry={base({})} kind={null} entry_data_driver={dataDriver()} macro_data_driver={macroDriver} />)
    expect(neutral.container.querySelector('section')?.getAttribute('style')).toContain('rgb(238, 238, 238)')
    neutral.unmount()

    const themed = render(<EntrySurface entry={base({})} kind={{ id: 'custom', name: 'Custom', coloring: { stroke: '', background: '' } }} entry_data_driver={dataDriver()} macro_data_driver={macroDriver} />)
    const style = themed.container.querySelector('section')?.getAttribute('style') ?? ''
    expect(style).toContain('var(--vscode-editor-foreground, #ddd)')
    expect(style).toContain('background: transparent')
  })

  it('resolves context-bound variables through EntryDataDriver before rendering SNL', async () => {
    const entries = dataDriver({ ctx: base({ snl: '@x' }, { id: 'ctx', kind: 'context' }) })
    const view = render(<EntrySurface entry={base({ snl: 'x@ctx' })} kind={null} entry_data_driver={entries} macro_data_driver={macroDriver} />)
    await waitFor(() => expect(view.container.querySelector('[data-kind="bvar"]')).not.toBeNull())
  })

  it('removes stale context annotations when the EntryDataDriver changes', async () => {
    const sourceEntry = base({ snl: 'x@ctx' })
    const declaring = dataDriver({ ctx: base({ snl: '@x' }, { id: 'ctx', kind: 'context' }) })
    const view = render(<EntrySurface entry={sourceEntry} kind={null} entry_data_driver={declaring} macro_data_driver={macroDriver} />)
    await waitFor(() => expect(view.container.querySelector('[data-kind="bvar"]')).not.toBeNull())

    const noLongerDeclaring = dataDriver({ ctx: base({ snl: '@y' }, { id: 'ctx', kind: 'context' }) })
    view.rerender(<EntrySurface entry={sourceEntry} kind={null} entry_data_driver={noLongerDeclaring} macro_data_driver={macroDriver} />)
    await waitFor(() => expect(view.container.querySelector('[data-kind="fvar"]')).not.toBeNull())
    expect(view.container.querySelector('[data-kind="bvar"]')).toBeNull()
  })
})

describe('EntryView query lifecycle', () => {
  it('loads an entry and its kind through the driver', async () => {
    const view = render(<EntryView entry_id="e" entry_data_driver={dataDriver({ e: base({ text: 'loaded' }) })} macro_data_driver={macroDriver} />)
    expect(view.container.textContent).toMatch(/Loading/i)
    await waitFor(() => expect(view.container.textContent).toContain('loaded'))
  })

  it('renders query errors and never shows a previous driver after swapping', async () => {
    const old = dataDriver({ e: base({ text: 'old backend' }) })
    const view = render(<EntryView entry_id="e" entry_data_driver={old} macro_data_driver={macroDriver} />)
    await waitFor(() => expect(view.container.textContent).toContain('old backend'))
    const pending = new EntryDataDriver({ queries: { query_entry: () => new Promise(() => {}), query_entry_kind: async () => null } })
    view.rerender(<EntryView entry_id="e" entry_data_driver={pending} macro_data_driver={macroDriver} />)
    expect(view.container.textContent).toMatch(/Loading/i)
    expect(view.container.textContent).not.toContain('old backend')
    const failing = new EntryDataDriver({ queries: { query_entry: async () => { throw new Error('entry backend offline') }, query_entry_kind: async () => null } })
    view.rerender(<EntryView entry_id="e" entry_data_driver={failing} macro_data_driver={macroDriver} />)
    await waitFor(() => expect(view.container.textContent).toContain('entry backend offline'))
  })

  it('aborts work on unmount', async () => {
    let signal: AbortSignal | undefined
    const pending = new EntryDataDriver({ queries: { query_entry: ({ signal: s }) => { signal = s; return new Promise(() => {}) }, query_entry_kind: async () => null } })
    const view = render(<EntryView entry_id="e" entry_data_driver={pending} macro_data_driver={macroDriver} />)
    await waitFor(() => expect(signal).toBeDefined())
    view.unmount(); expect(signal!.aborted).toBe(true)
  })
})

describe('recursive Entry preview', () => {
  it('queries and renders a referenced Entry in a generic popover', async () => {
    const refMacroDriver = new MacroDataDriver({ queries: { query_macro: async ({ macro_name }) => macro_name === 'ref' ? {
      name: 'ref', description: '', source: { entries: ['child'], urls: [] }, dynamic_arity: false, tags: [],
      styles: [{ style_name: 'default', tag: 'default', mode: 'formula_inline', template: '\\text{reference}', tags: [] }],
    } : null } })
    const entries = dataDriver({
      root: base({ snl: 'ref' }, { id: 'root', title: 'Root' }),
      child: base({ text: 'recursive child body' }, { id: 'child', title: 'Child' }),
    })
    const view = render(<EntryPreviewProvider entry_data_driver={entries} macro_data_driver={refMacroDriver} options={{ openDelayMs: 0, fadeMs: 0 }}><EntryView entry_id="root" entry_data_driver={entries} macro_data_driver={refMacroDriver} /></EntryPreviewProvider>)
    const target = await waitFor(() => {
      const found = view.container.querySelector<HTMLElement>('[data-name="ref"]')
      expect(found).not.toBeNull()
      return found!
    })
    const original = document.elementsFromPoint
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [target] })
    try {
      fireEvent.mouseMove(target, { clientX: 12, clientY: 14 })
      await waitFor(() => expect(document.body.textContent).toContain('recursive child body'))
    } finally {
      Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: original })
    }
  })
})
