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

  it('renders missing #* as a visible slot when children_joined is missing', () => {
    expect(fillLatexTemplate('[#*]', {})).toBe('[\\mathord{\\htmlClass{snlMissingArg}{\\square}}]')
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

  it('renders out-of-range #N as a visible numbered slot, not empty', () => {
    expect(fillLatexTemplate('#5', { child0: 'a' })).toBe('\\mathord{\\htmlClass{snlMissingArg}{\\square_{5}}}')
  })

  it('renders a partially-typed \\frac{#0}{#1} with a visible slot for the missing arg', () => {
    // Intermediate typing state: only child0 provided. The missing #1 must be a
    // brace-balanced visible slot so KaTeX renders an <mfrac>, not red error text.
    expect(fillLatexTemplate('\\frac{#0}{#1}', { child0: 'a' })).toBe(
      '\\frac{a}{\\mathord{\\htmlClass{snlMissingArg}{\\square_{1}}}}',
    )
  })

  it('renders both frac slots when neither arg is provided (never empty {})', () => {
    expect(fillLatexTemplate('\\frac{#0}{#1}', {})).toBe(
      '\\frac{\\mathord{\\htmlClass{snlMissingArg}{\\square_{0}}}}{\\mathord{\\htmlClass{snlMissingArg}{\\square_{1}}}}',
    )
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
