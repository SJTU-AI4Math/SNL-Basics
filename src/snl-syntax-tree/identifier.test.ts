import { describe, expect, it } from 'vitest'
import { isSnlIdentifier } from './identifier'

describe('isSnlIdentifier', () => {
  it('accepts the legacy ASCII allow-list and broad visible Unicode', () => {
    for (const name of [
      'foo', 'foo.bar', 'foo-bar', '\\foo', '1.5',
      '群.是群', '日本語.写像', 'Ελληνικά.Ομάδα', 'Théorie.groupe',
      'e\u0301', '几何.∠', 'emoji.猫🐈', '全角，标点',
    ]) expect(isSnlIdentifier(name), name).toBe(true)
  })

  it('rejects structural or miscellaneous ASCII punctuation', () => {
    const punctuation = `!"#$%&'()*+,/:;<=>?@[\\]^\`{|}~`
    for (const char of punctuation) {
      expect(isSnlIdentifier(`a${char}b`), JSON.stringify(char)).toBe(false)
    }
    expect(isSnlIdentifier('.foo')).toBe(false)
    expect(isSnlIdentifier('-foo')).toBe(false)
    expect(isSnlIdentifier('foo\\bar')).toBe(false)
  })

  it('rejects whitespace, controls, format controls, and lone surrogates', () => {
    for (const char of [
      ' ', '\n', '\t', '\u00a0', '\u3000', '\u2028',
      '\u0000', '\u200b', '\u200d', '\u202e', '\ud800',
    ]) expect(isSnlIdentifier(`a${char}b`), JSON.stringify(char)).toBe(false)
  })
})
