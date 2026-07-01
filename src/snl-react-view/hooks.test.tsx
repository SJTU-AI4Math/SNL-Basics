import { describe, expect, it } from 'vitest'
import { isValidElement } from 'react'
import { defaultRenderHooks } from './hooks'
import type { SnlMacro } from '../snl-macro/types'
import type { SnlTooltipState } from './hooks'

const macro: SnlMacro = {
  name: 'Add.add.infix',
  description: '加法运算',
  source: { entries: [], urls: [] },
  typst: { built_in: '', synthesis: { output_type: 'formula', macro: '' } },
  latex: { built_in: '', synthesis: { output_type: 'formula', macro: '' } },
  markdown: '',
  text: '',
  katex_react: { arity: 'fixed', mode: 'math', template: '' },
}

describe('defaultRenderHooks', () => {
  it('resolveMacroInfo reads macro.description', async () => {
    const info = await defaultRenderHooks.resolveMacroInfo!('Add.add.infix', macro)
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
      name: 'Add.add.infix',
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
})
