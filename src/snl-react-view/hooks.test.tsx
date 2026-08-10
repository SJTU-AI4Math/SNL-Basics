import { describe, expect, it } from 'vitest'
import { isValidElement } from 'react'
import { defaultRenderHooks, defaultHighlightStrategy, defaultRenderers } from './hooks'
import type { SnlMacro } from '../snl-macro/types'
import type { SnlHoverEvent, SnlTooltipState } from './hooks'

const macro: SnlMacro = {
  name: 'Add.add', description: '加法运算',
  source: { entries: [], urls: [] },
  kind: 'const',
  dynamic_arity: false,
  tags: [],
  styles: [{ style_name: 'infix',  template: { mode: 'formula_inline', body: '#0 + #1' }, tags: [] }],
}

describe('defaultRenderHooks', () => {
  it('keeps the legacy SnlHoverEvent shape constructible without a session', () => {
    const event: SnlHoverEvent = {
      name: 'x', kind: 'fvar',
      node: { macro_name: 'x', kind: '', mdata: {}, children: [] },
      bindingHint: '', variableRole: 'fvar',
      target: null as unknown as HTMLElement,
      clientX: 0, clientY: 0,
    }
    expect(event.name).toBe('x')
  })

  it('resolveMacroInfo reads macro.description', async () => {
    const info = await defaultRenderHooks.resolveMacroInfo!('Add.add', macro)
    expect(info.description).toBe('加法运算')
  })

  it('resolveMacroInfo falls back when macro is missing', async () => {
    const info = await defaultRenderHooks.resolveMacroInfo!('nope', undefined)
    expect(info.description).toBe('No description available.')
  })

  it('resolveSource returns null by default', () => {
    expect(defaultRenderHooks.resolveSource!(macro.source)).toBeNull()
  })

  it('renderTooltip returns a React element for a valid state', () => {
    const state: SnlTooltipState = {
      visible: true,
      locked: false,
      x: 10,
      y: 20,
      name: 'Add.add',
      kind: 'const',
      variableRole: 'none',
      bindingHint: '',
      info: { description: '加法运算' },
      loading: false,
      source: null,
    }
    const el = defaultRenderHooks.renderTooltip!(state)
    expect(el).not.toBeNull()
    expect(isValidElement(el)).toBe(true)
  })

  it('timed hover interception is opt-in', () => {
    expect(defaultRenderHooks.onHover).toBeUndefined()
    expect(defaultRenderHooks.onHover1s).toBeUndefined()
    expect(defaultRenderHooks.onHover2s).toBeUndefined()
    expect(defaultRenderHooks.onLeave).toBeUndefined()
  })

  it('exposes defaultHighlightStrategy with a computeHighlightSet function', () => {
    expect(defaultRenderHooks.highlightStrategy).toBe(defaultHighlightStrategy)
    expect(typeof defaultHighlightStrategy.computeHighlightSet).toBe('function')
  })

  it('exposes the built-in renderers registry (list / table / centered)', () => {
    expect(defaultRenderHooks.renderers).toBe(defaultRenderers)
    expect(typeof defaultRenderers.list).toBe('function')
    expect(typeof defaultRenderers.table).toBe('function')
    expect(typeof defaultRenderers.centered).toBe('function')
  })
})
