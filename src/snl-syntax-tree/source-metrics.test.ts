import { describe, expect, it } from 'vitest'
import type { SnlMacroDb } from '../snl-macro/types'
import type { SnlSyntaxTree } from './types'
import { analyzeSnlTreeSources } from './source-metrics'

function node(
  name: string,
  kind = '',
  mdata: unknown = null,
  children: SnlSyntaxTree[] = [],
): SnlSyntaxTree {
  return { name, kind, mdata, children }
}

const style = [{ tag: 'default', mode: 'formula_inline' as const, template: '#0' }]

const macroDb: SnlMacroDb = {
  'macro.entry': {
    name: 'macro.entry',
    description: '',
    source: { entries: ['missing-entry', 'entry-ok'], urls: [] },
    dynamic_arity: false,
    styles: style,
  },
  'macro.url': {
    name: 'macro.url',
    description: '',
    source: { entries: [], urls: ['https://example.test/source'] },
    dynamic_arity: false,
    styles: style,
  },
  'macro.missing': {
    name: 'macro.missing',
    description: '',
    source: { entries: ['missing-entry'], urls: [] },
    dynamic_arity: false,
    styles: style,
  },
}

describe('analyzeSnlTreeSources', () => {
  it('counts accessible macro, binder, and sourced bvar nodes', () => {
    const tree = node('unknown.root', '', null, [
      node('macro.entry'),
      node('macro.url'),
      node('macro.missing'),
      node('x', 'binder'),
      node('x', 'bvar', { bindRef: 'b1' }),
      node('y', 'bvar', { src: 'entry-ok' }),
      node('z', 'bvar', { src: 'x' }),
      node('w', 'bvar', { src: 'missing-entry' }),
      node('q', 'bvar', { bindRef: 'dangling-bind-ref' }),
    ])

    expect(analyzeSnlTreeSources(tree, macroDb, new Set(['entry-ok']))).toEqual({
      totalNodes: 10,
      sourcedNodes: 6,
      semanticFreedom: 4,
      structuredRatio: 6 / 10,
    })
  })

  it('returns a zero ratio for an absent tree', () => {
    expect(analyzeSnlTreeSources(null, macroDb, new Set())).toEqual({
      totalNodes: 0,
      sourcedNodes: 0,
      semanticFreedom: 0,
      structuredRatio: 0,
    })
  })
})
