import { describe, expect, it } from 'vitest'
import { analyzeOrderedSlotIndices, createSlotContract, slotContractKey } from './slot-contract'

describe('slot-contract', () => {
  it('builds the same fixed and dynamic contract keys used by Macro validation', () => {
    expect(slotContractKey(createSlotContract(2, false))).toBe('fixed:2')
    expect(slotContractKey(createSlotContract(3, true))).toBe('dynamic:3')
  })

  it('accepts unique contiguous ordered slots', () => {
    expect(analyzeOrderedSlotIndices([], false)).toEqual({
      positional_arity: 0,
      variadic: false,
      invalid: false,
    })
    expect(analyzeOrderedSlotIndices([0, 1, 2], false)).toEqual({
      positional_arity: 3,
      variadic: false,
      invalid: false,
    })
    expect(analyzeOrderedSlotIndices([0, 1], true)).toEqual({
      positional_arity: 2,
      variadic: true,
      invalid: false,
    })
  })

  it('derives ordinary positional arity from sparse and repeated slot occurrences', () => {
    expect(analyzeOrderedSlotIndices([2, 0, 2], false)).toEqual({
      positional_arity: 3,
      variadic: false,
      invalid: false,
    })
  })

  it('rejects negative, non-integer, out-of-range, and dynamic-mismatch slot occurrences', () => {
    for (const contract of [
      analyzeOrderedSlotIndices([-1], false),
      analyzeOrderedSlotIndices([1.5], false),
      analyzeOrderedSlotIndices([100], false),
      analyzeOrderedSlotIndices([0], true, false),
      analyzeOrderedSlotIndices([0], false, true),
    ]) {
      expect(contract.invalid).toBe(true)
    }
  })
})
