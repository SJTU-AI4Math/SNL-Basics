// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MarkdownBody } from './markdown-body'

afterEach(cleanup)

describe('MarkdownBody', () => {
  it('publishes the authoritative color scheme for its token palette', () => {
    const view = render(<MarkdownBody source={'`code`'} color_scheme="dark" />)
    expect(view.container.querySelector('.snl-markdown-body')?.getAttribute('data-color-scheme')).toBe('dark')
    view.rerender(<MarkdownBody source={'`code`'} color_scheme="light" />)
    expect(view.container.querySelector('.snl-markdown-body')?.getAttribute('data-color-scheme')).toBe('light')
  })

  it('renders GFM structure, safe links, images, and KaTeX math together', () => {
    const source = [
      '# Heading',
      '',
      '- [x] complete',
      '- [ ] pending',
      '',
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      'Visit <https://example.com> and render $x^2$.',
      '',
      '![diagram](assets/diagram.svg)',
      '',
      '<script>window.pwned = true</script>',
    ].join('\n')
    const view = render(<MarkdownBody source={source} image_url_transform={(url) => `safe:${url}`} />)

    expect(view.getByRole('heading', { name: 'Heading', level: 1 })).toBeTruthy()
    expect(view.container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2)
    expect(view.container.querySelector('table')?.textContent).toContain('12')
    expect(view.getByRole('link', { name: 'https://example.com' }).getAttribute('href')).toBe('https://example.com')
    expect(view.getByRole('img', { name: 'diagram' }).getAttribute('src')).toBe('safe:assets/diagram.svg')
    expect(view.container.querySelector('.katex')).not.toBeNull()
    expect(view.container.querySelector('script')).toBeNull()
  })

  it('highlights mainstream fenced languages while leaving inline code alone', () => {
    const source = [
      'Inline `const value = 1` stays plain.',
      '',
      '```typescript',
      'const answer: number = 42',
      'console.log("value", answer)',
      '```',
      '',
      '```python',
      'def greet(name: str) -> str:',
      '    return f"hello {name}"',
      '```',
    ].join('\n')
    const view = render(<MarkdownBody source={source} />)
    const blocks = view.container.querySelectorAll('pre > code')

    expect(blocks).toHaveLength(2)
    expect(blocks[0].classList.contains('hljs')).toBe(true)
    expect(blocks[0].classList.contains('language-typescript')).toBe(true)
    expect(blocks[0].querySelector('.hljs-keyword')?.textContent).toBe('const')
    expect(blocks[0].querySelector('.hljs-string')?.textContent).toContain('value')
    expect(blocks[1].classList.contains('hljs')).toBe(true)
    expect(blocks[1].classList.contains('language-python')).toBe(true)
    expect(blocks[1].querySelector('.hljs-keyword')?.textContent).toBe('def')
    expect(view.container.querySelector('p > code')?.classList.contains('hljs')).toBe(false)
  })

  it('provides deterministic basic Lean and Lean 4 highlighting without an LSP', () => {
    const source = [
      '```lean4',
      'import Mathlib',
      '',
      '/- A basic theorem. -/',
      'theorem add_zero (n : Nat) : n + 0 = n := by',
      '  simpa using Nat.add_zero n',
      '',
      'def greeting : String := "hello"',
      '#check greeting',
      '```',
    ].join('\n')
    const view = render(<MarkdownBody source={source} />)
    const code = view.container.querySelector('pre > code')!

    expect(code.classList.contains('hljs')).toBe(true)
    expect(code.classList.contains('language-lean4')).toBe(true)
    expect(Array.from(code.querySelectorAll('.hljs-keyword')).map((node) => node.textContent)).toEqual(
      expect.arrayContaining(['import', 'theorem', 'by', 'def']),
    )
    expect(code.querySelector('.hljs-comment')?.textContent).toContain('A basic theorem')
    expect(code.querySelector('.hljs-type')?.textContent).toBe('Nat')
    expect(code.querySelector('.hljs-string')?.textContent).toBe('"hello"')
    expect(code.querySelector('.hljs-meta')?.textContent).toBe('#check')
  })

  it('does not highlight keyword prefixes inside Lean identifiers', () => {
    const source = "```lean4\ndef theorem' : Nat := 0\ndef theoremα : Nat := 1\n```"
    const { container } = render(<MarkdownBody source={source} />)
    const keywords = [...container.querySelectorAll('.hljs-keyword')].map((node) => node.textContent)
    expect(keywords).toEqual(['def', 'def'])
    expect(container.querySelector('code')?.textContent).toContain("theorem'")
    expect(container.querySelector('code')?.textContent).toContain('theoremα')
  })

  it('distinguishes Lean character literals from apostrophes in identifiers', () => {
    const source = "```lean4\ndef keepPrime (n' : Nat) := ('a', n')\ndef pairedPrime (x'y' : Nat) := x'y'\n```"
    const { container } = render(<MarkdownBody source={source} />)
    const strings = [...container.querySelectorAll('.hljs-string')].map((node) => node.textContent)
    expect(strings).toEqual(["'a'"])
    expect(container.querySelector('code')?.textContent).toContain("n'")
    expect(container.querySelector('code')?.textContent).toContain("x'y'")
  })

  it('does not guess a language or fail on plaintext and unknown fences', () => {
    const source = [
      '```text',
      'const is just prose here',
      '```',
      '',
      '```made-up-language',
      '<tag>still text</tag>',
      '```',
    ].join('\n')
    const view = render(<MarkdownBody source={source} />)
    const blocks = view.container.querySelectorAll('pre > code')

    expect(blocks).toHaveLength(2)
    expect(blocks[0].querySelector('[class^="hljs-"]')).toBeNull()
    expect(blocks[1].textContent).toContain('<tag>still text</tag>')
    expect(blocks[1].querySelector('[class^="hljs-"]')).toBeNull()
  })
})
