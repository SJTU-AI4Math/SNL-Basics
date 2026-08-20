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

  it('applies intrinsic and fixed-pixel generic sizing with an explicit overflow policy', () => {
    const marker = document.createElement('span')
    document.body.append(marker)
    const intrinsicPlan = { ...plan('generic-intrinsic', 1), layout: { width: 'intrinsic' as const, overflow: 'visible' as const } }
    const view = render(
      <ForeignBoxHost><FormulaForeignSurface plan={intrinsicPlan} marker={marker} widthPx={40} heightPx={20} child={<span>badge</span>} /></ForeignBoxHost>,
    )
    let surface = view.container.querySelector<HTMLElement>('.snl-formula-foreign-surface')!
    expect(surface.style.width).toBe('max-content')
    expect(surface.style.minWidth).toBe('')
    expect(surface.style.maxWidth).toBe('')
    expect(surface.style.overflow).toBe('visible')

    const fixedPlan = { ...plan('generic-fixed', 2), layout: { width: { px: 240 }, overflow: 'clip' as const } }
    view.rerender(
      <ForeignBoxHost><FormulaForeignSurface plan={fixedPlan} marker={marker} widthPx={40} heightPx={20} child={<span>table</span>} onMetricReport={vi.fn()} /></ForeignBoxHost>,
    )
    surface = view.container.querySelector<HTMLElement>('.snl-formula-foreign-surface')!
    expect(surface.style.width).toBe('240px')
    expect(surface.style.minWidth).toBe('240px')
    expect(surface.style.maxWidth).toBe('240px')
    expect(surface.style.height).toBe('max-content')
    expect(surface.style.overflow).toBe('clip')
    const witness = surface.querySelector<HTMLElement>('[data-snl-foreign-intrinsic="true"]')!
    expect(witness.style.width).toBe('240px')
    expect(witness.style.minWidth).toBe('240px')
    expect(witness.style.maxWidth).toBe('240px')
    view.unmount(); marker.remove()
  })

  it('uses a genuine block fallback container for fallback-block overflow', () => {
    const marker = document.createElement('span')
    document.body.append(marker)
    const fallbackPlan = { ...plan('generic-fallback', 1), layout: { width: { px: 180 }, overflow: 'fallback-block' as const } }
    const view = render(
      <ForeignBoxHost><FormulaForeignSurface plan={fallbackPlan} marker={marker} widthPx={40} heightPx={20} child={<table><tbody><tr><td>cell</td></tr></tbody></table>} /></ForeignBoxHost>,
    )
    expect(view.container.querySelector('div.snl-formula-foreign-fallback')).not.toBeNull()
    expect(view.container.querySelector('span.snl-formula-foreign-fallback')).toBeNull()
    view.unmount(); marker.remove()
  })

  it('converts viewport marker dimensions back to local CSS minima under positive scaling', () => {
    const marker = document.createElement('span')
    Object.defineProperties(marker, {
      offsetWidth: { value: 80, configurable: true },
      offsetHeight: { value: 40, configurable: true },
    })
    document.body.append(marker)
    const view = render(
      <ForeignBoxHost>
        <FormulaForeignSurface plan={plan('scaled', 1)} marker={marker} widthPx={40} heightPx={20} child={<button>scaled</button>} />
      </ForeignBoxHost>,
    )
    const surface = view.container.querySelector<HTMLElement>('.snl-formula-foreign-surface')!
    expect(surface.style.minWidth).toBe('80px')
    expect(surface.style.minHeight).toBe('40px')
    view.unmount(); marker.remove()
  })

  it('hands accessibility ownership from the enclosing reading-order marker to the live sidecar atomically', () => {
    const enclosing = document.createElement('span')
    enclosing.dataset.snlFormulaForeignMarker = 'marker'
    enclosing.innerHTML = '<span class="snlFormulaForeignMarker"><span class="rule"></span><span class="snlFormulaForeignFallbackText">diagram</span></span>'
    const geometry = enclosing.querySelector<HTMLElement>('.rule')!
    document.body.append(enclosing)
    const view = render(
      <ForeignBoxHost><FormulaForeignSurface plan={plan('a11y', 1)} marker={geometry} widthPx={40} heightPx={20} child={<svg role="img" aria-label="diagram" />} /></ForeignBoxHost>,
    )
    expect(enclosing.getAttribute('aria-hidden')).toBe('true')
    expect(enclosing.getAttribute('role')).toBe('presentation')
    const live = view.container.querySelector<SVGElement>('svg[role="img"]')!
    const stagingSidecar = live.closest<HTMLElement>('.snl-foreign-box')!
    expect(stagingSidecar.getAttribute('aria-hidden')).toBe('true')
    const fallback = view.container.querySelector<HTMLElement>('.snl-formula-foreign-fallback')!
    expect(fallback.getAttribute('aria-hidden')).toBeNull()
    view.unmount()
    expect(enclosing.hasAttribute('aria-hidden')).toBe(false)
    expect(enclosing.hasAttribute('role')).toBe(false)
    enclosing.remove()
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
