import { expect, test } from 'vitest'
import { bundledMacroDb, bundledSampleMacroDb } from './bundled-db'

test('bundledMacroDb has expected macros', () => {
  expect(bundledMacroDb['Add.add']).toBeDefined()
  expect(bundledMacroDb['Add.add'].styles['infix'].template).toContain('#0')
  expect(bundledMacroDb['Add.add'].styles['infix'].template).not.toContain('@CHILD')
  expect(bundledMacroDb['Add.add'].styles['infix'].template).not.toContain('\\htmlData')
  expect(bundledMacroDb['Add.add'].mode).toBe('formula')
  expect(bundledMacroDb['pmatrix']).toBeDefined()
})
test('bundledMacroDb macros carry only render fields (no output backends)', () => {
  const macro = bundledMacroDb['Add.add'] as unknown as Record<string, unknown>
  expect(macro.typst).toBeUndefined()
  expect(macro.latex).toBeUndefined()
  expect(macro.markdown).toBeUndefined()
  expect(macro.text).toBeUndefined()
})
test('every macro has a defaultStyle that is a key in styles', () => {
  for (const macro of Object.values(bundledMacroDb)) {
    expect(macro.styles[macro.defaultStyle]).toBeDefined()
  }
})
test('no macro still uses the legacy mode value "math"', () => {
  for (const macro of Object.values(bundledMacroDb)) {
    expect(macro.mode).not.toBe('math')
  }
})
test('the katex_react nesting is gone (styles map replaces it)', () => {
  const macro = bundledMacroDb['Mul.mul'] as unknown as Record<string, unknown>
  expect(macro.katex_react).toBeUndefined()
  expect(bundledMacroDb['Mul.mul'].defaultStyle).toBe('implicit')
  expect(Object.keys(bundledMacroDb['Mul.mul'].styles).sort()).toEqual(['implicit', 'infix'])
})
test('bundledSampleMacroDb has block samples', () => {
  expect(bundledSampleMacroDb['sample.list']).toBeDefined()
  expect(bundledSampleMacroDb['sample.list'].mode).toBe('block')
  expect(bundledSampleMacroDb['sample.list'].styles['default'].react_renderer_key).toBe('list')
})
