import { describe, expect, it } from 'vitest'
import katex from 'katex'
import { escapeLatexText, escapeLatexTextMode, escapeTextButPreservePlaceholders, fvarAppliedHeadLatex } from './latex-escape'

describe('latex-escape', () => {
  it('escapes special chars for LaTeX text', () => {
    expect(escapeLatexText('a_b')).toBe('a\\_b')
  })

  it('fvarAppliedHeadLatex uses operatorname', () => {
    expect(fvarAppliedHeadLatex('op')).toBe('\\operatorname{op}')
  })

  it('keeps math-only Unicode typesettable in text mode (Lean names such as «term⟦_⟧»)', () => {
    const raw = 'Quot.«term⟦_⟧» ≠ ℒ'
    const katexOptions = { throwOnError: true, strict: false } as const
    expect(() => katex.renderToString(`\\texttt{${escapeLatexText(raw)}}`, katexOptions)).toThrow()
    expect(() => katex.renderToString(`\\texttt{${escapeLatexTextMode(raw)}}`, katexOptions)).not.toThrow()
    const preserved = escapeTextButPreservePlaceholders(`${raw} #0`)
    expect(preserved.endsWith(' #0')).toBe(true)
    expect(() => katex.renderToString(`\\text{${preserved.replace('#0', 'x')}}`, katexOptions)).not.toThrow()
    expect(escapeLatexTextMode('a_⟦')).toBe('a\\_$⟦$')
  })
})
