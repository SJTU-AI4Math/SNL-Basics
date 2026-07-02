// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import { createMacroTemplateQueryFromDb } from './default-query'
import { parseSnlSyntaxTree } from '../snl-syntax-tree/parser'
import { paletteToCss, DEFAULT_KIND_PALETTE } from './kind-palette'
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

  it('stylesheet: nested kinds keep original color; hover accent is palette-driven (not static)', () => {
    // Nested subtrees inside the hovered element restore their ORIGINAL
    // (un-hovered, black) color — via `color: initial` (was `revert` in R3).
    expect(css).toMatch(/\.katex-html \.snl-single-hover \[data-kind\]\s*\{\s*color:\s*initial;?\s*\}/)
    // The per-kind hover color moved out of the static stylesheet into injected
    // palette CSS — style.css must no longer hardcode the accent on hover.
    expect(css).not.toMatch(/\.snl-single-hover\s*\{[^}]*color:\s*var\(--snl-c-hover-accent\)/)
    // Every hovered element (kind-in-palette or not) gets a visible default
    // frame — needed for structural wrappers with `data-kind="default"` like
    // FOL.implies.infix, which are not in the palette.
    expect(css).toMatch(/\.katex-html \.snl-single-hover\s*\{[^}]*border:\s*1px solid/)
  })

  it('paletteToCss: per-kind hover rules for the 5 defaults; no bracket-syntax fossils; no base color', () => {
    const generated = paletteToCss(DEFAULT_KIND_PALETTE)
    for (const kind of ['rule', 'const', 'binder', 'bvar', 'fvar']) {
      expect(generated).toContain(`.katex-html .snl-single-hover[data-kind="${kind}"]`)
      // No base color rule — un-hovered text keeps its native color (see #1 spec).
      expect(generated).not.toContain(`.katex-html [data-kind="${kind}"] { color:`)
    }
    expect(generated).not.toContain('constSymbol')
    expect(generated).not.toContain('constantSubtree')
    expect(css).not.toContain('hover-blue')
  })
})
