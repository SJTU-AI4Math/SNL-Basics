/**
 * Right-click menu on a rendered SNL subtree: copy its TeX source, plus
 * consumer-supplied actions (see `SnlRenderHooks.contextMenuItems`).
 */
import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'
import type { TreePath } from './interaction-driver'

/** What a menu action works on: the subtree under the pointer. */
export interface SnlContextMenuContext {
  readonly node: SnlSyntaxTree
  readonly tree_path: TreePath
  readonly target: HTMLElement
  /** Content language of the view (`en`, `zh-CN`, …). */
  readonly language: string
  /** The subtree's TeX source, without SNL's `\htmlData` / `\htmlClass` metadata. */
  tex(): Promise<string>
}

export interface SnlContextMenuItem {
  readonly id: string
  readonly label: string
  /** Runs the action. Resolve with a short status to show (e.g. "Copied"), or nothing. */
  run(context: SnlContextMenuContext): void | string | Promise<void | string>
}

const isChinese = (language: string): boolean => /^(zh|CN)(-|$)/i.test(language)

/** Copy text, falling back to a hidden textarea where the async Clipboard API is unavailable. */
export async function copyTextToClipboard(text: string): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
  } catch { /* fall through to the legacy path */ }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.append(area)
  area.select()
  try {
    if (!document.execCommand('copy')) throw new Error('copy command was rejected')
  } finally {
    area.remove()
  }
}

/** The default menu: copy the subtree's TeX source. */
export function defaultContextMenuItems(language: string): SnlContextMenuItem[] {
  const zh = isChinese(language)
  return [{
    id: 'copy-tex',
    label: zh ? '复制 TeX 源码' : 'Copy TeX source',
    async run(context) {
      await copyTextToClipboard(await context.tex())
      return zh ? '已复制' : 'Copied'
    },
  }]
}

const WRAPPER = /^\\html(?:Data|Class|Id|Style)\s*\{/

/** Index of the brace closing the group opened at `openAt`, or -1. */
function closingBrace(source: string, openAt: number): number {
  let depth = 0
  for (let i = openAt; i < source.length; i += 1) {
    if (source[i] === '\\') { i += 1; continue }
    if (source[i] === '{') depth += 1
    else if (source[i] === '}' && --depth === 0) return i
  }
  return -1
}

/**
 * Remove SNL's KaTeX metadata wrappers (`\htmlData{…}{X}`, `\htmlClass{…}{X}`, …),
 * keeping `X`. Braces are kept only where TeX needs them: after `_` / `^`, for an
 * empty body, or to keep a trailing control word from swallowing the next letter.
 */
export function stripTexMetadata(latex: string): string {
  let out = ''
  let i = 0
  while (i < latex.length) {
    if (latex[i] === '\\') {
      const wrapper = WRAPPER.exec(latex.slice(i))
      if (wrapper) {
        const firstEnd = closingBrace(latex, i + wrapper[0].length - 1)
        let j = firstEnd + 1
        while (latex[j] === ' ') j += 1
        const secondEnd = firstEnd > 0 && latex[j] === '{' ? closingBrace(latex, j) : -1
        if (secondEnd > 0) {
          const inner = stripTexMetadata(latex.slice(j + 1, secondEnd))
          const next = latex[secondEnd + 1] ?? ''
          const braced = /[_^]\s*$/.test(out) || inner.trim() === '' ||
            (/\\[A-Za-z]+\s*$/.test(inner) && /[A-Za-z]/.test(next))
          if (braced) out += `{${inner}}`
          else out += (/\\[A-Za-z]+$/.test(out) && /^[A-Za-z]/.test(inner) ? ' ' : '') + inner
          i = secondEnd + 1
          continue
        }
      }
      const escape = /^\\(?:[A-Za-z]+|.)/s.exec(latex.slice(i))![0]
      out += escape
      i += escape.length
      continue
    }
    out += latex[i]
    i += 1
  }
  return out
}

export interface SnlContextMenuState {
  x: number
  y: number
  context: SnlContextMenuContext
  items: readonly SnlContextMenuItem[]
}

/** The floating menu. Portaled to the document body and marked as an SNL overlay. */
export function SnlContextMenu({ state, onClose }: { state: SnlContextMenuState; onClose(): void }): JSX.Element | null {
  const ref = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ left: state.x, top: state.y })
  const [status, setStatus] = useState<{ id: string; text: string } | null>(null)
  const zh = isChinese(state.context.language)

  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    const margin = 8
    setPosition({
      left: Math.max(margin, Math.min(state.x, window.innerWidth - rect.width - margin)),
      top: Math.max(margin, Math.min(state.y, window.innerHeight - rect.height - margin)),
    })
  }, [state.x, state.y])

  useEffect(() => {
    const outside = (event: Event) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return
      onClose()
    }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('scroll', onClose, true)
    document.addEventListener('keydown', key)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('scroll', onClose, true)
      document.removeEventListener('keydown', key)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  useEffect(() => { ref.current?.querySelector<HTMLButtonElement>('button')?.focus() }, [])

  const run = async (item: SnlContextMenuItem): Promise<void> => {
    try {
      const result = await item.run(state.context)
      if (typeof result === 'string' && result) {
        setStatus({ id: item.id, text: result })
        setTimeout(onClose, 700)
      } else onClose()
    } catch {
      setStatus({ id: item.id, text: zh ? '失败' : 'Failed' })
      setTimeout(onClose, 1200)
    }
  }

  if (typeof document === 'undefined') return null
  return createPortal(
    <div ref={ref} className="snl-context-menu" role="menu" data-snl-overlay=""
      style={{ left: position.left, top: position.top }}
      onContextMenu={(event) => event.preventDefault()}>
      {state.items.map((item) => (
        <button key={item.id} type="button" role="menuitem" className="snl-context-menu-item"
          disabled={status !== null} onClick={() => { void run(item) }}>
          {item.label}
          {status?.id === item.id ? <span className="snl-context-menu-status"> · {status.text}</span> : null}
        </button>
      ))}
    </div>,
    document.body,
  )
}
