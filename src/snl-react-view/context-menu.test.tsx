// @vitest-environment jsdom
import katex from 'katex'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import { createSnlSyntaxTreeNode } from '../snl-syntax-tree/types'
import type { SnlMacroRecord } from '../snl-macro/types'
import { stripTexMetadata } from './context-menu'
import { testDriver } from './test-helpers'

const macro = (name: string, body: string) => ({
  name, description: '', source: { entries: [], urls: [] }, dynamic_arity: false, tags: [],
  styles: [{ style_name: 'default', template: { mode: 'formula_inline' as const, body }, tags: [] }],
})
const db: SnlMacroRecord = {
  eq: macro('eq', '#0 = #1'),
  add: macro('add', '#0 + #1'),
  sq: macro('sq', '#0^{2}'),
  alpha: macro('alpha', '\\alpha'),
}
const driver = testDriver(db)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('stripTexMetadata', () => {
  it('removes \\htmlData / \\htmlClass wrappers and keeps the TeX valid', () => {
    const cases: Array<[string, string]> = [
      ['\\htmlData{name=a,kind=fvar}{a} + \\htmlData{name=b,kind=fvar}{b}', 'a + b'],
      ['x^\\htmlData{name=n,kind=bvar}{n+1}', 'x^{n+1}'],
      ['x_\\htmlData{name=i,kind=bvar}{i}', 'x_{i}'],
      ['\\htmlData{name=al,kind=const}{\\alpha}\\htmlData{name=b,kind=fvar}{b}', '\\alpha b'],
      ['\\htmlData{name=al,kind=const}{\\alpha}b', '{\\alpha}b'],
      ['\\cdot\\htmlData{name=x,kind=fvar}{x}', '\\cdot x'],
      ['\\htmlData{name=o,kind=sub}{\\htmlData{name=i,kind=fvar}{i}}', 'i'],
      ['\\htmlClass{snl-block-in-formula}{\\textcolor{gray}{\\cdots}}', '\\textcolor{gray}{\\cdots}'],
      ['\\htmlData{name=e,kind=sub}{}', '{}'],
      ['a \\{ \\htmlData{name=b,kind=fvar}{b} \\}', 'a \\{ b \\}'],
    ]
    for (const [input, expected] of cases) {
      expect(stripTexMetadata(input)).toBe(expected)
      // The copied source typesets without the trusted-HTML extension.
      expect(() => katex.renderToString(stripTexMetadata(input), { throwOnError: true, strict: false })).not.toThrow()
    }
  })
})

describe('subtree right-click menu', () => {
  const tree = () => createSnlSyntaxTreeNode('eq', {
    children: [
      createSnlSyntaxTreeNode('add', { children: [createSnlSyntaxTreeNode('sq', { children: [createSnlSyntaxTreeNode('x')] }), createSnlSyntaxTreeNode('alpha')] }),
      createSnlSyntaxTreeNode('y'),
    ],
  })

  const openMenuOn = async (container: HTMLElement, path: string) => {
    const target = await waitFor(() => {
      const found = container.querySelector<HTMLElement>(`[data-tree-path="${path}"]`)
      expect(found).not.toBeNull()
      return found!
    })
    const original = document.elementsFromPoint
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [target] })
    try {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 30 })
      act(() => { target.dispatchEvent(event) })
      return event
    } finally {
      Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: original })
    }
  }

  it('copies the hovered subtree as TeX without SNL metadata', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { container } = render(<SnlSyntaxTreeView tree={tree()} macro_data_driver={driver} />)
    const event = await openMenuOn(container, '0')
    expect(event.defaultPrevented).toBe(true)
    const item = document.querySelector<HTMLButtonElement>('.snl-context-menu [role="menuitem"]')!
    expect(item.textContent).toBe('Copy TeX source')
    fireEvent.click(item)
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const copied = (writeText.mock.calls[0] as unknown as [string])[0]
    expect(copied).not.toMatch(/htmlData|htmlClass/)
    expect(copied.replace(/\s+/g, '')).toBe('x^{2}+\\alpha')
    await waitFor(() => expect(document.querySelector('.snl-context-menu')?.textContent).toContain('Copied'))
  })

  it('appends consumer items, localizes, and an empty list keeps the browser menu', async () => {
    const extra = vi.fn(async () => 'done')
    const { container, rerender } = render(<SnlSyntaxTreeView tree={tree()} macro_data_driver={driver}
      reader_runtime={{ query_environment: () => ({ language: 'zh-CN' }) } as never}
      hooks={{ contextMenuItems: (_context, defaults) => [...defaults, { id: 'x', label: 'Extra', run: extra }] }} />)
    await openMenuOn(container, '1')
    const labels = [...document.querySelectorAll('.snl-context-menu [role="menuitem"]')].map((item) => item.textContent)
    expect(labels).toEqual(['复制 TeX 源码', 'Extra'])
    fireEvent.click(document.querySelectorAll<HTMLButtonElement>('.snl-context-menu [role="menuitem"]')[1])
    await waitFor(() => expect(extra).toHaveBeenCalledTimes(1))
    expect((extra.mock.calls[0] as unknown as [{ node: { macro_name: string } }])[0].node.macro_name).toBe('y')

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(document.querySelector('.snl-context-menu')).toBeNull())
    rerender(<SnlSyntaxTreeView tree={tree()} macro_data_driver={driver} hooks={{ contextMenuItems: () => [] }} />)
    const event = await openMenuOn(container, '1')
    expect(event.defaultPrevented).toBe(false)
    expect(document.querySelector('.snl-context-menu')).toBeNull()
  })
})
