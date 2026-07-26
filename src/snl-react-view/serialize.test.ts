import { describe, expect, it } from 'vitest'

import { parseSnlSyntaxTree } from './parse'
import { serializeSnlSyntaxTree } from './serialize'

/** parse → serialize must return the original source verbatim. */
function roundTrip(source: string): string {
  return serializeSnlSyntaxTree(parseSnlSyntaxTree(source))
}

describe('serializeSnlSyntaxTree', () => {
  it('serializes a bare leaf', () => {
    expect(roundTrip('x')).toBe('x')
  })

  it('serializes nested children', () => {
    expect(roundTrip('FOL.implies(a,b)')).toBe('FOL.implies(a,b)')
  })

  it('preserves an explicit [style] bracket (regression: style was dropped)', () => {
    expect(roundTrip('FOL.implies[double](a,b)')).toBe('FOL.implies[double](a,b)')
  })

  it('preserves a style on a leaf node', () => {
    expect(roundTrip('FOL.top[short]')).toBe('FOL.top[short]')
  })

  it('emits no bracket when the source had none', () => {
    expect(roundTrip('FOL.implies(a,b)')).not.toContain('[')
  })

  it('round-trips a deep tree with a nested style', () => {
    const source =
      'FOL.forall(x,FOL.implies[double](FOL.app(P,x),FOL.paren(FOL.or(y,FOL.app(Q,x)))))'
    expect(roundTrip(source)).toBe(source)
  })

  // NOTE: SNL-Basics' parser currently rejects empty nodes (`f(a,,b)`). This
  // test pins that behaviour so a future grammar change that allows them shows
  // up here as a deliberate decision rather than a silent drift.
  it('currently rejects empty nodes f(a,,b)', () => {
    expect(() => roundTrip('f(a,,b)')).toThrow(/Expected macro name/)
  })
})
