import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrateMacroDocument } from './migrate-macro'

const script = join(process.cwd(), 'scripts', 'migrate-schema.mjs')

function v10Macro(name: string) {
  return {
    name,
    description: '',
    source: { entries: [], urls: [] },
    kind: 'const',
    dynamic_arity: false,
    tags: [],
    styles: [{ style_name: 'default', mode: 'text', template: '#0', tags: [] }],
  }
}

describe('standalone schema migration CLI', () => {
  it('matches the library for mixed v6-v11 records and then reports a fixed point', () => {
    const root = mkdtempSync(join(tmpdir(), 'snl-migrate-cli-'))
    const target = join(root, 'macros.json')
    const v10 = v10Macro('Legacy')
    const v11 = migrateMacroDocument({ Current: v10 }).Current
    const v8 = {
      ...v10Macro('LocalizedDefault'),
      default_style: { en: 'inline', 'zh-CN': '中文' },
      styles: [
        { style_name: 'inline', mode: 'formula_inline', template: '#0', separator: ', ', tags: [] },
        { style_name: '中文', mode: 'text', template: '#0', separator: '、', tags: [] },
      ],
    }
    const v6 = {
      ...v10Macro('Old'), kind: undefined, tags: undefined,
      macro_backend: { keep: true },
      styles: [{ tag: 'default', mode: 'text', template: '#0', tags: [], consumer_backend: { keep: 42 } }],
    }
    const input = { Current: v11, Legacy: v10, LocalizedDefault: v8, Old: v6 }
    const expected = migrateMacroDocument(input as any)
    writeFileSync(target, `${JSON.stringify(input, null, 2)}\n`)

    execFileSync(process.execPath, [script, '--write', '--target', target], { encoding: 'utf8' })
    const migrated = JSON.parse(readFileSync(target, 'utf8'))
    expect(migrated).toEqual(expected)

    const second = spawnSync(process.execPath, [script, '--target', target], { encoding: 'utf8' })
    expect(second.status).toBe(0)
    expect(second.stdout).toContain('already macro v11')
  })

  it('fails closed when an opaque legacy field collides with a v11 TemplateSpec field', () => {
    const root = mkdtempSync(join(tmpdir(), 'snl-migrate-cli-collision-'))
    const target = join(root, 'macros.json')
    const macro = v10Macro('Collision') as any
    macro.styles[0].body = { opaque: true }
    const original = `${JSON.stringify({ Collision: macro }, null, 2)}\n`
    writeFileSync(target, original)

    const result = spawnSync(process.execPath, [script, '--write', '--target', target], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/extension.*body.*collides/i)
    expect(readFileSync(target, 'utf8')).toBe(original)
  })

  it('rejects a localized v11 envelope carrying ignored projection fields', () => {
    const root = mkdtempSync(join(tmpdir(), 'snl-migrate-cli-hybrid-envelope-'))
    const target = join(root, 'macros.json')
    const macro = migrateMacroDocument({ Hybrid: v10Macro('Hybrid') }).Hybrid as any
    const projection = macro.styles[0].template
    macro.styles[0].template = {
      type: 'i18n', default_language: 'en', values: { en: projection },
      mode: 'block', body: 'IGNORED', separator: 'DROP', block_template_name: 'ignored',
    }
    const original = `${JSON.stringify({ Hybrid: macro }, null, 2)}\n`
    writeFileSync(target, original)

    const result = spawnSync(process.execPath, [script, '--write', '--target', target], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stdout).not.toContain('already macro v11')
    expect(readFileSync(target, 'utf8')).toBe(original)
  })

  it('matches the library by rejecting a v6 opaque separator collision', () => {
    const root = mkdtempSync(join(tmpdir(), 'snl-migrate-cli-v6-collision-'))
    const target = join(root, 'macros.json')
    const macro = {
      ...v10Macro('Collision'), kind: undefined, tags: undefined,
      styles: [{
        tag: 'default', mode: 'text', template: '#0', tags: [],
        separator: { opaque: 'must-survive-or-reject' },
      }],
    }
    const original = `${JSON.stringify({ Collision: macro }, null, 2)}\n`
    writeFileSync(target, original)

    const result = spawnSync(process.execPath, [script, '--write', '--target', target], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/v6 extension.*separator.*collides/i)
    expect(readFileSync(target, 'utf8')).toBe(original)
  })
})