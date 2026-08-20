// @vitest-environment jsdom
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { ForeignBoxHost } from './foreign-box-host'
import { FormulaForeignSurface } from './formula-foreign-surface'
import type { FormulaForeignPlan } from './render-source'

const template = {
  mode: 'block' as const,
  body: '#0',
  block_template_name: 'svg',
  svg_template: {},
}
function plan(identity: string, generation: number): FormulaForeignPlan {
  return {
    identity, generation, producer: 'p', rendererKey: 'svg', accessibilityLabel: 'diagram',
    metrics: { widthEm: 2, heightEm: 1.5, depthEm: 0.5, totalHeightEm: 2 },
    node: { macro_name: 'diagram', kind: '', mdata: null, children: [] },
    template, treePath: [0],
  }
}

beforeEach(() => {
  let nextFrame = 1
  vi.stubGlobal('requestAnimationFrame', (_callback: FrameRequestCallback) => nextFrame++)
  vi.stubGlobal('cancelAnimationFrame', () => undefined)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('FormulaForeignSurface lifecycle', () => {
  it('renders an accessible deterministic fallback during SSR without marker effects', () => {
    const html = renderToString(
      <ForeignBoxHost>
        <FormulaForeignSurface plan={plan('ssr', 1)} marker={{} as HTMLElement} widthPx={40} heightPx={20} child={<button>live</button>} />
      </ForeignBoxHost>,
    )
    expect(html).toContain('aria-label="diagram"')
    expect(html).toContain('diagram')
    expect(html).not.toContain('data-snl-formula-foreign-surface')
  })

  it('keeps marker dimensions as minima while leaving the live child intrinsically measurable', () => {
    const marker = document.createElement('span')
    document.body.append(marker)
    const view = render(
      <ForeignBoxHost>
        <FormulaForeignSurface plan={plan('intrinsic', 1)} marker={marker} widthPx={40} heightPx={20} child={<button style={{ width: '80px', height: '30px' }}>long</button>} />
      </ForeignBoxHost>,
    )
    const surface = view.container.querySelector<HTMLElement>('.snl-formula-foreign-surface')!
    expect(surface.style.minWidth).toBe('40px')
    expect(surface.style.minHeight).toBe('20px')
    expect(surface.style.width).toBe('')
    expect(surface.style.height).toBe('')
    view.unmount(); marker.remove()
  })

  it('revokes stale marker authority on replacement and unmount', () => {
    const first = document.createElement('span')
    const second = document.createElement('span')
    document.body.append(first, second)
    const view = render(
      <StrictMode><ForeignBoxHost>
        <FormulaForeignSurface plan={plan('one', 1)} marker={first} widthPx={40} heightPx={20} child={<button>one</button>} />
      </ForeignBoxHost></StrictMode>,
    )
    expect(first.getAttribute('aria-hidden')).toBe('true')
    expect(first.getAttribute('role')).toBe('presentation')
    view.rerender(
      <StrictMode><ForeignBoxHost>
        <FormulaForeignSurface plan={plan('two', 2)} marker={second} widthPx={40} heightPx={20} child={<button>two</button>} />
      </ForeignBoxHost></StrictMode>,
    )
    expect(first.hasAttribute('aria-hidden')).toBe(false)
    expect(first.hasAttribute('role')).toBe(false)
    expect(second.getAttribute('aria-hidden')).toBe('true')
    view.unmount()
    expect(second.hasAttribute('aria-hidden')).toBe(false)
    expect(second.hasAttribute('role')).toBe(false)
    first.remove(); second.remove()
  })
})
