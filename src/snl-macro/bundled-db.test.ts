import { expect, test } from 'vitest'
import { bundledMacroDb, bundledSampleMacroDb } from './bundled-db'

test('bundledMacroDb has expected macros', () => {
  expect(bundledMacroDb['Add.add.infix']).toBeDefined()
  expect(bundledMacroDb['Add.add.infix'].katex_react.template).toContain('@CHILD0@')
  expect(bundledMacroDb['pmatrix']).toBeDefined()
})
test('bundledSampleMacroDb has block samples', () => {
  expect(bundledSampleMacroDb['sample.list']).toBeDefined()
  expect(bundledSampleMacroDb['sample.list'].katex_react.mode).toBe('block')
})
