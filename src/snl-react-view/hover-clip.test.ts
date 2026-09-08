// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { applySnlHoverHighlight, clearSnlHoverHighlight } from './hover-apply'

const containers: HTMLElement[] = []
afterEach(() => { containers.forEach(clearSnlHoverHighlight); containers.length = 0; document.body.innerHTML = '' })
function setup() {
  document.body.innerHTML = '<div id="clip"><div id="host" class="katex-html"><span id="t" data-kind="const" data-name="target">text</span></div></div>'
  const clip = document.getElementById('clip')!, host = document.getElementById('host')!, target = document.getElementById('t')!
  clip.style.overflowX = 'hidden'; clip.style.overflowY = 'auto'
  // Border box 100×100, 5px border. Client area excludes border/scrollbars.
  clip.getBoundingClientRect = () => new DOMRect(20, 30, 100, 100)
  Object.defineProperties(clip, { offsetWidth: { value: 100 }, offsetHeight: { value: 100 }, clientLeft: { value: 5 }, clientTop: { value: 5 }, clientWidth: { value: 80 }, clientHeight: { value: 90 } })
  target.getBoundingClientRect = () => new DOMRect(10, 10, 120, 160)
  target.getClientRects = () => Object.assign([target.getBoundingClientRect()], { item: () => target.getBoundingClientRect() })
  containers.push(host)
  const paint = () => document.querySelector<HTMLElement>('[data-snl-highlight-overlay]')!
  return { clip, host, target, paint }
}
describe('highlight overflow paint clipping', () => {
  it('crops the original frame to the client area without inventing a new edge', () => {
    const { host, target, paint } = setup(); applySnlHoverHighlight(target, host)
    expect(paint().style.width).toBe('120px'); expect(paint().style.height).toBe('160px')
    expect(paint().style.clipPath).toBe('inset(25px 25px 45px 15px)')
    expect(paint().hidden).toBe(false)
  })
  it('hides fully clipped geometry then restores it on real-owner scroll updates', () => {
    const { clip, host, target, paint } = setup()
    target.getBoundingClientRect = () => new DOMRect(10, -200, 120, 30)
    applySnlHoverHighlight(target, host); expect(paint().hidden).toBe(true)
    target.getBoundingClientRect = () => new DOMRect(10, 10, 120, 160)
    clip.dispatchEvent(new Event('scroll')); expect(paint().hidden).toBe(false)
    expect(paint().style.clipPath).toBe('inset(25px 25px 45px 15px)')
  })
  it('clips each axis independently and clears obsolete clipping', () => {
    const { clip, host, target, paint } = setup(); clip.style.overflowX = 'visible'; clip.style.overflowY = 'clip'
    applySnlHoverHighlight(target, host); expect(paint().style.clipPath).toBe('inset(25px 0px 45px 0px)')
    clip.style.overflowY = 'visible'; clip.dispatchEvent(new Event('scroll'))
    expect(paint().style.clipPath).toBe('none'); expect(paint().hidden).toBe(false)
  })
  it('intersects nested clipping ancestors', () => {
    const { host, target, paint } = setup(); host.style.overflowX = 'clip'; host.style.overflowY = 'clip'
    host.getBoundingClientRect = () => new DOMRect(40, 50, 30, 40)
    Object.defineProperties(host, { offsetWidth: { value: 30 }, offsetHeight: { value: 40 }, clientWidth: { value: 30 }, clientHeight: { value: 40 } })
    applySnlHoverHighlight(target, host); expect(paint().style.clipPath).toBe('inset(40px 60px 80px 30px)')
  })
  it.each(['inline', 'contents'])('does not invent an overflow clip on a %s wrapper', (display) => {
    const { clip, host, target, paint } = setup(); clip.style.display = display
    applySnlHoverHighlight(target, host); expect(paint().style.clipPath).toBe('none')
  })
})
