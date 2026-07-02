import { expect, test } from 'vitest'
import { bundledMacroDb, bundledSampleMacroDb } from './bundled-db'

test('bundledMacroDb has expected macros', () => {
  expect(bundledMacroDb['Add.add.infix']).toBeDefined()
  expect(bundledMacroDb['Add.add.infix'].katex_react.template).toContain('#0')
  expect(bundledMacroDb['Add.add.infix'].katex_react.template).not.toContain('@CHILD')
  expect(bundledMacroDb['Add.add.infix'].katex_react.template).not.toContain('\\htmlData')
  expect(bundledMacroDb['Add.add.infix'].katex_react.mode).toBe('formula')
  expect(bundledMacroDb['pmatrix']).toBeDefined()
})
test('bundledMacroDb macros carry only render fields (no output backends)', () => {
  const macro = bundledMacroDb['Add.add.infix'] as unknown as Record<string, unknown>
  expect(macro.typst).toBeUndefined()
  expect(macro.latex).toBeUndefined()
  expect(macro.markdown).toBeUndefined()
  expect(macro.text).toBeUndefined()
})
test('no macro still uses the legacy mode value "math"', () => {
  for (const macro of Object.values(bundledMacroDb)) {
    expect(macro.katex_react.mode).not.toBe('math')
  }
})
test('bundledSampleMacroDb has block samples', () => {
  expect(bundledSampleMacroDb['sample.list']).toBeDefined()
  expect(bundledSampleMacroDb['sample.list'].katex_react.mode).toBe('block')
})
