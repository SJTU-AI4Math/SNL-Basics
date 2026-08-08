import { describe, expect, it } from 'vitest'
import { SnlDslFormatter } from './formatter'
import { SnlSyntaxTreeParseError, parseSnlSyntaxTree } from './parser'

describe('temporary Macro tree-coordinate names', () => {
  it('uses # for a delimited root and preserves its payload separately', () => {
    const tree = parseSnlSyntaxTree('%$x$ is a number%')
    expect(tree.macro_name).toBe('#')
    expect(tree.temporary_source).toBe('$x$ is a number')
    expect(tree.env_mode).toBe('text')
  })

  it('uses child-index paths for nested temporary Macros', () => {
    const tree = parseSnlSyntaxTree('F(%left%,G($x$,`code`))')
    expect(tree.children[0]).toMatchObject({
      macro_name: '#0',
      temporary_source: 'left',
      env_mode: 'text',
    })
    expect(tree.children[1].children[0]).toMatchObject({
      macro_name: '#1.0',
      temporary_source: 'x',
      env_mode: 'formula_inline',
    })
    expect(tree.children[1].children[1]).toMatchObject({
      macro_name: '#1.1',
      temporary_source: 'code',
      env_mode: 'formula_inline',
      temporary_format: 'texttt',
    })
  })

  it('formats coordinate-named temporary Macros from their preserved payload', () => {
    expect(new SnlDslFormatter().format('F(%left%,$x$,`code`)'))
      .toBe('F(%left%, $x$, `code`)')
  })

  it('rejects an unclosed backtick delimiter', () => {
    expect(() => parseSnlSyntaxTree('`code')).toThrow(SnlSyntaxTreeParseError)
    expect(() => parseSnlSyntaxTree('`code')).toThrow(/Unclosed ` delimiter/)
  })
})
