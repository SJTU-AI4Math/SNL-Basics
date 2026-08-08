
import { describe, expect, it } from 'vitest'
import { resolveRootLatex } from './render-source'
import { testDriver } from './test-helpers'
import { parseSnlSyntaxTree } from '../snl-syntax-tree/parser'
import type { SnlMacroRecord } from '../snl-macro/types'

/**
 * An unfilled argument slot renders as the numbered placeholder used by the
 * Create Macro preview, indexed by the slot it occupies. Cat 2026-07-25.
 */
describe('empty argument slot rendering', () => {
  const db: SnlMacroRecord = {
    pair: {
      name: 'pair',
      description: 'Binary',
      source: { entries: [], urls: [] },
      dynamic_arity: false,
      tags: [],
      styles: [{ style_name: 'default', mode: 'formula_inline', template: '#0 + #1', tags: [] }],
    },
    join_comma: {
      name: 'join_comma',
      description: 'Variadic',
      source: { entries: [], urls: [] },
      dynamic_arity: true,
      tags: [],
      styles: [{ style_name: 'default', mode: 'formula_inline', template: '#*', separator: ', ', tags: [] }],
    },
  }
  const driver = testDriver(db)

  it('renders an empty slot as the placeholder for its own index', async () => {
    const latex = await resolveRootLatex(parseSnlSyntaxTree('pair(a,)'), driver)
    // Slot 1 is unfilled, so it shows the number 1 — not 0, and not blank.
    expect(latex).toContain('\\htmlClass{snlArgPlaceholder}{1}')
    expect(latex).toContain('a')
  })

  it('numbers each empty slot by its position', async () => {
    const latex = await resolveRootLatex(parseSnlSyntaxTree('pair(,)'), driver)
    expect(latex).toContain('\\htmlClass{snlArgPlaceholder}{0}')
    expect(latex).toContain('\\htmlClass{snlArgPlaceholder}{1}')
  })

  it('marks the placeholder as an argPlaceholder node for the editors', async () => {
    const latex = await resolveRootLatex(parseSnlSyntaxTree('pair(,a)'), driver)
    expect(latex).toContain('snlArgPlaceholder')
  })

  it('renders empty slots inside a variadic macro too', async () => {
    const latex = await resolveRootLatex(parseSnlSyntaxTree('join_comma(a,,c)'), driver)
    expect(latex).toContain('\\htmlClass{snlArgPlaceholder}{1}')
    // The separator still joins all three slots.
    expect(latex).toContain(',')
  })

  it('does not render a deliberate empty text node as a placeholder', async () => {
    const latex = await resolveRootLatex(parseSnlSyntaxTree('pair(%%,a)'), driver)
    expect(latex).not.toContain('snlArgPlaceholder')
  })
})
