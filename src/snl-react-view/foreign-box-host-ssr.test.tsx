// @vitest-environment node
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ForeignBoxHost } from './foreign-box-host'

describe('ForeignBoxHost SSR', () => {
  it('evaluates and renders without DOM globals or layout-effect warnings', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const html = renderToString(createElement(ForeignBoxHost, null, createElement('span', null, 'server child')))
    expect(html).toContain('server child')
    expect(error.mock.calls.flat().join(' ')).not.toMatch(/useLayoutEffect/i)
    error.mockRestore()
  })
})
