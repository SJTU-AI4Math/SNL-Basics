import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const temporaryDirectories: string[] = []

function migrate(document: unknown, args: string[] = []): { output: string; migrated: unknown } {
  const directory = mkdtempSync(join(tmpdir(), 'snl-schema-migrate-'))
  temporaryDirectories.push(directory)
  const target = join(directory, 'document.json')
  writeFileSync(target, JSON.stringify(document), 'utf8')
  const result = spawnSync(
    process.execPath,
    [resolve('scripts/migrate-schema.mjs'), '--write', ...args, '--target', target],
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
    expect(output).toContain('macro v6→v8')
    expect((migrated as any).X.styles[0].style_name).toBe('default')
    expect((migrated as any).X.default_style).toEqual({ en: 'default' })
  })

  it('migrates v7 to v8 instead of treating it as current', () => {
    const { output, migrated } = migrate({
      X: {
        name: 'X', description: '', source: { entries: [], urls: [] },
        dynamic_arity: false, tags: [],
        styles: [{ style_name: 'plain', mode: 'text', template: 'X', tags: [] }],
      },
    })
    expect(output).toContain('macro v7→v8')
    expect((migrated as any).X.default_style).toEqual({ en: 'plain' })
  })

  it('splits localized v7 templates only with explicit opt-in', () => {
    const { migrated } = migrate({
      X: {
        name: 'X', description: '', source: { entries: [], urls: [] },
        dynamic_arity: false, tags: [],
        styles: [{
          style_name: 'prose', mode: 'text', tags: [],
          template: { type: 'i18n', default_language: 'en', values: { en: 'X', 'zh-CN': '叉' } },
        }],
      },
    }, ['--split-localized-templates'])
    expect((migrated as any).X.default_style).toEqual({ en: 'prose', 'zh-CN': 'prose_zh_CN' })
    expect((migrated as any).X.styles.map((style: any) => style.template)).toEqual(['X', '叉'])
  })

  it('rejects invalid records without overwriting the input', () => {
    const directory = mkdtempSync(join(tmpdir(), 'snl-schema-migrate-invalid-'))
    temporaryDirectories.push(directory)
    const target = join(directory, 'document.json')
    const original = JSON.stringify({ bad: 'value' })
    writeFileSync(target, original, 'utf8')
    const result = spawnSync(
      process.execPath,
      [resolve('scripts/migrate-schema.mjs'), '--write', '--target', target],
      { cwd: resolve('.'), encoding: 'utf8' },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/invalid or mixed Macro schema/)
    expect(readFileSync(target, 'utf8')).toBe(original)
  })

  it('adds required defaults when migrating a minimal v1 tree', () => {
    const { migrated } = migrate({ name: 'x', children: [] })
    expect(migrated).toEqual({ macro_name: 'x', kind: '', mdata: null, children: [] })
  })
})
