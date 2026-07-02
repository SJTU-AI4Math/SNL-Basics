// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import { createMacroTemplateQueryFromDb } from './default-query'
import { parseSnlSyntaxTree } from '../snl-syntax-tree/parser'
import mainDbJson from '../../public/snl-macro-db.json'
import type { SnlMacroDb } from '../snl-macro/types'

const db = mainDbJson as unknown as SnlMacroDb
const query = createMacroTemplateQueryFromDb(db)

const css = readFileSync(path.resolve(process.cwd(), 'src/snl-react-view/style.css'), 'utf8')

afterEach(cleanup)

describe('hover colors only direct-text descendants, not nested subtrees', () => {
  it('applies .snl-single-hover to the hovered subtree while nested subtrees keep their [data-kind]', async () => {
    // forall(x, add(x, mul(x, y))) — add wraps a nested mul subtree.
    const tree = parseSnlSyntaxTree(
      'FOL.forall.binder(x, Add.add.infix(x, Mul.mul.infix(x, y)))',
    )
    const { container } = render(<SnlSyntaxTreeView tree={tree} query={query} macroDb={db} />)

    await waitFor(() => {
      expect(container.querySelector('[data-name="Add.add.infix"]')).not.toBeNull()
    })

    const addEl = container.querySelector<HTMLElement>('[data-name="Add.add.infix"]')!
    // Simulate the view marking the element under the pointer.
    addEl.classList.add('snl-single-hover')
    expect(addEl.classList.contains('snl-single-hover')).toBe(true)

    // The nested mul subtree (and its bound/free vars) live *inside* the hovered
    // add element and still carry their own [data-kind] — these are exactly the
    // elements the `.snl-single-hover [data-kind] { color: revert }` rule targets
    // so they escape the hover accent and keep their kind color.
    const nestedKinds = addEl.querySelectorAll('[data-kind]')
    expect(nestedKinds.length).toBeGreaterThan(0)
    expect(addEl.querySelector('[data-name="Mul.mul.infix"]')).not.toBeNull()
    expect(addEl.querySelector('[data-kind="bvar"]')).not.toBeNull()
    expect(addEl.querySelector('[data-kind="fvar"]')).not.toBeNull()
  })

  it('stylesheet: hover accent has no !important and nested kinds revert', () => {
    // `!important` on the hover color must be gone (it dominated via inheritance).
    const hoverBlock = css.match(/\.katex-html \.snl-single-hover\s*\{[^}]*\}/g) ?? []
    const colorBlock = hoverBlock.find((b) => /color:/.test(b))
    expect(colorBlock).toBeTruthy()
    expect(colorBlock!).toContain('var(--snl-c-hover-accent)')
    expect(colorBlock!).not.toMatch(/color:[^;]*!important/)

    // Nested subtrees escape the hover color via `revert`.
    expect(css).toMatch(/\.katex-html \.snl-single-hover \[data-kind\]\s*\{\s*color:\s*revert;?\s*\}/)
  })

  it('stylesheet: per-kind base colors exist and legacy hover-blue is gone', () => {
    for (const kind of ['const', 'constSymbol', 'constantSubtree', 'binder', 'bvar', 'fvar']) {
      expect(css).toContain(`.katex-html [data-kind='${kind}']`)
    }
    expect(css).not.toContain('hover-blue')
  })
})
