// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import { parseSnlSyntaxTree } from '../snl-syntax-tree/parser'
import { paletteToCss, DEFAULT_KIND_PALETTE } from './kind-palette'
import mainDbJson from '../../public/snl-macro-db.json'
import type { SnlMacroRecord } from '../snl-macro/types'
import { testDriver } from '../snl-react-view/test-helpers'

const db = mainDbJson as unknown as SnlMacroRecord

const css = readFileSync(path.resolve(process.cwd(), 'src/snl-react-view/style.css'), 'utf8')

afterEach(cleanup)

describe('hover colors only direct-text descendants, not nested subtrees', () => {
  it('applies .snl-single-hover to the hovered subtree while nested subtrees keep their [data-kind]', async () => {
    // forall(x, add(x, mul(x, y))) — add wraps a nested mul subtree.
    const tree = parseSnlSyntaxTree(
      'FOL.forall(x, Add.add(x, Mul.mul(x, y)))',
    )
    const { container } = render(<SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} />)

    await waitFor(() => {
      expect(container.querySelector('[data-name="Add.add"]')).not.toBeNull()
    })

    const addEl = container.querySelector<HTMLElement>('[data-name="Add.add"]')!
    // Simulate the view marking the element under the pointer.
    addEl.classList.add('snl-single-hover')
    expect(addEl.classList.contains('snl-single-hover')).toBe(true)

    // The nested mul subtree (and its bound/free vars) live *inside* the hovered
    // add element and still carry their own [data-kind] — these are exactly the
    // elements the `.snl-single-hover [data-kind] { color: revert }` rule targets
    // so they escape the hover accent and keep their kind color.
    const nestedKinds = addEl.querySelectorAll('[data-kind]')
    expect(nestedKinds.length).toBeGreaterThan(0)
    expect(addEl.querySelector('[data-name="Mul.mul"]')).not.toBeNull()
    expect(addEl.querySelector('[data-kind="bvar"]')).not.toBeNull()
    expect(addEl.querySelector('[data-kind="fvar"]')).not.toBeNull()
  })

  it('stylesheet: nested kinds restore the captured base color; hover accent is palette-driven', () => {
    // Nested subtrees must use the same computed text color they had before
    // their ancestor was highlighted. `initial` is theme-sensitive CanvasText
    // and turns white under `color-scheme: dark`, even on a light Entry body.
    expect(css).toMatch(/\.katex-html \.snl-single-hover \[data-kind\]\s*\{\s*color:\s*var\(--snl-base-text-color\);?\s*\}/)
    expect(css).not.toMatch(/\.snl-single-hover \[data-kind\][^{]*\{[^}]*color:\s*(initial|revert)/)
    // palette CSS — style.css must no longer hardcode the accent on hover.
    expect(css).not.toMatch(/\.snl-single-hover\s*\{[^}]*color:\s*var\(--snl-c-hover-accent\)/)
    // Every hovered element (kind-in-palette or not) gets a visible default
    // frame — drawn with box-shadow so the layout doesn't reflow on hover.
    expect(css).toMatch(/\.katex-html \.snl-single-hover\s*\{[^}]*box-shadow:\s*0 0 0 1px/)
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
