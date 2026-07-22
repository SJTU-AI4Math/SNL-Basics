import { expect, test } from 'vitest'
import { bundledMacroDb } from './bundled-db'

test('bundledMacroDb has expected macros', () => {
  expect(bundledMacroDb['FOL.implies']).toBeDefined()
  const infix = bundledMacroDb['FOL.implies'].styles.find((s) => s.tag === 'infix')
  expect(infix).toBeDefined()
  expect(infix!.template).toContain('#0')
  expect(infix!.template).not.toContain('@CHILD')
  expect(infix!.template).not.toContain('\\htmlData')
  expect(infix!.mode).toBe('formula_inline')
  expect(bundledMacroDb['pmatrix']).toBeDefined()
})
test('bundledMacroDb macros carry only render fields (no output backends)', () => {
  const macro = bundledMacroDb['FOL.implies'] as unknown as Record<string, unknown>
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
test('ordinary arithmetic operators are not bundled', () => {
  for (const name of ['Add.add', 'Sub.sub', 'Mul.mul', 'DivRing.div']) {
    expect(bundledMacroDb[name]).toBeUndefined()
  }
})
