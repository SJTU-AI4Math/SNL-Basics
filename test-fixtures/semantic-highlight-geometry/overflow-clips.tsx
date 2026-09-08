import React from 'react'
import { createRoot } from 'react-dom/client'
import { SnlSyntaxTreeView } from '../../src/components/SnlSyntaxTreeView'
import { MacroDataDriver } from '../../src/snl-macro/macro-data-driver'
import { parseSnlSyntaxTree } from '../../src/snl-syntax-tree/parser'
import { applySnlHoverHighlight, clearSnlHoverHighlight } from '../../src/snl-react-view/hover-apply'

const settle = () => new Promise<void>(r => setTimeout(r, 60))
const close = (a: number, b: number) => Math.abs(a - b) < .8
const box = (r: DOMRect) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
function clientRect(el: HTMLElement) {
  const r = el.getBoundingClientRect(), sx = r.width / el.offsetWidth, sy = r.height / el.offsetHeight
  const left = r.left + el.clientLeft * sx, top = r.top + el.clientTop * sy
  return { left, top, right: left + el.clientWidth * sx, bottom: top + el.clientHeight * sy }
}
function verifyPaint(clippers: HTMLElement[]) {
  const clips = clippers.map(clientRect)
  const clip = { left: Math.max(...clips.map(c => c.left)), top: Math.max(...clips.map(c => c.top)), right: Math.min(...clips.map(c => c.right)), bottom: Math.min(...clips.map(c => c.bottom)) }
  const nodes = [...document.querySelectorAll<HTMLElement>('[data-snl-highlight-overlay]:not([hidden])')]
  const paint = nodes.map(el => {
    const raw = el.getBoundingClientRect(), css = getComputedStyle(el).clipPath
    const values = css === 'none' ? [0, 0, 0, 0] : css.slice(6, -1).split(/\s+/).map(parseFloat)
    const [t, r, b, l] = values.length === 1 ? Array(4).fill(values[0]) : values.length === 2 ? [values[0], values[1], values[0], values[1]] : values.length === 3 ? [values[0], values[1], values[2], values[1]] : values
    const painted = { left: raw.left + l, top: raw.top + t, right: raw.right - r, bottom: raw.bottom - b }
    if (!Object.values(painted).every(Number.isFinite)) throw new Error('Invalid computed clip inset')
    if (painted.left < clip.left - .8 || painted.right > clip.right + .8 || painted.top < clip.top - .8 || painted.bottom > clip.bottom + .8) throw new Error('Highlight paint escaped overflow clip')
    if (painted.right <= painted.left || painted.bottom <= painted.top) throw new Error('Fully clipped frame still visible')
    return { raw: box(raw), painted, css }
  })
  return { clip, paint }
}

async function verifyBodyPropagation() {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'width:600px;height:400px;border:0'
  document.body.append(iframe)
  const doc = iframe.contentDocument!
  doc.open(); doc.write('<!doctype html><html><head><style>html{overflow:visible}body{margin:0;height:100px;overflow:auto}.snl-highlight-overlay{position:absolute;display:block}.snl-highlight-overlay[hidden]{display:none}</style></head><body><div style="height:200px"></div><div id="host" class="katex-html"><span id="target" data-kind="const" data-name="target">Visible target</span></div><div style="height:500px"></div></body></html>'); doc.close()
  const host = doc.getElementById('host')!, target = doc.getElementById('target')!
  const results: unknown[] = []
  try {
    await settle()
    for (const mode of ['viewport', 'body-scroll', 'html-contain', 'body-contain']) {
      clearSnlHoverHighlight(host)
      doc.documentElement.style.overflow = mode === 'body-scroll' ? 'hidden' : 'visible'
      doc.documentElement.style.contain = mode === 'html-contain' ? 'layout' : 'none'
      doc.body.style.contain = mode === 'body-contain' ? 'layout' : 'none'
      doc.body.scrollTop = 0; doc.defaultView!.scrollTo(0, 0)
      await settle()
      const rect = target.getBoundingClientRect()
      const hit = doc.elementFromPoint(rect.left + 3, rect.top + 3)
      const visible = hit === target || !!hit && target.contains(hit)
      if (visible !== (mode === 'viewport')) throw new Error(`Body fixture did not establish ${mode} used overflow`)
      applySnlHoverHighlight(target, host)
      const overlay = doc.querySelector<HTMLElement>('[data-snl-highlight-overlay]')!
      if (overlay.hidden === visible) throw new Error(`Body overflow propagation mismatch: ${mode}`)
      results.push({ mode, visible, hidden: overlay.hidden })
      if (mode !== 'viewport') {
        doc.body.scrollTop = 180; doc.body.dispatchEvent(new Event('scroll'))
        if (overlay.hidden || doc.body.scrollTop === 0) throw new Error(`Independent body scroll did not restore target: ${mode}`)
      }
    }
    return results
  } finally { clearSnlHoverHighlight(host); iframe.remove() }
}

