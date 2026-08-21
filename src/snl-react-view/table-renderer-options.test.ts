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
  })

  it('rejects table options attached to a different renderer', () => {
    expect(() => assert_valid_style_template(style({
      mode: 'block', body: '#*', block_template_name: 'list',
      table: { composition: 'rows' },
    }), true)).toThrow(/built-in table renderer/i)
  })
})
