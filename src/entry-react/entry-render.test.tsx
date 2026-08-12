// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { MacroDataDriver } from '../snl-macro/macro-data-driver'
import { ReaderRuntime, type I18n } from '../runtime'
import { EntryDataDriver, type EntryData, type EntryKind } from './entry-data-driver'
import { EntrySurface, EntryView, EntryPreviewProvider, titleToKatexSource } from './entry-render'
import { HoverPopoverDismissController, type HoverPopoverDismissRequest } from '../snl-react-view/popover-dismiss-controller'

const macroDriver = new MacroDataDriver({ queries: { query_macro: async () => null } })
const base = (content: EntryData['content'], extra: Partial<EntryData> = {}): EntryData => ({ id: 'e', kind: 'definition', title: 'Ring $R$', content, ...extra })
const dataDriver = (entries: Record<string, EntryData | undefined> = {}) => new EntryDataDriver({ queries: {
  query_entry: async ({ entry_id, signal }) => { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError'); return entries[entry_id] ?? null },
  query_entry_kind: async () => ({ id: 'definition', name: 'Definition', coloring: { light: { stroke: '#123456', background: 'transparent' }, dark: { stroke: '#123456', background: 'transparent' } } }),
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

  it('resolves an Entry Kind localized name through the live Reader runtime', () => {
    let language = 'zh-CN'
    const runtime = new ReaderRuntime({
      queries: { query_environment: () => ({ language }) },
    })
    const kind: EntryKind = {
      id: 'definition',
      name: {
        type: 'i18n',
        default_language: 'en',
        values: { en: 'Definition', 'zh-CN': '定义' },
      },
      description: {
        type: 'i18n',
        default_language: 'en',
        values: { en: 'Introduces a term.', 'zh-CN': '引入一个术语。' },
      },
    }
    const props = {
      entry: base({ text: 'body' }), kind,
      entry_data_driver: dataDriver(), macro_data_driver: macroDriver,
      reader_runtime: runtime,
    }
    const view = render(<EntrySurface {...props} />)
    expect(view.container.textContent).toContain('定义')
    expect(view.container.textContent).not.toContain('Definition')

    language = 'en'
    view.rerender(<EntrySurface {...props} />)
    expect(view.container.textContent).toContain('Definition')
    expect(view.container.textContent).not.toContain('定义')
  })

  it('does not consult ReaderRuntime for legacy scalar Kind labels', () => {
    const runtime = new ReaderRuntime({
      queries: { query_environment: () => { throw new Error('environment unavailable') } },
    })
    const view = render(<EntrySurface
      entry={base({ text: 'body' })}
      kind={{ id: 'definition', name: 'Definition', description: 'A term.' }}
      entry_data_driver={dataDriver()}
      macro_data_driver={macroDriver}
      reader_runtime={runtime}
    />)
    expect(view.container.textContent).toContain('Definition')
  })

  it('does not resolve an unused localized description while rendering a scalar Kind name', () => {
    const view = render(<EntrySurface
      entry={base({ text: 'body' })}
      kind={{
        id: 'definition',
        name: 'Definition',
        description: {
          type: 'i18n', default_language: 'en',
          values: { en: 'A term.', 'zh-CN': '一个术语。' },
        },
      }}
      entry_data_driver={dataDriver()}
      macro_data_driver={macroDriver}
    />)
    expect(view.container.textContent).toContain('Definition')
  })

  it('falls back to the semantic Kind id for an empty localized name map', () => {
    const runtime = new ReaderRuntime({
      queries: { query_environment: () => ({ language: 'en' }) },
    })
    const view = render(<EntrySurface
      entry={base({ text: 'body' })}
      kind={{
        id: 'definition',
        name: { type: 'i18n', default_language: 'en', values: {} },
      }}
      entry_data_driver={dataDriver()}
      macro_data_driver={macroDriver}
      reader_runtime={runtime}
    />)
    expect(view.container.textContent).toContain('definition')
  })

  it('falls back to the semantic Kind id when a localized name map has only undefined values', () => {
    const runtime = new ReaderRuntime({
      queries: { query_environment: () => ({ language: 'en' }) },
    })
    const view = render(<EntrySurface
      entry={base({ text: 'body' })}
      kind={{
        id: 'definition',
        name: { type: 'i18n', default_language: 'en', values: { en: undefined } },
      }}
      entry_data_driver={dataDriver()}
      macro_data_driver={macroDriver}
      reader_runtime={runtime}
    />)
    expect(view.container.textContent).toContain('definition')
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
    const view = render(<EntrySurface entry={base({})} kind={{ id: 'definition', name: 'Definition', coloring: { light: { stroke: '#123456', background: '#eeeeee' }, dark: { stroke: '#123456', background: '#eeeeee' } } }} entry_data_driver={dataDriver()} macro_data_driver={macroDriver} interaction_ports={{ on_title_activate: vi.fn() }} />)
    const title = view.container.querySelector('strong')!

    fireEvent.mouseEnter(title)
    expect((title as HTMLElement).style.cursor).not.toBe('pointer')

    fireEvent.keyDown(window, { key: 'Control', ctrlKey: true })
    expect((title as HTMLElement).style.cursor).toBe('pointer')

    fireEvent.keyUp(window, { key: 'Control' })
    expect((title as HTMLElement).style.cursor).not.toBe('pointer')
  })

  it('restores the Entry Block white hard-edge glow and uses light gray while Ctrl-hovered', () => {
    const view = render(<EntrySurface entry={base({ text: 'body' })} kind={{ id: 'definition', name: 'Definition', coloring: { light: { stroke: '#123456', background: '#eeeeee' }, dark: { stroke: '#123456', background: '#eeeeee' } } }} entry_data_driver={dataDriver()} macro_data_driver={macroDriver} />)
    const section = view.container.querySelector('section') as HTMLElement

    expect((section as HTMLElement).style.background).toBe('rgb(238, 238, 238)')
    expect(section.style.boxShadow).toBe('none')

    fireEvent.pointerEnter(section)
    expect(section.style.background).toBe('rgb(255, 255, 255)')
    expect(section.style.boxShadow).toBe('inset 0 0 0 5px #123456')

    fireEvent.keyDown(window, { key: 'Control', ctrlKey: true })
    expect(section.style.background).toBe('rgb(243, 244, 246)')
    expect(section.style.boxShadow).toBe('inset 0 0 0 5px #123456')

    fireEvent.keyUp(window, { key: 'Control' })
    expect(section.style.background).toBe('rgb(255, 255, 255)')

    fireEvent.pointerLeave(section)
    expect(section.style.background).toBe('rgb(238, 238, 238)')
    expect(section.style.boxShadow).toBe('none')

    fireEvent.keyDown(window, { key: 'Control', ctrlKey: true })
    fireEvent.pointerEnter(section)
    expect(section.style.background).toBe('rgb(243, 244, 246)')
    fireEvent.keyUp(window, { key: 'Control' })
  })

  it('exposes customizable Entry Block hover, Ctrl-hover, and Ctrl-click events', () => {
    const hover = vi.fn(); const ctrlHover = vi.fn(); const ctrlClick = vi.fn()
    const view = render(<EntrySurface entry={base({})} kind={null} entry_data_driver={dataDriver()} macro_data_driver={macroDriver} interaction_ports={{ on_block_hover: hover, on_block_ctrl_hover: ctrlHover, on_block_ctrl_click: ctrlClick }} />)
    const section = view.container.querySelector('section')!
    fireEvent.pointerEnter(section)
    fireEvent.pointerLeave(section)
    fireEvent.keyDown(window, { key: 'Control', ctrlKey: true })
    fireEvent.pointerEnter(section)
    fireEvent.click(section, { ctrlKey: true })
    expect(hover).toHaveBeenCalledWith(expect.objectContaining({ entry: expect.objectContaining({ id: 'e' }), ctrl_key: false }))
    expect(ctrlHover).toHaveBeenCalledWith(expect.objectContaining({ entry: expect.objectContaining({ id: 'e' }), ctrl_key: true }))
    expect(ctrlClick).toHaveBeenCalledWith(expect.objectContaining({ entry: expect.objectContaining({ id: 'e' }), ctrl_key: true }), expect.anything())
  })

  it('isolates synchronous throws and rejected thenables from Entry Block callbacks', async () => {
    const then = vi.fn((_resolve: unknown, reject: (reason: unknown) => void) => reject(new Error('later')))
    const view = render(<EntrySurface entry={base({})} kind={null} entry_data_driver={dataDriver()} macro_data_driver={macroDriver} interaction_ports={{
      on_block_hover: () => { throw new Error('sync') },
      on_block_ctrl_click: (() => ({ then })) as never,
    }} />)
    const section = view.container.querySelector('section')!
    expect(() => fireEvent.pointerEnter(section)).not.toThrow()
    expect(() => fireEvent.click(section, { ctrlKey: true })).not.toThrow()
    await Promise.resolve()
    expect(then).toHaveBeenCalled()
  })

  it('selects Entry Kind colors through the Entry driver context reader', () => {
    const driver = new EntryDataDriver({
      queries: { query_entry: async () => null, query_entry_kind: async () => null },
      context_reader: () => ({ color_scheme: 'dark' }),
    })
    const kind = { id: 'definition', name: 'Definition', coloring: {
      light: { stroke: '#111111', background: '#eeeeee' },
      dark: { stroke: '#abcdef', background: '#123456' },
    } }
    const view = render(<EntrySurface entry={base({})} kind={kind} entry_data_driver={driver} macro_data_driver={macroDriver} />)
    const style = view.container.querySelector('section')?.getAttribute('style') ?? ''
    expect(style).toContain('rgb(171, 205, 239)')
    expect(style).toContain('rgb(18, 52, 86)')
  })

  it('uses light body text in a dark Entry render context', () => {
    const driver = new EntryDataDriver({
      queries: { query_entry: async () => null, query_entry_kind: async () => null },
      context_reader: () => ({ color_scheme: 'dark' }),
    })
    const kind = { id: 'definition', name: 'Definition', coloring: {
      light: { stroke: '#111111', background: '#eeeeee' },
      dark: { stroke: '#abcdef', background: '#123456' },
    } }
    const view = render(<EntrySurface entry={base({ text: 'dark body' })} kind={kind} entry_data_driver={driver} macro_data_driver={macroDriver} />)
    const body = view.container.querySelector<HTMLElement>('[data-entry-body="text"]')!
    expect(body.style.color).toBe('rgb(245, 245, 245)')
  })

  it('keeps dark Entry hover and Ctrl-hover backgrounds dark', () => {
    const driver = new EntryDataDriver({
      queries: { query_entry: async () => null, query_entry_kind: async () => null },
      context_reader: () => ({ color_scheme: 'dark' }),
    })
    const kind = { id: 'definition', name: 'Definition', coloring: {
      light: { stroke: '#111111', background: '#eeeeee' },
      dark: { stroke: '#abcdef', background: '#123456' },
    } }
    const view = render(<EntrySurface entry={base({ text: 'dark body' })} kind={kind} entry_data_driver={driver} macro_data_driver={macroDriver} />)
    const section = view.container.querySelector<HTMLElement>('section')!

    expect(section.style.background).toBe('rgb(18, 52, 86)')
    fireEvent.pointerEnter(section)
    expect(section.style.background).toBe('rgb(31, 41, 55)')
    fireEvent.keyDown(window, { key: 'Control', ctrlKey: true })
    expect(section.style.background).toBe('rgb(55, 65, 81)')
    fireEvent.keyUp(window, { key: 'Control' })
    expect(section.style.background).toBe('rgb(31, 41, 55)')
    fireEvent.pointerLeave(section)
    expect(section.style.background).toBe('rgb(18, 52, 86)')
  })

  it('accepts legacy flat Entry Kind colors in every render context', () => {
    const driver = new EntryDataDriver({
      queries: { query_entry: async () => null, query_entry_kind: async () => null },
      context_reader: () => ({ color_scheme: 'dark' }),
    })
    const kind = { id: 'definition', name: 'Definition', coloring: {
      stroke: '#abcdef', background: '#123456',
    } }
    const view = render(<EntrySurface entry={base({})} kind={kind} entry_data_driver={driver} macro_data_driver={macroDriver} />)
    const style = view.container.querySelector('section')?.getAttribute('style') ?? ''
    expect(style).toContain('rgb(171, 205, 239)')
    expect(style).toContain('rgb(18, 52, 86)')
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
    const view = render(<EntrySurface entry={base({ text: 'body' })} kind={{ id: 'definition', name: 'Definition', coloring: { light: { stroke: '#123456', background: '#eeeeee' }, dark: { stroke: '#123456', background: '#eeeeee' } } }} entry_data_driver={dataDriver()} macro_data_driver={macroDriver} counter_label="1.2" />)
    const section = view.container.querySelector('section')!
    expect(section.getAttribute('style')).toContain('rgb(18, 52, 86)')
    expect(view.container.querySelector('[data-entry-body]')?.getAttribute('style')).toContain('color: rgb(17, 17, 17)')
    expect(view.container.textContent).toContain('Definition 1.2')
    expect(view.container.querySelector('.katex')).not.toBeNull()
  })

  it('treats whitespace-only bodies as empty and preserves literal kind colors', () => {
    const view = render(<EntrySurface entry={base({ snl: '  ', markdown: '\n', latex: '\t', text: ' ' })} kind={{ id: 'custom', name: 'Custom', coloring: { light: { stroke: 'rebeccapurple', background: 'transparent' }, dark: { stroke: 'rebeccapurple', background: 'transparent' } } }} entry_data_driver={dataDriver()} macro_data_driver={macroDriver} />)
    expect(view.container.querySelector('[data-entry-body]')).toBeNull()
    expect(view.container.querySelector('section')?.getAttribute('style')).toContain('rebeccapurple')
    expect(view.container.querySelector('section')?.getAttribute('style')).toContain('transparent')
  })

  it('preserves neutral and theme-aware Entry color fallbacks', () => {
    const neutral = render(<EntrySurface entry={base({})} kind={null} entry_data_driver={dataDriver()} macro_data_driver={macroDriver} />)
    expect(neutral.container.querySelector('section')?.getAttribute('style')).toContain('rgb(238, 238, 238)')
    neutral.unmount()

    const themed = render(<EntrySurface entry={base({})} kind={{ id: 'custom', name: 'Custom', coloring: { light: { stroke: '', background: '' }, dark: { stroke: '', background: '' } } }} entry_data_driver={dataDriver()} macro_data_driver={macroDriver} />)
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
      name: 'ref', description: '', source: { entries: ['child'], urls: [] }, kind: 'const', dynamic_arity: false, tags: [],
      styles: [{ style_name: 'default', template: { mode: 'formula_inline', body: '\\text{reference}' }, tags: [] }],
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

  it('propagates the activation lease so outside dismissal clears the exact origin activation', async () => {
    const requests: HoverPopoverDismissRequest<string>[] = []
    const dismissal = new HoverPopoverDismissController<null, string>({
      params: null,
      on_request: ({ request, runDefault }) => { requests.push(request); runDefault() },
    })
    const refMacroDriver = new MacroDataDriver({ queries: { query_macro: async () => ({
      name: 'ref', description: '', source: { entries: ['child'], urls: [] }, kind: 'const', dynamic_arity: false, tags: [],
      styles: [{
        style_name: 'default', tags: [],
        template: { mode: 'formula_inline', body: '\\text{reference}' },
      }],
    }) } })
    const entries = dataDriver({ root: base({ snl: 'ref' }, { id: 'root' }), child: base({ text: 'leased child' }, { id: 'child' }) })
    const view = render(<EntryPreviewProvider entry_data_driver={entries} macro_data_driver={refMacroDriver} dismiss_controller={dismissal} options={{ openDelayMs: 0, fadeMs: 0 }}><EntryView entry_id="root" entry_data_driver={entries} macro_data_driver={refMacroDriver} /></EntryPreviewProvider>)
    const target = await waitFor(() => {
      const found = view.container.querySelector<HTMLElement>('[data-name="ref"]')
      expect(found).not.toBeNull()
      return found!
    })
    const original = document.elementsFromPoint
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [target] })
    try {
      fireEvent.mouseMove(target, { clientX: 12, clientY: 14 })
      await waitFor(() => expect(document.body.textContent).toContain('leased child'))
      expect(target.classList.contains('snl-single-hover')).toBe(true)
      fireEvent.pointerDown(view.container)
      expect(requests).toHaveLength(1)
      expect(requests[0].targets[0].activation).toBeDefined()
      expect(target.classList.contains('snl-single-hover')).toBe(false)
    } finally {
      Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: original })
    }
  })

  it('pins the referenced Entry popover on primary click', async () => {
    const refMacroDriver = new MacroDataDriver({ queries: { query_macro: async () => ({
      name: 'ref', description: '', source: { entries: ['child'], urls: [] }, kind: 'const', dynamic_arity: false, tags: [],
      styles: [{ style_name: 'default', template: { mode: 'formula_inline', body: '\\text{reference}' }, tags: [] }],
    }) } })
    const entries = dataDriver({ root: base({ snl: 'ref' }, { id: 'root' }), child: base({ text: 'pinned child body' }, { id: 'child' }) })
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
      await waitFor(() => expect(document.body.textContent).toContain('pinned child body'))
      fireEvent.click(target, { clientX: 12, clientY: 14 })
      fireEvent.pointerMove(document, { clientX: 900, clientY: 700 })
      expect(document.body.textContent).toContain('pinned child body')
      expect(document.querySelector('[data-frozen="true"]')).not.toBeNull()
    } finally {
      Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: original })
    }
  })

  it('cancels a transient preview when its owning Entry unmounts', async () => {
    const refMacroDriver = new MacroDataDriver({ queries: { query_macro: async () => ({
      name: 'ref', description: '', source: { entries: ['child'], urls: [] }, kind: 'const', dynamic_arity: false, tags: [],
      styles: [{ style_name: 'default', template: { mode: 'formula_inline', body: '\\text{reference}' }, tags: [] }],
    }) } })
    const entries = dataDriver({ root: base({ snl: 'ref' }, { id: 'root' }), child: base({ text: 'orphan child' }, { id: 'child' }) })
    const provider = (show: boolean) => <EntryPreviewProvider entry_data_driver={entries} macro_data_driver={refMacroDriver} options={{ openDelayMs: 1000, fadeMs: 0 }}>
      {show ? <EntryView entry_id="root" entry_data_driver={entries} macro_data_driver={refMacroDriver} /> : null}
    </EntryPreviewProvider>
    const view = render(provider(true))
    const target = await waitFor(() => {
      const found = view.container.querySelector<HTMLElement>('[data-name="ref"]')
      expect(found).not.toBeNull()
      return found!
    })
    const original = document.elementsFromPoint
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [target] })
    try {
      fireEvent.mouseMove(target, { clientX: 12, clientY: 14 })
      expect(document.querySelector('[data-popover-id]')).not.toBeNull()
      view.rerender(provider(false))
      await waitFor(() => expect(document.querySelector('[data-popover-id]')).toBeNull())
    } finally {
      Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: original })
    }
  })

  it('can disable hover previews while retaining click-to-pin', async () => {
    const refMacroDriver = new MacroDataDriver({ queries: { query_macro: async () => ({
      name: 'ref', description: '', source: { entries: ['child'], urls: [] }, kind: 'const', dynamic_arity: false, tags: [],
      styles: [{ style_name: 'default', template: { mode: 'formula_inline', body: '\\text{reference}' }, tags: [] }],
    }) } })
    const entries = dataDriver({ root: base({ snl: 'ref' }, { id: 'root' }), child: base({ text: 'click only child' }, { id: 'child' }) })
    const view = render(<EntryPreviewProvider entry_data_driver={entries} macro_data_driver={refMacroDriver} options={{ openDelayMs: 0, fadeMs: 0, hoverEnabled: false }}><EntryView entry_id="root" entry_data_driver={entries} macro_data_driver={refMacroDriver} /></EntryPreviewProvider>)
    const target = await waitFor(() => {
      const found = view.container.querySelector<HTMLElement>('[data-name="ref"]')
      expect(found).not.toBeNull()
      return found!
    })
    const original = document.elementsFromPoint
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [target] })
    try {
      await act(async () => {
        fireEvent.mouseMove(target, { clientX: 12, clientY: 14 })
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      expect(document.body.textContent).not.toContain('click only child')
      expect(target.getAttribute('role')).toBe('button')
      expect(target.tabIndex).toBe(0)
      fireEvent.keyDown(target, { key: 'Enter' })
      await waitFor(() => expect(document.body.textContent).toContain('click only child'))
      expect(document.querySelector('[data-frozen="true"]')).not.toBeNull()
    } finally {
      Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: original })
    }
  })

})
