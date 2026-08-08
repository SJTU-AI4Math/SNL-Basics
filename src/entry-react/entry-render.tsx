import React, { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import katex from 'katex'
import type { MacroDataDriver } from '../snl-macro/macro-data-driver'
import type { LanguageEnvironment, ReaderRuntime } from '../runtime'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import { tryParseSnlSyntaxTree } from '../snl-react-view/parse'
import type { KindPalette } from '../snl-react-view/kind-palette'
import { SnlInteractionDriver, type SnlInteractionContext } from '../snl-react-view/interaction-driver'
import type { SnlRenderHooks } from '../snl-react-view/hooks'
import { useCtrlPressed } from '../snl-react-view/use-ctrl-pressed'
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'
import {
  HoverPopoverProvider,
  useCurrentPopoverId,
  useHoverPopovers,
  type HoverPopover,
  type HoverPopoverOptions,
} from '../snl-react-view/hover-popovers'
import { MarkdownBody } from './markdown-body'
import { LatexBody } from './latex-body'
import {
  EntryDataDriver,
  resolve_entry_content,
  type EntryData,
  type EntryKind,
  type ResolvedEntryContent,
} from './entry-data-driver'
import { resolveEntryContextSources } from './context-source'

export interface EntryInteractionPorts {
  on_title_activate?: (entry_id: string, event: React.MouseEvent) => void | Promise<void>
  on_source_activate?: (pointer: unknown, entry_id: string, event: React.MouseEvent) => void | Promise<void>
  on_preview_activate?: (entry_id: string, event: React.MouseEvent | null) => void | Promise<void>
}

export interface EntrySurfaceProps {
  entry: EntryData
  kind: EntryKind | null
  entry_data_driver: EntryDataDriver
  macro_data_driver: MacroDataDriver
  reader_runtime?: ReaderRuntime<LanguageEnvironment<string>>
  interaction_driver?: SnlInteractionDriver
  interaction_ports?: EntryInteractionPorts
  hooks?: SnlRenderHooks
  kind_palette?: KindPalette
  markdown_image_url_transform?: (source: string) => string
  counter_label?: string
  show_source_action?: boolean
  className?: string
  style?: React.CSSProperties
}

export interface EntryViewProps extends Omit<EntrySurfaceProps, 'entry' | 'kind'> {
  entry_id: string
  loading_fallback?: React.ReactNode
  missing_fallback?: React.ReactNode
  error_fallback?: (error: Error) => React.ReactNode
}

interface PreviewController {
  show(entry_id: string, target: HTMLElement, x: number, y: number): string | null
  pin(entry_id: string, target: HTMLElement, x: number, y: number): string
  cancelUnfrozen(id: string): void
}
const EntryPreviewContext = React.createContext<PreviewController | null>(null)

export interface EntryPreviewProviderProps {
  children: React.ReactNode
  entry_data_driver: EntryDataDriver
  macro_data_driver: MacroDataDriver
  reader_runtime?: ReaderRuntime<LanguageEnvironment<string>>
  interaction_ports?: EntryInteractionPorts
  hooks?: SnlRenderHooks
  kind_palette?: KindPalette
  options?: HoverPopoverOptions
  className?: string
  style?: React.CSSProperties
}

export function escapeForKatexText(value: string): string {
  return value.replace(/\\/g, '\\textbackslash{}').replace(/\^/g, '\\textasciicircum{}').replace(/~/g, '\\textasciitilde{}').replace(/([{}$&#_%])/g, '\\$1')
}

/** Entry titles are prose by default; balanced `$...$` spans are inline math. */
export function titleToKatexSource(source: string): string {
  if (!source) return ''
  const parts: string[] = []
  let text = ''
  let i = 0
  const flush = (): void => { if (text) { parts.push(`\\text{${escapeForKatexText(text)}}`); text = '' } }
  while (i < source.length) {
    if (source[i] === '\\' && source[i + 1] === '$') { text += '$'; i += 2; continue }
    if (source[i] !== '$' || source[i + 1] === '$') {
      if (source[i] === '$' && source[i + 1] === '$') { text += '$$'; i += 2 } else { text += source[i]; i += 1 }
      continue
    }
    let end = i + 1
    while (end < source.length && source[end] !== '$') end += 1
    if (end >= source.length) { text += source.slice(i); break }
    flush(); parts.push(source.slice(i + 1, end)); i = end + 1
  }
  flush()
  return parts.join('')
}

function titleHtml(title: string): string {
  try { return katex.renderToString(titleToKatexSource(title), { displayMode: false, throwOnError: true, strict: false, trust: false }) }
  catch { return katex.renderToString(`\\text{${escapeForKatexText(title)}}`, { displayMode: false, throwOnError: false, strict: false, trust: false }) }
}

function surface(content: ResolvedEntryContent): 'snl' | 'markdown' | 'typst' | 'latex' | 'text' | 'none' {
  if (content.snl?.trim()) return 'snl'
  if (content.markdown?.trim()) return 'markdown'
  if (content.typst?.trim()) return 'typst'
  if (content.latex?.trim()) return 'latex'
  if (content.text?.trim()) return 'text'
  return 'none'
}

interface SnlEntryBodyProps {
  source: string
  entry_data_driver: EntryDataDriver
  macro_data_driver: MacroDataDriver
  reader_runtime?: ReaderRuntime<LanguageEnvironment<string>>
  interaction_driver?: SnlInteractionDriver
  hooks?: SnlRenderHooks
  kind_palette?: KindPalette
}

function cloneSnlSyntaxTree(node: SnlSyntaxTree): SnlSyntaxTree {
  return {
    ...node,
    children: node.children.map(cloneSnlSyntaxTree),
  }
}

function SnlEntryBody({ source, entry_data_driver, macro_data_driver, reader_runtime, interaction_driver, hooks, kind_palette }: SnlEntryBodyProps): ReactElement {
  const parsed = useMemo(() => tryParseSnlSyntaxTree(source), [source])
  const [state, setState] = useState<{ source_tree: SnlSyntaxTree; tree: SnlSyntaxTree; driver: EntryDataDriver; status: 'loading' | 'ready' | 'error'; error?: Error } | null>(null)
  const current = parsed.ok && state?.source_tree === parsed.tree && state.driver === entry_data_driver ? state : null

  useEffect(() => {
    if (!parsed.ok) return
    const controller = new AbortController()
    let active = true
    const tree = cloneSnlSyntaxTree(parsed.tree)
    setState({ source_tree: parsed.tree, tree, driver: entry_data_driver, status: 'loading' })
    void resolveEntryContextSources(tree, entry_data_driver, controller.signal).then(() => {
      if (active) setState({ source_tree: parsed.tree, tree, driver: entry_data_driver, status: 'ready' })
    }, (value: unknown) => {
      if (active && !controller.signal.aborted) setState({ source_tree: parsed.tree, tree, driver: entry_data_driver, status: 'error', error: value instanceof Error ? value : new Error(String(value)) })
    })
    return () => { active = false; controller.abort() }
  }, [entry_data_driver, parsed])

  if (!parsed.ok) return <><div role="alert" className="snl-entry-error">SNL parse error: {parsed.error}{parsed.position === undefined ? '' : ` (at ${parsed.position})`}</div><pre>{source}</pre></>
  if (!current || current.status === 'loading') return <div className="snl-entry-loading">Resolving Entry context…</div>
  if (current.status === 'error') return <><div role="alert" className="snl-entry-error">Entry context query failed: {current.error!.message}</div><pre>{source}</pre></>
  return <SnlSyntaxTreeView tree={current.tree} macro_data_driver={macro_data_driver} reader_runtime={reader_runtime} interaction_driver={interaction_driver} hooks={hooks} kindPalette={kind_palette} />
}

function resolveEntryStroke(raw: string | undefined): string {
  if (raw === undefined) return '#888888'
  const value = raw.trim()
  return value === '' || value === 'auto' ? 'var(--vscode-editor-foreground, #ddd)' : value
}

function resolveEntryBackground(raw: string | undefined): string {
  if (raw === undefined) return '#eeeeee'
  const value = raw.trim()
  return value === '' || value === 'transparent' || value === 'none' ? 'transparent' : value
}

export function EntrySurface(props: EntrySurfaceProps): ReactElement {
  const { entry, kind, macro_data_driver, reader_runtime, interaction_driver, interaction_ports, hooks, kind_palette, counter_label } = props
  let content: ResolvedEntryContent = {}
  let contentError: string | null = null
  try {
    content = resolve_entry_content(entry.content ?? {}, reader_runtime)
  } catch (value) {
    contentError = value instanceof Error ? value.message : String(value)
  }
  const bodySurface = contentError ? 'error' : surface(content)
  const html = useMemo(() => titleHtml(entry.title ?? ''), [entry.title])
  const stroke = resolveEntryStroke(kind?.coloring?.stroke)
  const background = resolveEntryBackground(kind?.coloring?.background)
  const kindName = kind?.name || entry.kind
  const preview = React.useContext(EntryPreviewContext)
  const ownedPreviewIds = useRef(new Set<string>())
  useEffect(() => () => {
    if (!preview) return
    for (const id of ownedPreviewIds.current) preview.cancelUnfrozen(id)
    ownedPreviewIds.current.clear()
  }, [preview])
  const [blockHovered, setBlockHovered] = useState(false)
  const [titleHovered, setTitleHovered] = useState(false)
  const ctrlPressed = useCtrlPressed(blockHovered || titleHovered)
  const titleActivationActive = Boolean(interaction_ports?.on_title_activate && titleHovered && ctrlPressed)
  const effectiveInteractionDriver = useMemo(() => {
    if (!preview) return interaction_driver
    return new SnlInteractionDriver({
      on_hover: async (context: SnlInteractionContext) => {
        const id = context.macro?.source.entries[0]
        if (id) {
          const popoverId = preview.show(id, context.target, context.client_x, context.client_y)
          if (popoverId) ownedPreviewIds.current.add(popoverId)
        }
        await interaction_driver?.dispatch_hover(context)
      },
      on_leave: () => interaction_driver?.dispatch_leave(),
      on_click: async (context) => {
        const id = context.macro?.source.entries[0]
        if (id) ownedPreviewIds.current.delete(
          preview.pin(id, context.target, context.client_x, context.client_y),
        )
        await interaction_driver?.dispatch_click(context)
      },
      on_ctrl_click: async (context) => {
        const id = context.macro?.source.entries[0]
        if (id) await interaction_ports?.on_preview_activate?.(id, null)
        await interaction_driver?.dispatch_click(context)
      },
    })
  }, [interaction_driver, interaction_ports, preview])
  const invoke = (result: void | Promise<void> | undefined): void => { if (result instanceof Promise) void result.catch(() => undefined) }
  const interactiveBackground = blockHovered ? (ctrlPressed ? '#f3f4f6' : '#ffffff') : background
  return <section
    data-entry-id={entry.id}
    className={props.className}
    onPointerEnter={() => setBlockHovered(true)}
    onPointerLeave={() => setBlockHovered(false)}
    style={{
      borderLeft: `5px solid ${stroke}`,
      background: interactiveBackground,
      boxShadow: blockHovered ? `inset 0 0 0 5px ${stroke}` : 'none',
      width: '100%',
      transition: 'background-color 150ms ease, box-shadow 150ms ease',
      ...props.style,
    }}
  >
    <header style={{ padding: '0.275rem 0.8rem', display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
      <strong onMouseEnter={() => setTitleHovered(true)} onMouseLeave={() => setTitleHovered(false)} onClick={(event) => invoke(interaction_ports?.on_title_activate?.(entry.id, event))} style={{ color: stroke, fontSize: '1.25rem', flex: '1 1 auto', cursor: titleActivationActive ? 'pointer' : undefined }}>
        {kindName}{counter_label ? ` ${counter_label}` : ''} -- <span dangerouslySetInnerHTML={{ __html: html }} />
      </strong>
      {entry.pointer !== undefined && (props.show_source_action ?? true) ? <button type="button" aria-label="Open source" onClick={(event) => invoke(interaction_ports?.on_source_activate?.(entry.pointer, entry.id, event))}>↗ source</button> : null}
    </header>
    {bodySurface !== 'none' ? <>
      <div style={{ borderTop: `0.5px solid ${stroke}`, margin: '4px 10px' }} />
      <div data-entry-body={bodySurface} style={{ padding: '0.9rem', fontSize: '1.05rem', color: background === 'transparent' ? undefined : '#111' }}>
        {bodySurface === 'error' ? <div role="alert" className="snl-entry-error">Entry content localization error: {contentError}</div> : null}
        {bodySurface === 'snl' ? <SnlEntryBody source={content.snl!} entry_data_driver={props.entry_data_driver} macro_data_driver={macro_data_driver} reader_runtime={reader_runtime} interaction_driver={effectiveInteractionDriver} hooks={hooks} kind_palette={kind_palette} /> : null}
        {bodySurface === 'markdown' ? <MarkdownBody source={content.markdown!} image_url_transform={props.markdown_image_url_transform} /> : null}
        {bodySurface === 'typst' ? <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{content.typst}</pre> : null}
        {bodySurface === 'latex' ? <LatexBody source={content.latex!} /> : null}
        {bodySurface === 'text' ? <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{content.text}</pre> : null}
      </div>
    </> : null}
  </section>
}

export function EntryView({ entry_id, entry_data_driver, loading_fallback, missing_fallback, error_fallback, ...surfaceProps }: EntryViewProps): ReactElement {
  const [state, setState] = useState<{ driver: EntryDataDriver; id: string; status: 'loading' | 'ready' | 'missing' | 'error'; entry?: EntryData; kind?: EntryKind | null; error?: Error }>(() => ({ driver: entry_data_driver, id: entry_id, status: 'loading' }))
  const current = state.driver === entry_data_driver && state.id === entry_id ? state : { driver: entry_data_driver, id: entry_id, status: 'loading' as const }
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setState({ driver: entry_data_driver, id: entry_id, status: 'loading' })
    void entry_data_driver.query_entry({ entry_id, signal: controller.signal }).then(async (entry) => {
      if (!entry) { if (active) setState({ driver: entry_data_driver, id: entry_id, status: 'missing' }); return }
      const kind = await entry_data_driver.query_entry_kind({ kind_id: entry.kind, signal: controller.signal })
      if (active) setState({ driver: entry_data_driver, id: entry_id, status: 'ready', entry, kind })
    }).catch((value: unknown) => {
      if (active && !controller.signal.aborted) setState({ driver: entry_data_driver, id: entry_id, status: 'error', error: value instanceof Error ? value : new Error(String(value)) })
    })
    return () => { active = false; controller.abort() }
  }, [entry_data_driver, entry_id])
  if (current.status === 'loading') return <>{loading_fallback ?? <div className="snl-entry-loading">Loading Entry…</div>}</>
  if (current.status === 'missing') return <>{missing_fallback ?? <div className="snl-entry-missing">Entry {entry_id} not found.</div>}</>
  if (current.status === 'error') return <>{error_fallback ? error_fallback(current.error!) : <div role="alert" className="snl-entry-error">Entry query failed: {current.error!.message}</div>}</>
  return <EntrySurface {...surfaceProps} entry_data_driver={entry_data_driver} entry={current.entry!} kind={current.kind ?? null} />
}

function EntryPreviewBridge({ children, hoverEnabled }: { children: React.ReactNode; hoverEnabled: boolean }): ReactElement {
  const api = useHoverPopovers<string>()
  const parentId = useCurrentPopoverId()
  const controller = useMemo<PreviewController>(() => ({
    show: (entry_id, target, x, y) => {
      return hoverEnabled ? api.preview(entry_id, target, x, y, parentId) : null
    },
    pin: (entry_id, target, x, y) => api.pin(entry_id, target, x, y, parentId),
    cancelUnfrozen: (id) => api.cancelUnfrozen(id),
  }), [api, hoverEnabled, parentId])
  return <EntryPreviewContext.Provider value={controller}>{children}</EntryPreviewContext.Provider>
}

/** Generic recursive Entry popovers; host loading is entirely supplied by EntryDataDriver. */
export function EntryPreviewProvider({ children, entry_data_driver, macro_data_driver, reader_runtime, interaction_ports, hooks, kind_palette, options, className, style }: EntryPreviewProviderProps): ReactElement {
  const hoverEnabled = options?.hoverEnabled !== false
  const renderPopover = (popover: HoverPopover<string>): React.ReactNode => <EntryPreviewBridge hoverEnabled={hoverEnabled}><EntryView entry_id={popover.subject} entry_data_driver={entry_data_driver} macro_data_driver={macro_data_driver} reader_runtime={reader_runtime} interaction_ports={interaction_ports} hooks={hooks} kind_palette={kind_palette} /></EntryPreviewBridge>
  return <HoverPopoverProvider<string> renderPopover={renderPopover} options={options} className={className} style={style}><EntryPreviewBridge hoverEnabled={hoverEnabled}>{children}</EntryPreviewBridge></HoverPopoverProvider>
}
