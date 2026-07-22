import { describe, expect, it } from 'vitest'
import { isValidElement } from 'react'
import { defaultRenderHooks, defaultHighlightStrategy, defaultRenderers } from './hooks'
import type { SnlMacro } from '../snl-macro/types'
import type { SnlTooltipState } from './hooks'

const macro: SnlMacro = {
  name: 'Add.add', description: '加法运算',
  source: { entries: [], urls: [] },
  kind: 'const',
  dynamic_arity: false,
  tags: [],
  styles: [{ style_name: 'infix', mode: 'formula_inline', template: '#0 + #1', tags: [] }],
}

describe('defaultRenderHooks', () => {
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

  it('onHover / onLeave are undefined by default (opt-in interception)', () => {
    expect(defaultRenderHooks.onHover).toBeUndefined()
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
