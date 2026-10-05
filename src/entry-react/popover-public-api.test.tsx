// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import * as entry from './index'
import { HoverPopoverProvider, useHoverPopovers, useCurrentPopoverId, type HoverPopoverApi } from '../snl-react-view/hover-popovers'
import { HoverPopoverDismissController } from '../snl-react-view/popover-dismiss-controller'

afterEach(() => { cleanup(); vi.useRealTimers() })

it('exposes the existing provider API through the consumer Entry route without another context', () => {
  expect(entry).toHaveProperty('useHoverPopovers', useHoverPopovers)
  expect(entry).toHaveProperty('useCurrentPopoverId', useCurrentPopoverId)
  expect(entry.HoverPopoverDismissController).toBe(HoverPopoverDismissController)
})

it('makes the same callable API reachable under EntryPreviewProvider', () => {
  let api!: HoverPopoverApi<string>
  function Capture() { api = entry.useHoverPopovers<string>(); return null }
  const entries = new entry.EntryDataDriver({ queries: { query_entry: async () => null, query_entry_kind: async () => null } })
  const macros = new entry.MacroDataDriver({ queries: { query_macro: async () => null } })
  render(<entry.EntryPreviewProvider entry_data_driver={entries} macro_data_driver={macros} options={{ openDelayMs: 100, fadeMs: 0 }}><Capture /></entry.EntryPreviewProvider>)
  act(() => {
    const id = api.spawn('external', document.body, 0, 0, null)
    expect(api.isAlive(id)).toBe(true)
    api.dismissSubtree(id)
    expect(api.isAlive(id)).toBe(false)
  })
})

it('externally dismisses pending descendants and frozen visible layers without timer resurrection', () => {
  vi.useFakeTimers()
  let api!: HoverPopoverApi<string>
  const removed: string[] = []
  const controller = new HoverPopoverDismissController<null, string>({ params: null,
    on_removed: targets => { removed.push(...targets.map(t => t.subject)) },
  })
  function Capture() { api = useHoverPopovers<string>(); return null }
  const view = render(<HoverPopoverProvider<string> options={{ openDelayMs: 100, freezeDelayMs: 200, fadeMs: 50 }} dismiss_controller={controller} renderPopover={p => <span>{p.subject}</span>}><Capture /></HoverPopoverProvider>)
  let parent = ''; let child = ''
  act(() => {
    parent = api.pin('parent', document.body, 1, 1, null)
    child = api.spawn('pending', document.body, 1, 1, parent)
    api.dismissDescendants(parent)
    api.dismissDescendants(parent)
  })
  expect(api.isAlive(parent)).toBe(true)
  expect(api.isAlive(child)).toBe(false)
  expect(removed).toEqual(['pending'])
  act(() => { api.dismissSubtree(parent); api.dismissAll() })
  expect(api.isAlive(parent)).toBe(false)
  expect(document.querySelector('[data-phase="closing"]')).not.toBeNull()
  act(() => { vi.advanceTimersByTime(500) })
  expect(removed).toEqual(['pending', 'parent'])
  expect(document.querySelector('[data-popover-id]')).toBeNull()
  view.unmount()
  act(() => { api.dismissAll(); api.spawn('disposed', document.body, 0, 0, null); vi.runAllTimers() })
  expect(removed).toEqual(['pending', 'parent'])
  expect(vi.getTimerCount()).toBe(0)
})
