import { expect, test } from 'vitest'
import { bundledMacroDb, bundledSampleMacroDb } from './bundled-db'

test('bundledMacroDb has expected macros', () => {
  expect(bundledMacroDb['Add.add']).toBeDefined()
  const infix = bundledMacroDb['Add.add'].styles.find((s) => s.tag === 'infix')
  expect(infix).toBeDefined()
  expect(infix!.template).toContain('#0')
  expect(infix!.template).not.toContain('@CHILD')
  expect(infix!.template).not.toContain('\\htmlData')
  expect(infix!.mode).toBe('formula_inline')
  expect(bundledMacroDb['pmatrix']).toBeDefined()
})
test('bundledMacroDb macros carry only render fields (no output backends)', () => {
  const macro = bundledMacroDb['Add.add'] as unknown as Record<string, unknown>
  expect(macro.typst).toBeUndefined()
  expect(macro.latex).toBeUndefined()
  expect(macro.markdown).toBeUndefined()
  expect(macro.text).toBeUndefined()
})
test('every macro has at least one style with a mode', () => {
  for (const macro of Object.values(bundledMacroDb)) {
    expect(Array.isArray(macro.styles)).toBe(true)
    expect(macro.styles.length).toBeGreaterThan(0)
    for (const s of macro.styles) {
      expect(typeof s.tag).toBe('string')
      expect(['formula_inline', 'formula_display', 'text', 'block']).toContain(s.mode)
    }
  }
})
test('no macro carries the legacy top-level mode/display/defaultStyle', () => {
  for (const macro of Object.values(bundledMacroDb)) {
    const raw = macro as unknown as Record<string, unknown>
    expect(raw.mode).toBeUndefined()
    expect(raw.display).toBeUndefined()
    expect(raw.defaultStyle).toBeUndefined()
    expect(raw.katex_react).toBeUndefined()
  }
})
test('Mul.mul default (styles[0]) is implicit; infix follows', () => {
  const styles = bundledMacroDb['Mul.mul'].styles
  expect(styles.map((s) => s.tag)).toEqual(['implicit', 'infix'])
})
test('bundledSampleMacroDb has block samples with per-style mode', () => {
  expect(bundledSampleMacroDb['sample.list']).toBeDefined()
  const def = bundledSampleMacroDb['sample.list'].styles[0]
  expect(def.mode).toBe('block')
  expect(def.react_renderer_key).toBe('list')
})
