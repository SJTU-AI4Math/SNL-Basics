// @vitest-environment jsdom
//
// Cat 2026-07-10: text-mode nodes now render via React TextRun instead of
// KaTeX \text{...}. This regression asserts the NEW feature that
// motivated the refactor: a text macro can now contain a BLOCK macro
// (e.g. enumerate), which the old \text{...} pipeline couldnt render
// because KaTeX has no way to embed a React <ol> mid-\text{}.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'
import { createSnlSyntaxTreeNode } from '../snl-syntax-tree/types'
import type { SnlMacro, SnlMacroRecord } from '../snl-macro/types'
import { testDriver } from '../snl-react-view/test-helpers'

const proseWithList: SnlMacro = {
  name: 'note', description: 'A prose note that references a list',
  source: { entries: [], urls: [] },
  dynamic_arity: false,
  tags: [],
  default_style: { en: 'default' },
  styles: [
    { style_name: 'default', mode: 'text', template: '注意以下几点：#0', tags: [] },
  ],
}
const enumerateMacro: SnlMacro = {
  name: 'enumerate', description: 'Ordered list',
  source: { entries: [], urls: [] },
  dynamic_arity: true,
  tags: [],
  default_style: { en: 'default' },
  styles: [
    {
      style_name: 'default',
      mode: 'block',
      template: '',
      block_template_name: 'enumerate', tags: [],
    },
  ],
}

const db: SnlMacroRecord = {
  note: proseWithList,
  enumerate: enumerateMacro,
}

afterEach(cleanup)

describe('text-mode container with block-mode child (cat 2026-07-10)', () => {
  it('renders a text macro that embeds an enumerate block as native HTML', async () => {
    const enumNode = createSnlSyntaxTreeNode('enumerate', {
      children: [
        createSnlSyntaxTreeNode('first', { kind: 'fvar' }),
        createSnlSyntaxTreeNode('second', { kind: 'fvar' }),
      ],
    })
    const tree = createSnlSyntaxTreeNode('note', { children: [enumNode] })
    const { container } = render(
      <SnlSyntaxTreeView tree={tree} macro_data_driver={testDriver(db)} />,
    )
    await waitFor(() => {
      // The outer text macro renders as a .snl-text span.
      const text = container.querySelector('.snl-text')
      expect(text).not.toBeNull()
      expect(text!.textContent).toContain('注意以下几点：')
      // The enumerate child renders as a real <ol> INSIDE the text span
      // — this is the whole point of the refactor.
      const ol = container.querySelector('ol.snl-block-enumerate')
      expect(ol).not.toBeNull()
      expect(ol!.querySelectorAll('li')).toHaveLength(2)
    })
  })
})
