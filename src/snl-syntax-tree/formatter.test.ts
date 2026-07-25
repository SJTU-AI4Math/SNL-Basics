import { describe, expect, it } from 'vitest'
import { SnlDslFormatter } from '../snl-react-view'

describe('SnlDslFormatter', () => {
  it('keeps subtrees with at most three parenthesis levels inline by default', () => {
    const formatter = new SnlDslFormatter()

    expect(formatter.format('root(a(b(c(d))))')).toBe([
      'root(',
      '    a(b(c(d)))',
      ')',
    ].join('\n'))
  })

  it('preserves binders, source references, styles, and delimited names', () => {
    const formatter = new SnlDslFormatter()

    expect(formatter.format('@quant@ctx[display]($x$, %hello%)')).toBe(
      '@quant@ctx[display]($x$, %hello%)',
    )
  })

  it('uses the configured indentation and inline parenthesis depth', () => {
    const formatter = new SnlDslFormatter(2, 1)

    expect(formatter.format('root(branch(x), deep(mid(y)))')).toBe([
      'root(',
      '  branch(x),',
      '  deep(',
      '    mid(y)',
      '  )',
      ')',
    ].join('\n'))
  })

  it('does not turn inferred legacy binders into explicit @ binders', () => {
    const formatter = new SnlDslFormatter()

    expect(formatter.format('FOL.forall.binder(x, body)')).toBe(
      'FOL.forall.binder(x, body)',
    )
  })

  it('preserves an explicit @ on a legacy quantifier', () => {
    const formatter = new SnlDslFormatter()

    expect(formatter.format('@FOL.forall.binder(x, body)')).toBe(
      '@FOL.forall.binder(x, body)',
    )
  })

  it('accepts zero and rejects invalid formatting parameters', () => {
    expect(() => new SnlDslFormatter(0, 0)).not.toThrow()
    expect(() => new SnlDslFormatter(-1, 3)).toThrow(RangeError)
    expect(() => new SnlDslFormatter(4, 1.5)).toThrow(RangeError)
    expect(() => new SnlDslFormatter(Number.NaN, 3)).toThrow(RangeError)
    expect(() => new SnlDslFormatter(4, Number.POSITIVE_INFINITY)).toThrow(RangeError)
    expect(() => new SnlDslFormatter(Number.MAX_SAFE_INTEGER, 3)).toThrow(RangeError)
    expect(() => new SnlDslFormatter(Number.MAX_VALUE, 3)).toThrow(RangeError)
  })

  it('formats very wide valid expressions without spreading children onto the call stack', () => {
    const formatter = new SnlDslFormatter()
    const source = `root(${Array.from({ length: 150_000 }, () => 'x').join(',')})`

    expect(() => formatter.format(source)).not.toThrow()
  })

  it('formats nested wide explicit-binder expressions without overflowing annotation', () => {
    const formatter = new SnlDslFormatter()
    const leaves = Array.from({ length: 150_000 }, () => 'x').join(',')
    const source = `root(wrapper(@branch(${leaves})), z)`

    expect(() => formatter.format(source)).not.toThrow()
  })
})
