import { describe, expect, it } from 'vitest'
import { escapeLatexText, fvarAppliedHeadLatex } from './latex-escape'

describe('latex-escape', () => {
  it('escapes special chars for LaTeX text', () => {
    expect(escapeLatexText('a_b')).toBe('a\\_b')
  })

  it('fvarAppliedHeadLatex uses operatorname', () => {
    expect(fvarAppliedHeadLatex('op')).toBe('\\operatorname{op}')
  })
})
