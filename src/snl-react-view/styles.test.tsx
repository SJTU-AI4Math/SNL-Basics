// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import { createMacroTemplateQueryFromDb } from './default-query'
import { parseSnlSyntaxTree } from '../snl-syntax-tree/parser'
import mainDbJson from '../../public/snl-macro-db.json'
import type { SnlMacroDb } from '../snl-macro/types'

const db = mainDbJson as unknown as SnlMacroDb
const query = createMacroTemplateQueryFromDb(db)

afterEach(cleanup)

describe('style dispatch via [style] bracket', () => {
  it('uses the first style (infix → \\rightarrow) when no bracket is given', async () => {
    const tree = parseSnlSyntaxTree('FOL.implies(a,b)')
    let latex = ''
    render(
      <SnlSyntaxTreeView tree={tree} query={query} macroDb={db} onResolved={(l) => (latex = l)} />,
    )
    await waitFor(() => expect(latex).toContain('\\rightarrow'))
    expect(latex).not.toContain('\\Rightarrow')
  })

  it('honors an explicit [double] style (⇒) and emits data-style', async () => {
    const tree = parseSnlSyntaxTree('FOL.implies[double](a,b)')
    expect(tree.style).toBe('double')
    let latex = ''
    const { container } = render(
      <SnlSyntaxTreeView tree={tree} query={query} macroDb={db} onResolved={(l) => (latex = l)} />,
    )
    await waitFor(() => expect(latex).toContain('\\Rightarrow'))
    expect(latex).not.toContain('\\rightarrow')
    await waitFor(() => {
      expect(container.querySelector('[data-style="double"]')).not.toBeNull()
    })
  })

  it('Mul.mul default is implicit (#0#1); [infix] switches to \\cdot', async () => {
    let implicitLatex = ''
    render(
      <SnlSyntaxTreeView
        tree={parseSnlSyntaxTree('Mul.mul(a,b)')}
        query={query}
        macroDb={db}
        onResolved={(l) => (implicitLatex = l)}
      />,
    )
    await waitFor(() => expect(implicitLatex).not.toBe(''))
    expect(implicitLatex).not.toContain('\\cdot')

    let infixLatex = ''
    render(
      <SnlSyntaxTreeView
        tree={parseSnlSyntaxTree('Mul.mul[infix](a,b)')}
        query={query}
        macroDb={db}
        onResolved={(l) => (infixLatex = l)}
      />,
    )
    await waitFor(() => expect(infixLatex).toContain('\\cdot'))
  })

  it('throws (render error) for an unknown style tag', async () => {
    const tree = parseSnlSyntaxTree('FOL.implies[nope](a,b)')
    const { container } = render(<SnlSyntaxTreeView tree={tree} query={query} macroDb={db} />)
    await waitFor(() => {
      expect(container.querySelector('.katex-error')).not.toBeNull()
    })
    expect(container.querySelector('.katex-error')?.textContent).toContain('unknown style')
  })
})
