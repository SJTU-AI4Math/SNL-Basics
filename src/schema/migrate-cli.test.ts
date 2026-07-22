import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const temporaryDirectories: string[] = []

function migrate(document: unknown): { output: string; migrated: unknown } {
  const directory = mkdtempSync(join(tmpdir(), 'snl-schema-migrate-'))
  temporaryDirectories.push(directory)
  const target = join(directory, 'document.json')
  writeFileSync(target, JSON.stringify(document), 'utf8')
  const result = spawnSync(
    process.execPath,
    [resolve('scripts/migrate-schema.mjs'), '--write', '--target', target],
    { cwd: resolve('.'), encoding: 'utf8' },
  )
  expect(result.status, result.stderr).toBe(0)
  return { output: result.stdout, migrated: JSON.parse(readFileSync(target, 'utf8')) }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('migrate-schema CLI', () => {
  it('does not skip a partial v7 macro style missing style_name', () => {
    const { output, migrated } = migrate({
      X: {
        name: 'X',
        description: '',
        source: { entries: [], urls: [] },
        dynamic_arity: false,
        tags: [],
        styles: [{ mode: 'formula_inline', template: 'X', tags: [] }],
      },
    })
    expect(output).toContain('macro v6→v7')
    expect((migrated as any).X.styles[0].style_name).toBe('default')
  })

  it('adds required defaults when migrating a minimal v1 tree', () => {
    const { migrated } = migrate({ name: 'x', children: [] })
    expect(migrated).toEqual({ macro_name: 'x', kind: '', mdata: null, children: [] })
  })
})
