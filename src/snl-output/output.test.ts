import { describe, expect, it } from 'vitest'
import { toTypst, buildTypstPreamble, toLatex, toMarkdown, toText } from './index'
import type { SnlMacro } from '../snl-macro/types'
import type { SnlSyntaxTree } from '../snl-syntax-tree/node-types'

const leaf = (name: string): SnlSyntaxTree => ({
  name,
  kind: '',
  mdata: null,
  mode: 'math',
  children: [],
})

const tree: SnlSyntaxTree = {
  name: 'Add.add.infix',
  kind: 'const',
  mdata: null,
  mode: 'math',
  children: [leaf('a'), leaf('b')],
}

const macro: SnlMacro = {
  name: 'x',
  description: '',
  source: { entries: [], urls: [] },
  typst: { built_in: '#let x=1', synthesis: { output_type: 'formula', macro: '' } },
  latex: { built_in: '', synthesis: { output_type: 'formula', macro: '' } },
  markdown: '',
  text: '',
  katex_react: { arity: 'fixed', mode: 'math', template: '' },
}

describe('snl-output stubs', () => {
  it('toTypst returns a TODO marker with nested-call serialization', () => {
    expect(toTypst(tree, {})).toBe('TODO(typst): Add.add.infix(a, b)')
  })

  it('toLatex returns a TODO marker', () => {
    expect(toLatex(tree, {})).toBe('TODO(latex): Add.add.infix(a, b)')
  })

  it('toMarkdown returns a TODO marker', () => {
    expect(toMarkdown(tree, {})).toBe('TODO(markdown): Add.add.infix(a, b)')
  })

  it('toText returns plain nested-call notation', () => {
    expect(toText(tree, {})).toBe('Add.add.infix(a, b)')
  })

  it('buildTypstPreamble concatenates non-empty built_in declarations', () => {
    expect(buildTypstPreamble([macro])).toBe('#let x=1')
    expect(buildTypstPreamble([])).toBe('')
  })
})
