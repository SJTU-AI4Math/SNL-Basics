// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import { SnlInteractionDriver, type SnlInteractionContext } from './interaction-driver'
import { parseSnlSyntaxTree } from '../snl-syntax-tree/parser'
import { resolveDeepestHoverHitFromStack } from './hover-dom'
import { testDriver } from './test-helpers'
import type { SnlMacroRecord } from '../snl-macro/types'

const db: SnlMacroRecord = {
  parent: { name: 'parent', description: '', source: { entries: ['parent-entry'], urls: [] }, dynamic_arity: false, tags: [], styles: [{ style_name: 'default', tags: [], template: { mode: 'formula_inline', body: '#0 + #1' } }] },
  own: { name: 'own', description: '', source: { entries: ['own-entry'], urls: [] }, dynamic_arity: false, tags: [], styles: [{ style_name: 'default', tags: [], template: { mode: 'formula_inline', body: 'o' } }] },
}
afterEach(cleanup)

function hover(target: Element, stack: Element[] = [target]) {
  const original = document.elementsFromPoint
  Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => stack })
  try { fireEvent.mouseMove(target, { clientX: 3, clientY: 4 }) }
  finally { Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: original }) }
}

describe('semantic event ownership', () => {
  it('does not promote a foreign nested hover hit to an escaped parent layout hit', () => {
    const container = document.createElement('div')
    container.innerHTML = '<span data-name="parent" data-tree-path=""><span class="layout"></span><div data-snl-render-root><span data-name="literal" data-tree-path=""></span></div></span>'
    const layout = container.querySelector('.layout')!
    const child = container.querySelector('[data-name="literal"]')!
    expect(resolveDeepestHoverHitFromStack([child, layout], container)).toBeNull()
    expect(resolveDeepestHoverHitFromStack([layout, child], container)).toBeNull()
  })

  it('dispatches a source-less Macro child and Ctrl-click only with its own metadata', async () => {
    const clicks = vi.fn<(context: SnlInteractionContext) => void>()
    const hovers = vi.fn<(context: SnlInteractionContext) => void>()
    const macros = { ...db, own: { ...db.own, source: { entries: [], urls: [] } } }
    const view = render(<SnlSyntaxTreeView tree={parseSnlSyntaxTree('parent(own,literal)')} macro_data_driver={testDriver(macros)} interaction_driver={new SnlInteractionDriver({ on_click: clicks, on_ctrl_click: clicks, on_hover: hovers })} />)
    const child = await waitFor(() => { const el = view.container.querySelector<HTMLElement>('[data-name="own"]'); expect(el).not.toBeNull(); return el! })
    hover(child)
    expect(hovers.mock.calls.at(-1)?.[0].macro?.source.entries).toEqual([])
    fireEvent.click(child, { ctrlKey: true })
    expect(clicks.mock.calls.at(-1)?.[0].node.macro_name).toBe('own')
    expect(clicks.mock.calls.at(-1)?.[0].macro?.source.entries).toEqual([])
    expect(child.classList.contains('snl-single-hover')).toBe(true)
  })

  it('keeps unindexed literal callbacks local and does not keyboard-activate the indexed ancestor', async () => {
    const clicks = vi.fn<(context: SnlInteractionContext) => void>()
    const hovers = vi.fn<(context: SnlInteractionContext) => void>()
    const view = render(<SnlSyntaxTreeView tree={parseSnlSyntaxTree('parent(literal,own)')} macro_data_driver={testDriver(db)} interaction_driver={new SnlInteractionDriver({ on_click: clicks, on_hover: hovers })} />)
    const child = await waitFor(() => { const el = view.container.querySelector<HTMLElement>('[data-name="literal"]'); expect(el).not.toBeNull(); return el! })
    const parent = view.container.querySelector<HTMLElement>('[data-name="parent"]')!
    const glyph = child.querySelector('span') ?? child
    hover(glyph, [glyph, child, parent])
    expect(hovers.mock.calls.at(-1)?.[0].node.macro_name).toBe('literal')
    expect(hovers.mock.calls.at(-1)?.[0].macro).toBeNull()
    fireEvent.click(glyph)
    expect(clicks.mock.calls.at(-1)?.[0].node.macro_name).toBe('literal')
    clicks.mockClear()
    fireEvent.keyDown(glyph, { key: 'Enter' })
    fireEvent.keyDown(glyph, { key: ' ' })
    expect(clicks).not.toHaveBeenCalled()
    fireEvent.click(view.container.querySelector('[data-name="own"]')!)
    expect(clicks.mock.calls.at(-1)?.[0].macro?.source.entries).toEqual(['own-entry'])
    fireEvent.click(parent)
    expect(clicks.mock.calls.at(-1)?.[0].macro?.source.entries).toEqual(['parent-entry'])
  })

  it('does not click past a semantic boundary without a tree path', async () => {
    const clicks = vi.fn()
    const view = render(<SnlSyntaxTreeView tree={parseSnlSyntaxTree('parent(literal,own)')} macro_data_driver={testDriver(db)} interaction_driver={new SnlInteractionDriver({ on_click: clicks })} />)
    const child = await waitFor(() => { const el = view.container.querySelector<HTMLElement>('[data-name="literal"]'); expect(el).not.toBeNull(); return el! })
    child.removeAttribute('data-tree-path')
    fireEvent.click(child.querySelector('span') ?? child)
    expect(clicks).not.toHaveBeenCalled()
  })

  for (const placement of ['nested', 'popover', 'portal'] as const) {
    it(`does not reinterpret ${placement} render-root events using an outer tree`, async () => {
      const outerClicks = vi.fn()
      const outerHovers = vi.fn()
      const innerClicks = vi.fn()
      const innerHovers = vi.fn()
      const nestedDriver = testDriver({})
      const nestedTree = parseSnlSyntaxTree('literal')
      const inner = <SnlSyntaxTreeView tree={nestedTree} macro_data_driver={nestedDriver} interaction_driver={new SnlInteractionDriver({ on_click: innerClicks, on_hover: innerHovers })} />
      const portalHost = document.createElement('div')
      document.body.append(portalHost)
      const block: SnlMacroRecord = { block: { ...db.parent, name: 'block', styles: [{ style_name: 'default', tags: [], template: { mode: 'block', body: '', block_template_name: 'nested' } }] } }
      const view = render(<SnlSyntaxTreeView tree={parseSnlSyntaxTree('block')} macro_data_driver={testDriver(block)} interaction_driver={new SnlInteractionDriver({ on_click: outerClicks, on_hover: outerHovers })} hooks={{ renderers: { nested: () => placement === 'portal' ? createPortal(<div data-popover-id="preview">{inner}</div>, portalHost) : <div data-popover-id={placement === 'popover' ? 'preview' : undefined}>{inner}</div> } }} />)
      try {
        const child = await waitFor(() => { const el = document.querySelector<HTMLElement>('[data-name="literal"]'); expect(el).not.toBeNull(); return el! })
        const parent = view.container.querySelector<HTMLElement>('[data-name="block"]')!
        hover(child, [child, parent])
        expect(innerHovers).toHaveBeenCalledOnce()
        expect(outerHovers).not.toHaveBeenCalled()
        fireEvent.click(child)
        expect(innerClicks).toHaveBeenCalledOnce()
        expect(outerClicks).not.toHaveBeenCalled()
        expect(child.dataset.snlKeyboardActivation).toBeUndefined()
      } finally { view.unmount(); portalHost.remove() }
    })
  }
})
