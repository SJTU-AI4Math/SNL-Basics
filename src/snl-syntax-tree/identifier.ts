/**
 * SNL plain-identifier policy.
 *
 * ASCII remains an explicit compatibility allow-list because ASCII punctuation
 * carries SNL syntax. Non-ASCII code points are accepted broadly unless they
 * are whitespace or invisible/control characters. This keeps Unicode names
 * lossless without letting structural ASCII punctuation become ambiguous.
 */
const ASCII_START = /^[A-Za-z0-9_\\]$/
const ASCII_CONTINUE = /^[A-Za-z0-9_.-]$/
const UNSAFE_UNICODE = /[\p{White_Space}\p{Cc}\p{Cf}\p{Cs}]/u

function unicodeScalarAt(input: string, index: number): string | null {
  const codePoint = input.codePointAt(index)
  return codePoint === undefined ? null : String.fromCodePoint(codePoint)
}

export function snlIdentifierCharLength(
  input: string,
  index: number,
  initial: boolean,
): number {
  const char = unicodeScalarAt(input, index)
  if (char === null) return 0
  if (char.codePointAt(0)! <= 0x7f) {
    return (initial ? ASCII_START : ASCII_CONTINUE).test(char) ? 1 : 0
  }
  return UNSAFE_UNICODE.test(char) ? 0 : char.length
}

/** True exactly when `value` is one complete SNL plain IDENT token. */
export function isSnlIdentifier(value: string): boolean {
  if (value.length === 0) return false
  let index = 0
  let length = snlIdentifierCharLength(value, index, true)
  if (length === 0) return false
  index += length
  while (index < value.length) {
    length = snlIdentifierCharLength(value, index, false)
    if (length === 0) return false
    index += length
  }
  return true
}
