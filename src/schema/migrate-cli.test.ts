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
    expect(output).toContain('macro v6/v7/v8/v9→v10')
    expect((migrated as any).X.styles[0].style_name).toBe('default')
    expect((migrated as any).X).not.toHaveProperty('default_style')
  })

  it('canonicalizes a compatible v9 shape to v10', () => {
    const { output, migrated } = migrate({
      X: {
        name: 'X', description: '', source: { entries: [], urls: [] },
        dynamic_arity: false, tags: [],
        styles: [{ style_name: 'plain', mode: 'text', template: 'X', tags: [] }],
      },
    })
    expect(output).toContain('macro v6/v7/v8/v9→v10')
    expect((migrated as any).X.kind).toBe('const')
    expect((migrated as any).X).not.toHaveProperty('default_style')
  })

  it('removes a redundant legacy language default map', () => {
    const { output, migrated } = migrate({
      X: {
        name: 'X', description: '', source: { entries: [], urls: [] },
        dynamic_arity: false, tags: [],
        default_style: { en: 'plain', 'zh-CN': 'plain' },
        styles: [{ style_name: 'plain', mode: 'text', template: 'X', tags: [] }],
      },
    })
    expect(output).toContain('macro v6/v7/v8/v9→v10')
    expect((migrated as any).X).not.toHaveProperty('default_style')
  })

  it('preserves Unicode Macro and style names during v7 to v9 migration', () => {
    const { migrated } = migrate({
      '群.是群🐈': {
        name: '群.是群🐈', description: '', source: { entries: [], urls: [] },
        dynamic_arity: false, tags: [],
        styles: [{ style_name: '默认样式', mode: 'text', template: '群', tags: [] }],
      },
    })
    expect((migrated as any)['群.是群🐈'].styles[0].style_name).toBe('默认样式')
    expect((migrated as any)['群.是群🐈']).not.toHaveProperty('default_style')
  })

  it('preserves localized v7 templates inside one style', () => {
    const { migrated } = migrate({
      X: {
        name: 'X', description: '', source: { entries: [], urls: [] },
        dynamic_arity: false, tags: [],
        styles: [{
          style_name: 'prose', mode: 'text', tags: [],
          template: { type: 'i18n', default_language: 'en', values: { en: 'X', 'zh-CN': '叉' } },
        }],
      },
    })
    expect((migrated as any).X).not.toHaveProperty('default_style')
    expect((migrated as any).X.styles).toHaveLength(1)
    expect((migrated as any).X.styles[0].template.values).toEqual({ en: 'X', 'zh-CN': '叉' })
  })

  it('upgrades a nonredundant published-v8 language map when styles match structurally', () => {
    const base = {
      name: 'X', description: '', source: { entries: [], urls: [] }, dynamic_arity: false, tags: [],
      default_style: { en: 'english', 'zh-CN': 'chinese' },
      styles: [
        { style_name: 'english', mode: 'text', template: 'English', tags: [] },
        { style_name: 'chinese', mode: 'text', template: '中文', tags: [] },
      ],
    }
    const { migrated } = migrate({ X: base })
    const macro = (migrated as any).X
    expect(macro.styles[0].template.values).toEqual({ en: 'English', 'zh-CN': '中文' })
    expect(macro.styles.slice(1).map((style: any) => style.style_name)).toEqual(['english', 'chinese'])
  })

  it('migrates mixed current-v9 and safely redundant legacy-v8 records atomically', () => {
    const current = {
      name: 'Current', description: '', source: { entries: [], urls: [] },
      dynamic_arity: false, tags: [],
      styles: [{ style_name: 'default', mode: 'text', template: 'current', tags: [] }],
    }
    const { output, migrated } = migrate({
      Current: current,
      Legacy: { ...current, name: 'Legacy', default_style: { en: 'default' } },
    })
    expect(output).toContain('macro v6/v7/v8/v9→v10')
    expect((migrated as any).Current).toEqual({ ...current, kind: 'const' })
    expect((migrated as any).Legacy).not.toHaveProperty('default_style')
  })

  it('preserves styles[0] fallback when a published-v8 map omits en', () => {
    const legacy = {
      name: 'X', description: '', source: { entries: [], urls: [] }, dynamic_arity: false, tags: [],
      default_style: { 'zh-CN': 'chinese' },
      styles: [
        { style_name: 'fallback', mode: 'text', template: 'English fallback', tags: [] },
        { style_name: 'chinese', mode: 'text', template: '中文', tags: [] },
      ],
    }
    const { migrated } = migrate({ X: legacy })
    expect((migrated as any).X.styles[0].template).toEqual({
      type: 'i18n', default_language: 'en',
      values: { en: 'English fallback', 'zh-CN': '中文' },
    })
  })

  it('uses mapped en as fallback even when the original first Style is structurally different', () => {
    const legacy = {
      name: 'X', description: '', source: { entries: [], urls: [] }, dynamic_arity: false, tags: [],
      default_style: { en: 'english', 'zh-CN': 'chinese' },
      styles: [
        { style_name: 'formula', mode: 'formula_inline', template: '#0', tags: [] },
        { style_name: 'english', mode: 'text', template: 'English', tags: [] },
        { style_name: 'chinese', mode: 'text', template: '中文', tags: [] },
      ],
    }
    const { migrated } = migrate({ X: legacy })
    expect((migrated as any).X.styles[0].template).toEqual({
      type: 'i18n', default_language: 'en', values: { en: 'English', 'zh-CN': '中文' },
    })
  })

  it('preserves a valid Macro whose identifier is __proto__', () => {
    const macro = {
      name: '__proto__', description: '', source: { entries: [], urls: [] },
      dynamic_arity: false, tags: [], default_style: { en: 'default' },
      styles: [{ style_name: 'default', mode: 'text', template: 'X', tags: [] }],
    }
    const document = JSON.parse(`{"__proto__":${JSON.stringify(macro)}}`)
    const { migrated } = migrate(document)
    expect(Object.hasOwn(migrated as object, '__proto__')).toBe(true)
    expect((migrated as any).__proto__.name).toBe('__proto__')
  })

  it('migrates a Macro database whose identifier is macro_name instead of treating it as a tree', () => {
    const legacy = {
      name: 'macro_name', description: '', source: { entries: [], urls: [] },
      dynamic_arity: false, tags: [], default_style: { en: 'default' },
      styles: [{ style_name: 'default', mode: 'text', template: 'X', tags: [] }],
    }
    const { output, migrated } = migrate({ macro_name: legacy })
    expect(output).toContain('macro v6/v7/v8/v9→v10')
    expect((migrated as any).macro_name).not.toHaveProperty('default_style')
  })

  it('does not misclassify Macro identifiers named name and children as a syntax tree', () => {
    const macro = (name: string) => ({
      name, description: '', source: { entries: [], urls: [] }, dynamic_arity: false, tags: [],
      styles: [{ style_name: 'default', mode: 'text', template: name, tags: [] }],
    })
    const { output, migrated } = migrate({ name: macro('name'), children: macro('children') })
    expect(output).toContain('macro v6/v7/v8/v9→v10')
    expect((migrated as any).name.kind).toBe('const')
    expect((migrated as any).children.kind).toBe('const')
    expect(Object.keys(migrated as object).sort()).toEqual(['children', 'name'])
  })

  it('rejects array migration targets with a nonzero exit', () => {
    const directory = mkdtempSync(join(tmpdir(), 'snl-schema-migrate-array-'))
    temporaryDirectories.push(directory)
    const target = join(directory, 'document.json')
    writeFileSync(target, JSON.stringify([]), 'utf8')
    const result = spawnSync(process.execPath, [resolve('scripts/migrate-schema.mjs'), '--write', '--target', target], {
      cwd: resolve('.'), encoding: 'utf8',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/plain JSON object/)
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
    expect(result.stderr).toMatch(/not valid v6, v7, safe v8, or v9 data/)
    expect(readFileSync(target, 'utf8')).toBe(original)
  })

  it('adds required defaults when migrating a minimal v1 tree', () => {
    const { migrated } = migrate({ name: 'x', children: [] })
    expect(migrated).toEqual({ macro_name: 'x', kind: '', mdata: null, children: [] })
  })

  it('migrates legacy Macro kinds to canonical v10 kinds', () => {
    const macro = (name: string, kind?: string) => ({
      name, description: '', source: { entries: [], urls: [] }, dynamic_arity: false, tags: [], kind,
      styles: [{ style_name: 'default', mode: 'text', template: name, tags: [] }],
    })
    const { output, migrated } = migrate({ Partial: macro('Partial', 'partial'), Rule: macro('Rule', 'rule') })
    expect(output).toContain('macro v6/v7/v8/v9→v10')
    expect((migrated as any).Partial.kind).toBe('sub')
    expect((migrated as any).Rule.kind).toBe('const')
  })

  it('migrates a whole v2 tree to coordinate-aware v3 temporary nodes', () => {
    const { output, migrated } = migrate({
      macro_name: 'root', kind: 'custom', mdata: null, children: [{
        macro_name: 'branch', kind: 'binder', mdata: null, children: [{
          macro_name: 'literal', env_mode: 'text', temporary_format: 'texttt',
          kind: '', mdata: null, extension_data: true, children: [],
        }],
      }],
    })
    expect(output).toContain('tree v2→v3')
    expect((migrated as any).children[0].children[0]).toEqual({
      macro_name: '#0.0', temporary_source: 'literal', env_mode: 'text', temporary_format: 'texttt',
      kind: '', mdata: null, extension_data: true, children: [],
    })
  })
})
