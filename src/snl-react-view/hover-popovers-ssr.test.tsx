import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { HoverPopoverProvider } from './hover-popovers'

describe('HoverPopoverProvider SSR lifecycle', () => {
  it('renders without a useLayoutEffect server warning', () => {
    const errors: unknown[][] = []
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args)
    })

    try {
      const html = renderToString(
        <HoverPopoverProvider<string> renderPopover={() => null}>
          <span>server child</span>
        </HoverPopoverProvider>,
      )
      expect(html).toContain('server child')
      expect(errors.filter(([message]) => String(message).includes('useLayoutEffect'))).toEqual([])
    } finally {
      consoleError.mockRestore()
    }
  })
})
