// @vitest-environment node
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ForeignBoxHost } from './foreign-box-host'
import { useForeignBox } from './use-foreign-box'

function ServerConsumer() {
  const foreign = useForeignBox({
    identity: { treePath: '', generation: 0, producer: 'server@1' },
    child: createElement('button', null, 'interactive foreign child'),
    ssrFallback: createElement('span', { role: 'img', 'aria-label': 'formula fallback' }, 'server formula'),
  })
  return createElement('div', null, foreign.ssrFallback)
}

describe('ForeignBoxHost SSR', () => {
  it('evaluates and renders without DOM globals or layout-effect warnings', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const html = renderToString(createElement(ForeignBoxHost, null, createElement('span', null, 'server child')))
    expect(html).toContain('server child')
    expect(error.mock.calls.flat().join(' ')).not.toMatch(/useLayoutEffect/i)
    error.mockRestore()
  })

  it('renders an accessible hook fallback without registering during server render', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const html = renderToString(createElement(ForeignBoxHost, null, createElement(ServerConsumer)))
    expect(html).toContain('server formula')
    expect(html).toContain('aria-label="formula fallback"')
    expect(html).not.toContain('interactive foreign child')
    expect(error.mock.calls.flat().join(' ')).not.toMatch(/useLayoutEffect/i)
    error.mockRestore()
  })
})
