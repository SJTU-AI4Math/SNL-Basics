import { describe, expect, it } from 'vitest'
import { fillLatexTemplate } from './template'

describe('fillLatexTemplate', () => {
  it('substitutes #0 / #1 with child slots', () => {
    expect(fillLatexTemplate('\\frac{#0}{#1}', { child0: 'a', child1: 'b' })).toBe('\\frac{a}{b}')
  })

  it('substitutes #* with children_joined (variadic)', () => {
    expect(
      fillLatexTemplate('\\begin{pmatrix}#*\\end{pmatrix}', { children_joined: 'a & b \\\\ c & d' }),
    ).toBe('\\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix}')
  })

  it('leaves #* empty when children_joined is missing', () => {
    expect(fillLatexTemplate('[#*]', {})).toBe('[]')
  })

  it('renders \\# as a literal \\# (KaTeX then renders `#`)', () => {
    // The template-level escape must survive to KaTeX as `\#`, NOT be consumed
    // by the #N pass — so `\#0` is a literal hash followed by `0`, not child0.
    expect(fillLatexTemplate('\\#0', { child0: 'X' })).toBe('\\#0')
    expect(fillLatexTemplate('a \\# b', {})).toBe('a \\# b')
  })

  it('supports 2-digit indices (#12)', () => {
    expect(fillLatexTemplate('#12', { child12: 'z' })).toBe('z')
  })

  it('resolves out-of-range #N to empty string', () => {
    expect(fillLatexTemplate('#5', { child0: 'a' })).toBe('')
  })

  it('drops legacy @CHILD0@ / @NAME@ placeholders (left unchanged, proving legacy removed)', () => {
    const out = fillLatexTemplate('@CHILD0@ @NAME@ @CHILDREN@', {
      child0: 'a',
      children_joined: 'x',
      name: 'Foo',
    })
    expect(out).toBe('@CHILD0@ @NAME@ @CHILDREN@')
  })
})
