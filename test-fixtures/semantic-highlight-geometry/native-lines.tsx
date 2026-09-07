import React from 'react'
import { createRoot } from 'react-dom/client'
import { SnlSyntaxTreeView } from '../../src/components/SnlSyntaxTreeView'
import { MacroDataDriver } from '../../src/snl-macro/macro-data-driver'
import { parseSnlSyntaxTree } from '../../src/snl-syntax-tree/parser'
import type { SnlMacro } from '../../src/snl-macro/types'
import { applySnlHoverHighlight, clearSnlHoverHighlight } from '../../src/snl-react-view/hover-apply'

const macro = (name: string, body: string): SnlMacro => ({ name, kind: 'const', description: '', source: { entries: [], urls: [] }, tags: [], dynamic_arity: false, styles: [{ style_name: 'default', tags: [], template: { mode: 'text', body } }] })
const macros: Record<string, SnlMacro> = {
  Wrap: { ...macro('Wrap', 'BEFORE #0 AFTER AFTER'), kind: 'sub' },
  Inner: macro('Inner', 'nested alpha beta gamma delta epsilon zeta eta theta'),
  Nested: macro('Nested', 'SELECT #0 TAIL'),
  Repeated: macro('Repeated', 'SELECT #0 then #0'),
  Break: macro('Break', 'SELECT first\nsecond\nthird'),
  Blank: macro('Blank', 'SELECT first\n\nthird'),
  Dyn: { ...macro('Dyn', 'SELECT #*'), dynamic_arity: true, styles: [{ style_name: 'default', tags: [], template: { mode: 'text', body: 'SELECT #*', separator: '\n\n' } }] },
}
// Match the maintained --dump-dom virtual-time harness: RAF is not a
// reliable scheduler there. Geometry reads below synchronously flush layout.
const nextFrame = () => new Promise<void>(resolve => setTimeout(resolve, 50))
const frames = () => [...document.querySelectorAll<HTMLElement>('.snl-highlight-overlay:not([hidden])')].map(el => el.getBoundingClientRect())

function wordRect(host: HTMLElement, word: string) {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    const index = node.textContent?.indexOf(word) ?? -1
    if (index < 0) continue
    const range = document.createRange()
    range.setStart(node, index); range.setEnd(node, index + word.length)
    return range.getBoundingClientRect()
  }
  throw new Error(`Missing word ${word}`)
}

export async function verifyNativeLineFrames() {
  const host = document.createElement('div')
  host.style.cssText = 'width:270px;font-size:20px;line-height:1.2;margin:20px'
  document.body.append(host)
  const root = createRoot(host)
  const driver = new MacroDataDriver({ queries: { query_macro: async ({ macro_name }) => macros[macro_name] ?? null } })
  const results: unknown[] = []
  try {
    for (const source of ['Nested(Inner)', 'Repeated(Inner)', 'Break', 'Blank', 'Dyn(%first%,%second%,%third%)']) {
      const tree = parseSnlSyntaxTree(`Wrap(${source})`)
      const original = JSON.stringify(tree)
      root.render(<SnlSyntaxTreeView tree={tree} macro_data_driver={driver} />)
      const name = source.split('(')[0]
      let target: HTMLElement | null = null
      const deadline = performance.now() + 5000
      while (performance.now() < deadline) {
        target = host.querySelector<HTMLElement>(`.snl-text[data-name="${name}"]`)
        if (target?.textContent?.includes('SELECT')) break
        await nextFrame()
      }
      if (!target) throw new Error(`Missing native line fixture ${source}`)
      await document.fonts.ready
      for (const width of [270, 175, 450, 270]) {
        host.style.width = `${width}px`
        await nextFrame()
        applySnlHoverHighlight(target, host)
        host.dispatchEvent(new Event('scroll'))
        const paint = frames()
        for (let i = 0; i < paint.length; i++) for (let j = i + 1; j < paint.length; j++) {
          const a = paint[i], b = paint[j]
          if (Math.abs(a.top - b.top) < .5 && Math.abs(a.bottom - b.bottom) < .5 && Math.min(a.right, b.right) >= Math.max(a.left, b.left) - .5) {
            throw new Error(`Duplicate/adjacent native line frames: ${source} ${width}`)
          }
        }
        for (const outside of ['BEFORE', 'AFTER']) {
          const r = wordRect(host, outside)
          if (paint.some(p => Math.min(p.right, r.right) - Math.max(p.left, r.left) > 1 && Math.min(p.bottom, r.bottom) - Math.max(p.top, r.top) > 1)) throw new Error('Native line frame includes outside prose')
        }
        const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT)
        let text: Node | null
        while ((text = walker.nextNode())) {
          if (!text.textContent?.trim()) continue
          const range = document.createRange(); range.selectNodeContents(text)
          for (const r of range.getClientRects()) {
            if (r.width && !paint.some(p => p.left <= r.left + 1 && p.right >= r.right - 1 && p.top <= r.top + 1 && p.bottom >= r.bottom - 1)) throw new Error('Native line frame loses selected text')
          }
        }
        if (['Break', 'Blank', 'Dyn'].includes(name)) {
          const first = wordRect(target, 'first'), third = wordRect(target, 'third')
          const lineHeight = parseFloat(getComputedStyle(target).lineHeight)
          if (third.top - first.top < lineHeight * 1.9) throw new Error('Authored line breaks collapsed')
          if (name === 'Dyn') {
            const second = wordRect(target, 'second')
            if (second.top - first.top < lineHeight * 1.9 || third.top - second.top < lineHeight * 1.9 || target.querySelectorAll('br').length !== 4) throw new Error('Variadic separator blank lines collapsed')
          }
        }
        if (JSON.stringify(tree) !== original) throw new Error('Native line rendering mutated source')
        results.push({ source, width, frames: paint.map(r => r.toJSON()) })
      }
      clearSnlHoverHighlight(host)
      if (frames().length) throw new Error('Native line cleanup leaked frames')
    }
    return results
  } finally { clearSnlHoverHighlight(host); root.unmount(); host.remove() }
}
