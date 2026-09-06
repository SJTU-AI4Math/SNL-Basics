// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('hides retained overlay geometry and restores it when visible again', () => {
  const style = document.createElement('style')
  style.textContent = readFileSync(resolve(process.cwd(), 'src/snl-react-view/style.css'), 'utf8')
  const overlay = document.createElement('span')
  overlay.className = 'snl-highlight-overlay'
  overlay.style.cssText = 'left:10px;top:10px;width:100px;height:50px'
  document.head.append(style)
  document.body.append(overlay)
  try {
    expect(getComputedStyle(overlay).display).toBe('block')
    overlay.hidden = true
    // JSDOM's UA hidden rule can win even when Chromium's authored display
    // keeps painting. Also resolve matching authored declarations from CSSOM.
    const displays = Array.from(style.sheet!.cssRules).flatMap((rule) => {
      if (!('selectorText' in rule) || !('style' in rule)) return []
      const authored = rule as CSSStyleRule
      const display = authored.style.getPropertyValue('display')
      return display && overlay.matches(authored.selectorText) ? [display] : []
    })
    expect(displays.at(-1)).toBe('none')
    expect(getComputedStyle(overlay).display).toBe('none')
    overlay.hidden = false
    expect(getComputedStyle(overlay).display).toBe('block')
  } finally {
    overlay.remove()
    style.remove()
  }
})
