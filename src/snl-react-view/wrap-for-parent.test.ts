import { describe, expect, it } from 'vitest'
import { wrapForParent } from './render-source'

describe('wrapForParent', () => {
  it('embeds formulas in prose as inline math, display formulas as display islands', () => {
    expect(wrapForParent('a+b', 'formula_inline', 'text')).toBe('$a+b$')
    expect(wrapForParent('a+b', 'formula_display', 'text')).toBe('$$a+b$$')
  })
  it('keeps the other combinations', () => {
    expect(wrapForParent('x', 'text', 'formula_inline')).toBe('\\text{x}')
    expect(wrapForParent('a+b', 'formula_display', 'formula_inline')).toBe('a+b')
    expect(wrapForParent('x', 'text', 'text')).toBe('x')
  })
})
