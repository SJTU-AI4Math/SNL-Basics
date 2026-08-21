export interface SnlSlotContract {
  positional_arity: number
  variadic: boolean
  invalid: boolean
}

const MAX_POSITIONAL_SLOT_INDEX = 99
const MAX_POSITIONAL_ARITY = MAX_POSITIONAL_SLOT_INDEX + 1

export function createSlotContract(
  positional_arity: number,
  variadic: boolean,
  invalid = false,
): SnlSlotContract {
  return {
    positional_arity,
    variadic,
    invalid:
      invalid ||
      !Number.isInteger(positional_arity) ||
      positional_arity < 0 ||
      positional_arity > MAX_POSITIONAL_ARITY,
  }
}

export function analyzeOrderedSlotIndices(
  indices: readonly number[],
  variadic: boolean,
  dynamic_arity?: boolean,
): SnlSlotContract {
  let maxIndex = -1
  let invalid = dynamic_arity !== undefined && dynamic_arity !== variadic
  for (const index of indices) {
    const validIndex =
      Number.isInteger(index) &&
      index >= 0 &&
      index <= MAX_POSITIONAL_SLOT_INDEX
    if (validIndex) maxIndex = Math.max(maxIndex, index)
    if (!validIndex) invalid = true
  }
  return createSlotContract(maxIndex + 1, variadic, invalid)
}

export function slotContractKey(contract: Pick<SnlSlotContract, 'positional_arity' | 'variadic'>): string {
  return `${contract.variadic ? 'dynamic' : 'fixed'}:${contract.positional_arity}`
}