export async function verifyOverflowClipping() {
  const outer = document.createElement('div'), scroller = document.createElement('div'), mount = document.createElement('div'), spacer = document.createElement('div')
  outer.style.cssText = 'width:330px;height:160px;overflow:hidden;border:5px solid gray;padding:8px;transform:translate(11px,7px) scale(1.1);transform-origin:top left'
  scroller.style.cssText = 'width:400px;height:180px;overflow:auto;border:7px solid gray;padding:9px'
  mount.style.width = '600px'; spacer.style.cssText = 'height:600px;width:900px'
  scroller.append(mount, spacer); outer.append(scroller); document.body.prepend(outer)
  const root = createRoot(mount), driver = new MacroDataDriver({ queries: { query_macro: async () => null } })
  const results: unknown[] = []
  try {
    root.render(<SnlSyntaxTreeView tree={parseSnlSyntaxTree('%SELECT alpha beta gamma delta epsilon zeta eta theta\nsecond line\nthird line\nfourth line\nfifth line%')} macro_data_driver={driver}/>)
    for (let i = 0; i < 30 && !mount.querySelector('.snl-text'); i++) await settle()
    await document.fonts.ready
    const target = mount.querySelector<HTMLElement>('.snl-text')!
    if (!target) throw new Error('Clip fixture never rendered')
    applySnlHoverHighlight(target, mount)
    const initial = verifyPaint([outer, scroller]); if (!initial.paint.length) throw new Error('Clip fixture has no visible text')
    results.push({ state: 'initial-scaled-nested', ...initial })
    scroller.scrollTop = 55; scroller.scrollLeft = 40; scroller.dispatchEvent(new Event('scroll'))
    const moved = verifyPaint([outer, scroller]); if (!moved.paint.length) throw new Error('Partially visible text lost all frames')
    if (!moved.paint.some(p => p.raw.top < moved.clip.top && close(p.painted.top, moved.clip.top))) throw new Error('No partially cropped original frame: fixture or artificial-edge regression')
    results.push({ state: 'partial-two-axis', ...moved })
    // Only the clipping ancestor changes size: target dimensions do not.
    outer.style.height = '60px'; await settle(); results.push({ state: 'ancestor-resize', ...verifyPaint([outer, scroller]) })
    scroller.scrollTop = 500; scroller.dispatchEvent(new Event('scroll'))
    if (verifyPaint([outer, scroller]).paint.length) throw new Error('Fully scrolled-out target retained visible frames')
    results.push({ state: 'fully-hidden' })
    scroller.scrollTop = 0; scroller.scrollLeft = 0; scroller.dispatchEvent(new Event('scroll'))
    if (!verifyPaint([outer, scroller]).paint.length) throw new Error('Scroll-back failed to restore clipped frames')
    outer.style.overflow = 'visible'; scroller.style.overflow = 'visible'; await settle()
    const overlays = [...document.querySelectorAll<HTMLElement>('[data-snl-highlight-overlay]')]
    if (overlays.some(e => e.hidden || getComputedStyle(e).clipPath !== 'none')) throw new Error('Obsolete clip survived overflow removal')
    clearSnlHoverHighlight(mount)
    // An atomic tall formula must be cropped, not shrunk into a different frame.
    outer.style.overflow = 'hidden'; outer.style.height = '35px'; scroller.style.overflow = 'auto'
    root.render(<SnlSyntaxTreeView tree={parseSnlSyntaxTree('$\\frac{\\sum_{i=0}^{n} i}{\\frac{a}{b}}$')} macro_data_driver={driver}/>)
    for (let i = 0; i < 30 && !mount.querySelector('.snl-math-span'); i++) await settle()
    await settle(); const formula = mount.querySelector<HTMLElement>('.katex-html [data-kind]')!
    if (!formula) throw new Error('Formula clip fixture missing')
    applySnlHoverHighlight(formula, mount)
    results.push({ state: 'atomic-formula', ...verifyPaint([outer, scroller]) })
    clearSnlHoverHighlight(mount)
    if (document.querySelector('[data-snl-highlight-overlay]')) throw new Error('Clipping cleanup leaked owned overlays')
    results.push({ bodyPropagation: await verifyBodyPropagation() })
    return results
  } finally { clearSnlHoverHighlight(mount); root.unmount(); outer.remove() }
}
