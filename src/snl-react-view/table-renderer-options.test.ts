import { describe, expect, it } from 'vitest'
import type { SnlMacroStyle } from '../snl-macro/types'
import { assert_valid_style_template } from './render-source'

function style(template: Record<string, unknown>): SnlMacroStyle {
  return {
    style_name: 'default',
    tags: [],
    template: template as SnlMacroStyle['template'],
  }
}

describe('table renderer template contract', () => {
  it('rejects malformed composition and partial theme CSS before rendering', () => {
    expect(() => assert_valid_style_template(style({
      mode: 'block', body: '#*', block_template_name: 'table',
      table: { composition: 'columns' },
    }), true)).toThrow(/table/i)

    expect(() => assert_valid_style_template(style({
      mode: 'block', body: '#*', block_template_name: 'table',
      table: {
        composition: 'rows',
        css: { light: { color: '#111111', background: '#ffffff', border: '#cccccc' } },
      },
    }), true)).toThrow(/light and dark/i)

    for (const unsafe of [
      'url(https://example.test/pixel)',
      'linear-gradient(red, red), url(https://example.test/pixel)',
      'var(--fallback, url(https://example.test/pixel))',
      'rgb(1 2 3\t/ 50%)',
      '\tred',
      'red\n',
      '\u000bred',
      `${' '.repeat(200)}red`,
      'rgb()',
      'rgb(/*)',
      'u\\72l(https://example.test/pixel)',
    ]) {
      expect(() => assert_valid_style_template(style({
        mode: 'block', body: '#*', block_template_name: 'table',
        table: {
          composition: 'rows',
          css: {
            light: { color: '#111', background: unsafe, border: '#ccc' },
            dark: { color: '#eee', background: '#222', border: '#555' },
          },
        },
      }), true)).toThrow(/CSS color/i)
    }
  })

  it('allows custom block renderer keys but rejects table options outside block mode', () => {
    expect(() => assert_valid_style_template(style({
      mode: 'block', body: '#*', block_template_name: 'extension-table-compat',
      table: { composition: 'rows' },
    }), true)).not.toThrow()
    expect(() => assert_valid_style_template(style({
      mode: 'text', body: '#0',
      table: { composition: 'rows' },
    }), false)).toThrow(/block mode/)
  })
})
