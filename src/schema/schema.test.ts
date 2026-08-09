import { describe, expect, it } from 'vitest'
import {
  migrateMacroDocument,
  migrateStyleV6toV7,
  migrateMacroV6toV7,
  migrateMacroV7toV8,
  migrateMacroV7toV9,
  migrateMacroV9toV10,
  isMacroDocumentV7,
  isMacroDocumentV8,
  isMacroDocumentV9,
  isMacroDocumentV10,
  migrateSyntaxTreeDocument,
  migrateTreeNodeV1toV2,
  migrateTreeNodeV2toV3,
  isSyntaxTreeDocumentV2,
  isSyntaxTreeDocumentV3,
  MACRO_SCHEMA_VERSION,
  TREE_SCHEMA_VERSION,
  PACKAGE_VERSION,
} from './index'
import type { MacroV6, MacroStyleV6, SyntaxTreeNodeV1, SyntaxTreeNodeV2 } from './index'
import type { I18n } from '../runtime'
import { resolveSnlSemantics } from '../snl-syntax-tree/semantic-resolver'

describe('schema/versions', () => {
  it('exports correct version constants', () => {
    expect(MACRO_SCHEMA_VERSION).toBe(10)
    expect(TREE_SCHEMA_VERSION).toBe(3)
    expect(PACKAGE_VERSION).toBe('0.2.0')
  })
})

describe('schema/migrate-macro', () => {
  const v6Style: MacroStyleV6 = {
    tag: 'default',
    mode: 'formula_inline',
    template: '#0 + #1',
    variadic_left: '\\{',
    variadic_join: ', ',
    variadic_right: '\\}',
  }

  const v6Macro: MacroV6 = {
    name: 'Add',
    description: 'Addition',
    source: { entries: [], urls: [] },
    dynamic_arity: true,
    styles: [v6Style],
  }

  it('migrateStyleV6toV7 renames tag→style_name', () => {
    const v7 = migrateStyleV6toV7(v6Style)
    expect(v7.style_name).toBe('default')
    expect(v7).not.toHaveProperty('tag')
  })

  it('migrateStyleV6toV7 converts variadic triple to separator + template', () => {
    const v7 = migrateStyleV6toV7(v6Style)
    expect(v7.separator).toBe(', ')
    expect(v7.template).toBe('\\{#*\\}')
    expect(v7).not.toHaveProperty('variadic_left')
    expect(v7).not.toHaveProperty('variadic_join')
    expect(v7).not.toHaveProperty('variadic_right')
  })

  it('migrateStyleV6toV7 renames react_renderer_key→block_template_name', () => {
    const s: MacroStyleV6 = {
      tag: 'block',
      mode: 'block',
      template: '',
      react_renderer_key: 'enumerate',
    }
    const v7 = migrateStyleV6toV7(s)
    expect(v7.block_template_name).toBe('enumerate')
    expect(v7).not.toHaveProperty('react_renderer_key')
  })

  it('migrateStyleV6toV7 adds tags: [] when missing', () => {
    const v7 = migrateStyleV6toV7(v6Style)
    expect(v7.tags).toEqual([])
  })

  it('migrateMacroV6toV7 keeps name as name (not macro_name)', () => {
    const v7 = migrateMacroV6toV7(v6Macro)
    expect(v7.name).toBe('Add')
    expect(v7).not.toHaveProperty('macro_name')
  })

  it('migrateMacroV6toV7 adds tags: [] when missing', () => {
    const v7 = migrateMacroV6toV7(v6Macro)
    expect(v7.tags).toEqual([])
  })

  it('migrateMacroV6toV7 preserves kind', () => {
    const v7 = migrateMacroV6toV7({ ...v6Macro, kind: 'rule' })
    expect(v7.kind).toBe('rule')
  })

  it('migrateMacroDocument migrates all entries', () => {
    const db = { Add: v6Macro }
    const result = migrateMacroDocument(db)
    expect(result.Add.name).toBe('Add')
    expect(result.Add.styles[0].style_name).toBe('default')
    expect(result.Add.styles[0].separator).toBe(', ')
    expect(result.Add).not.toHaveProperty('default_style')
  })

  it('isMacroDocumentV7 detects v6 documents', () => {
    const v6Db = { Add: { ...v6Macro, styles: [v6Style] } }
    expect(isMacroDocumentV7(v6Db as any)).toBe(false)
  })

  it('isMacroDocumentV7 detects v7 documents', () => {
    const v7 = { Add: migrateMacroV6toV7(v6Macro) }
    expect(isMacroDocumentV7(v7 as any)).toBe(true)
  })

  it('preserves __proto__ as an own locale key in retained v7→v8 migration', () => {
    const template = JSON.parse('{"type":"i18n","default_language":"en","values":{"en":"English #0","__proto__":"Proto #0"}}')
    const base = migrateMacroV6toV7(v6Macro)
    const source = {
      ...base,
      styles: [{
        style_name: base.styles[0].style_name,
        mode: 'text' as const,
        template,
        ...(base.styles[0].separator !== undefined ? { separator: base.styles[0].separator } : {}),
        tags: base.styles[0].tags
      }]
    }
    const v8 = migrateMacroV7toV8(source, { split_localized_templates: true })
    expect(Object.prototype.hasOwnProperty.call(v8.default_style, '__proto__')).toBe(true)
    expect(v8.default_style.__proto__).toBe(`${v8.styles[0].style_name}___proto__`)
  })

  it('isMacroDocumentV7 rejects a later legacy style', () => {
    const v7 = migrateMacroV6toV7(v6Macro)
    const partial = {
      Add: {
        ...v7,
        styles: [v7.styles[0], v6Style],
      },
    }
    expect(isMacroDocumentV7(partial as any)).toBe(false)
  })

  it('preserves a localized v7 text template inside one v9 style', () => {
    const i18n: I18n<string, string> = {
      type: 'i18n',
      default_language: 'en',
      values: { en: '#0 is a group', 'zh-CN': '#0 是群' },
    }
    const text = migrateMacroV6toV7(v6Macro)
    text.styles = [{ style_name: 'prose', mode: 'text', template: i18n, tags: [] }]
    expect(isMacroDocumentV7({ Add: text } as any)).toBe(true)
    const migrated = migrateMacroV7toV9(text)
    expect(migrated).not.toHaveProperty('default_style')
    expect(migrated.styles).toEqual([
      expect.objectContaining({ style_name: 'prose', template: i18n }),
    ])
    expect(isMacroDocumentV9({ Add: migrated } as any)).toBe(true)
  })

  it('retains the published v7→v8 split migration and upgrades its output to v9', () => {
    const i18n: I18n<string, string> = {
      type: 'i18n', default_language: 'en', values: { en: 'English #0', 'zh-CN': '中文 #0' },
    }
    const source = {
      ...migrateMacroV6toV7(v6Macro),
      styles: [{ style_name: 'prose', mode: 'text' as const, template: i18n, tags: [] }],
    }
    const v8 = migrateMacroV7toV8(source, { split_localized_templates: true })
    expect(isMacroDocumentV8({ X: v8 } as any)).toBe(true)
    expect(v8.default_style).toEqual({ en: 'prose', 'zh-CN': 'prose_zh_CN' })
    const v9 = migrateMacroDocument({ X: v8 } as any).X
    expect(v9.styles[0].template).toEqual(i18n)
    expect(v9.styles.slice(1).map((style) => style.style_name)).toEqual(['prose', 'prose_zh_CN'])
  })

  it('rejects I18n templates outside text mode', () => {
    const i18n: I18n<string, string> = {
      type: 'i18n',
      default_language: 'en',
      values: { en: '#0', 'zh-CN': '#0' },
    }
    const text = migrateMacroV6toV7(v6Macro)
    const invalid = {
      ...migrateMacroV7toV9(text),
      styles: [{ style_name: 'formula', mode: 'formula_inline', template: i18n, tags: [] }],
    }
    expect(isMacroDocumentV9({ Add: invalid } as any)).toBe(false)
  })

  it('rejects a localized template whose declared default is inherited', () => {
    const current = migrateMacroV7toV9(migrateMacroV6toV7(v6Macro))
    const values = Object.assign(Object.create({ fr: 'Inherited' }), { en: 'English' })
    const invalid = {
      ...current,
      styles: [{ style_name: 'prose', mode: 'text', template: {
        type: 'i18n', default_language: 'fr', values
      }, tags: [] }]
    }
    expect(isMacroDocumentV9({ Add: invalid } as any)).toBe(false)
  })

  it('rejects ambiguous or unparseable v9 style schemas', () => {
    const text = migrateMacroV7toV9({
      ...migrateMacroV6toV7(v6Macro),
      styles: [{ style_name: 'prose', mode: 'text', template: '#0', tags: [] }],
    })
    expect(isMacroDocumentV9({ Add: {
      ...text,
      styles: [...text.styles, { ...text.styles[0] }],
    } } as any)).toBe(false)
    expect(isMacroDocumentV9({ Add: {
      ...text,
      styles: [{ ...text.styles[0], style_name: 'bad style' }],
    } } as any)).toBe(false)
    expect(isMacroDocumentV9({ Add: {
      ...text,
      styles: [{ ...text.styles[0], block_template_name: 'list' }],
    } } as any)).toBe(false)
  })

  it('strips a redundant legacy default_style map without changing style order', () => {
    const current = migrateMacroV7toV9({
      ...migrateMacroV6toV7(v6Macro),
      styles: [{ style_name: 'default', mode: 'text', template: 'X', tags: [] }],
    })
    const legacy = { ...current, default_style: { en: 'default', 'zh-CN': 'default' } }
    expect(isMacroDocumentV8({ X: legacy } as any)).toBe(true)
    const normalized = migrateMacroDocument({ X: legacy } as any)
    expect(normalized.X).not.toHaveProperty('default_style')
    expect(normalized.X.styles).toEqual(current.styles)
  })

  it('normalizes a mixed current-v9 and safely redundant legacy-v8 database', () => {
    const current = migrateMacroV7toV9({
      ...migrateMacroV6toV7(v6Macro),
      styles: [{ style_name: 'default', mode: 'text', template: 'X', tags: [] }],
    })
    const legacy = { ...current, name: 'Legacy', default_style: { en: 'default' } }
    const normalized = migrateMacroDocument({ Current: current, Legacy: legacy } as any)
    expect(normalized.Current).toEqual({ ...current, kind: 'const' })
    expect(normalized.Legacy).not.toHaveProperty('default_style')
  })

  it('upgrades a published v8 language map without dropping explicit v8 styles', () => {
    const current = migrateMacroV7toV9({
      ...migrateMacroV6toV7(v6Macro),
      styles: [
        { style_name: 'first', mode: 'text', template: 'English', tags: [] },
        { style_name: 'other', mode: 'text', template: '中文', tags: [] },
      ],
    })
    const legacy = {
      ...current,
      default_style: { en: 'first', 'zh-CN': 'other' },
    }
    expect(isMacroDocumentV8({ X: legacy } as any)).toBe(true)
    const normalized = migrateMacroDocument({ X: legacy } as any).X
    expect(normalized.styles[0].template).toEqual({
      type: 'i18n', default_language: 'en', values: { en: 'English', 'zh-CN': '中文' },
    })
    expect(normalized.styles.slice(1).map((style) => style.style_name)).toEqual(['first', 'other'])
    expect(migrateMacroV9toV10(migrateMacroV7toV9(legacy as any))).toEqual(normalized)
  })

  it('preserves styles[0] as the fallback when a v8 language map omits en', () => {
    const legacy = {
      ...migrateMacroV7toV9({
        ...migrateMacroV6toV7(v6Macro),
        styles: [
          { style_name: 'fallback', mode: 'text', template: 'English fallback', tags: [] },
          { style_name: 'chinese', mode: 'text', template: '中文', tags: [] },
        ],
      }),
      default_style: { 'zh-CN': 'chinese' },
    }
    const normalized = migrateMacroDocument({ X: legacy } as any).X
    expect(normalized.styles[0].template).toEqual({
      type: 'i18n', default_language: 'en',
      values: { en: 'English fallback', 'zh-CN': '中文' },
    })
    expect(normalized.styles.slice(1).map((style) => style.style_name)).toEqual(['fallback', 'chinese'])
  })

  it('uses the mapped en Style as v8 fallback even when styles[0] is structurally different', () => {
    const legacy = {
      ...migrateMacroV7toV9({
        ...migrateMacroV6toV7(v6Macro),
        styles: [
          { style_name: 'formula', mode: 'formula_inline', template: '#0', tags: [] },
          { style_name: 'english', mode: 'text', template: 'English', tags: [] },
          { style_name: 'chinese', mode: 'text', template: '中文', tags: [] },
        ],
      }),
      default_style: { en: 'english', 'zh-CN': 'chinese' },
    }
    const normalized = migrateMacroDocument({ X: legacy } as any).X
    expect(normalized.styles[0].template).toEqual({
      type: 'i18n', default_language: 'en', values: { en: 'English', 'zh-CN': '中文' },
    })
    expect(normalized.styles.slice(1).map((style) => style.style_name))
      .toEqual(['formula', 'english', 'chinese'])
  })

  it('rejects a nonredundant v8 map whose styles are structurally incompatible', () => {
    const legacy = {
      ...migrateMacroV7toV9({
        ...migrateMacroV6toV7(v6Macro),
        styles: [
          { style_name: 'first', mode: 'text', template: 'English', tags: [] },
          { style_name: 'other', mode: 'formula_inline', template: 'X', tags: [] },
        ],
      }),
      default_style: { en: 'first', 'zh-CN': 'other' },
    }
    expect(isMacroDocumentV8({ X: legacy } as any)).toBe(true)
    expect(() => migrateMacroDocument({ X: legacy } as any)).toThrow(/cannot be merged safely/)
  })

  it('accepts Unicode Macro and style names under the Parser identifier policy', () => {
    const unicode = migrateMacroV7toV9({
      ...migrateMacroV6toV7(v6Macro),
      name: '群.是群🐈',
      styles: [{ style_name: '默认样式', mode: 'text', template: '群', tags: [] }],
    })
    expect(isMacroDocumentV9({ [unicode.name]: unicode } as any)).toBe(true)
    expect(isMacroDocumentV9({ 'bad!name': { ...unicode, name: 'bad!name' } } as any)).toBe(false)
    expect(isMacroDocumentV9({ X: {
      ...unicode, name: 'X',
      styles: [{ ...unicode.styles[0], style_name: 'bad/name' }],
    } } as any)).toBe(false)
  })

  it('preserves custom Macro kinds while normalizing only structural partial and missing kinds', () => {
    const current = migrateMacroV7toV9(migrateMacroV6toV7(v6Macro))
    expect(migrateMacroV9toV10({ ...current, kind: 'partial' }).kind).toBe('sub')
    expect(migrateMacroV9toV10({ ...current, kind: 'rule' }).kind).toBe('rule')
    expect(migrateMacroV9toV10({ ...current, kind: 'custom-skin' }).kind).toBe('custom-skin')
    expect(migrateMacroV9toV10({ ...current, kind: undefined }).kind).toBe('const')
    expect(migrateMacroV9toV10({ ...current, kind: '' }).kind).toBe('const')
  })

  it('accepts materialized custom v10 kinds while rejecting the legacy partial spelling', () => {
    const legacy = migrateMacroV7toV9(migrateMacroV6toV7(v6Macro))
    for (const kind of ['const', 'sub', 'rule', 'custom-skin']) {
      expect(isMacroDocumentV10({ X: { ...legacy, kind } } as any)).toBe(true)
    }
    expect(isMacroDocumentV10({ X: { ...legacy, kind: 'partial' } } as any)).toBe(false)
    expect(isMacroDocumentV10({ X: { ...legacy, kind: undefined } } as any)).toBe(false)
  })

  it('migrateMacroDocument emits canonical v10 data and preserves unknown fields', () => {
    const legacy = {
      ...migrateMacroV7toV9(migrateMacroV6toV7(v6Macro)),
      kind: 'partial',
      extension_data: { owner: 'consumer' },
    }
    const migrated = migrateMacroDocument({ X: legacy } as any).X as any
    expect(migrated.kind).toBe('sub')
    expect(migrated.extension_data).toEqual({ owner: 'consumer' })
    expect(isMacroDocumentV10({ X: migrated })).toBe(true)
  })

  it('preserves a valid Macro whose identifier is __proto__', () => {
    const current = migrateMacroV7toV9(migrateMacroV6toV7(v6Macro))
    const macro = {
      ...current,
      default_style: { en: current.styles[0].style_name }
    }
    const document = JSON.parse(`{"__proto__":${JSON.stringify(macro)}}`)
    const migrated = migrateMacroDocument(document)
    expect(Object.hasOwn(migrated, '__proto__')).toBe(true)
    expect(migrated.__proto__.name).toBe(macro.name)
  })

  it('rejects arrays and non-plain top-level migration targets', () => {
    expect(isMacroDocumentV9([] as any)).toBe(false)
    expect(isMacroDocumentV9(new Date() as any)).toBe(false)
    expect(() => migrateMacroDocument([] as any)).toThrow(/plain object/)
  })

  it('validates complete records and never drops malformed entries', () => {
    expect(isMacroDocumentV7({ X: null } as any)).toBe(false)
    expect(() => migrateMacroDocument({ bad: 'value' } as any)).toThrow(/not valid v6, v7, v8, v9, or v10/)

    const valid = migrateMacroV7toV9({
      ...migrateMacroV6toV7(v6Macro),
      styles: [{ style_name: 'plain', mode: 'text', template: 'X', tags: [] }],
    })
    for (const patch of [
      { name: 7 },
      { description: null },
      { source: null },
      { dynamic_arity: 'no' },
      { tags: ['ok', 2] },
    ]) {
      expect(isMacroDocumentV9({ X: { ...valid, ...patch } } as any)).toBe(false)
    }
  })

  it('rejects malformed I18n-like templates before producing v9 output', () => {
    const malformed = {
      ...migrateMacroV6toV7(v6Macro),
      styles: [{
        style_name: 'prose', mode: 'text', tags: [],
        template: { type: 'i18n', default_language: 'fr', values: { en: 'X' } },
      }],
    }
    expect(() => migrateMacroV7toV9(malformed as any, {
      split_localized_templates: true,
    })).toThrow(/malformed localized template/)
  })

  it('join-only v6 dynamic styles gain a real #* template', () => {
    const style: MacroStyleV6 = {
      tag: 'math',
      mode: 'formula_inline',
      template: 'legacy template without a dynamic slot',
      variadic_join: ' \\vee ',
    }
    const v7 = migrateStyleV6toV7(style)
    expect(v7.separator).toBe(' \\vee ')
    expect(v7.template).toBe('#*')
  })

  it('preserves an explicitly empty separator', () => {
    const v7 = migrateStyleV6toV7({
      tag: 'tight',
      mode: 'formula_inline',
      template: '',
      variadic_join: '',
    })
    expect(v7.separator).toBe('')
    expect(v7.template).toBe('#*')
  })

  it('rejects block_template_name on a non-block style', () => {
    const style: MacroStyleV6 = {
      tag: 'plain',
      mode: 'text',
      template: '#0',
      react_renderer_key: 'callout',
    }
    expect(() => migrateStyleV6toV7(style)).toThrow(/block mode/)
  })

  it('handles style with no variadic fields gracefully', () => {
    const style: MacroStyleV6 = {
      tag: 'plain',
      mode: 'formula_inline',
      template: '\\frac{#0}{#1}',
    }
    const v7 = migrateStyleV6toV7(style)
    expect(v7.separator).toBeUndefined()
    expect(v7.template).toBe('\\frac{#0}{#1}')
  })
})

describe('schema/migrate-tree', () => {
  const v1Node: SyntaxTreeNodeV1 = {
    name: 'Add',
    style: 'bold',
    envMode: 'formula_display',
    kind: 'operator',
    mdata: { x: 1 },
    children: [
      { name: 'a', children: [] },
      { name: 'b', style: 'italic', children: [] },
    ],
  }

  it('migrateTreeNodeV1toV2 renames name→macro_name', () => {
    const v2 = migrateTreeNodeV1toV2(v1Node)
    expect(v2.macro_name).toBe('Add')
    expect(v2).not.toHaveProperty('name')
  })

  it('migrateTreeNodeV1toV2 renames style→style_name', () => {
    const v2 = migrateTreeNodeV1toV2(v1Node)
    expect(v2.style_name).toBe('bold')
    expect(v2).not.toHaveProperty('style')
  })

  it('migrateTreeNodeV1toV2 renames envMode→env_mode', () => {
    const v2 = migrateTreeNodeV1toV2(v1Node)
    expect(v2.env_mode).toBe('formula_display')
    expect(v2).not.toHaveProperty('envMode')
  })

  it('migrates children recursively', () => {
    const v2 = migrateTreeNodeV1toV2(v1Node)
    expect(v2.children[0].macro_name).toBe('a')
    expect(v2.children[1].macro_name).toBe('b')
    expect(v2.children[1].style_name).toBe('italic')
  })

  it('migrateSyntaxTreeDocument handles full v1→v3 chain', () => {
    const v3 = migrateSyntaxTreeDocument(v1Node)
    expect(v3.macro_name).toBe('#')
    expect(v3.temporary_source).toBe('Add')
    expect(v3.children.length).toBe(2)
  })

  it('isSyntaxTreeDocumentV2 detects v1', () => {
    expect(isSyntaxTreeDocumentV2(v1Node as any)).toBe(false)
  })

  it('isSyntaxTreeDocumentV2 detects v2', () => {
    const v2 = migrateSyntaxTreeDocument(v1Node)
    expect(isSyntaxTreeDocumentV2(v2 as any)).toBe(true)
  })

  it('preserves mdata, kind, scope, and extension fields', () => {
    const withMetadata: SyntaxTreeNodeV1 = {
      ...v1Node,
      scope: 'binder',
      extension_data: { source: 'lean' },
    }
    const v2 = migrateTreeNodeV1toV2(withMetadata)
    expect(v2.kind).toBe('operator')
    expect(v2.mdata).toEqual({ x: 1 })
    expect(v2.scope).toBe('binder')
    expect((v2 as unknown as Record<string, unknown>).extension_data).toEqual({ source: 'lean' })
  })

  it('rejects a partially migrated tree document', () => {
    const partial = {
      macro_name: 'root',
      children: [{ name: 'legacy-child', children: [] }],
    }
    expect(isSyntaxTreeDocumentV2(partial)).toBe(false)
  })

  it('handles node without optional fields', () => {
    const minimal: SyntaxTreeNodeV1 = { name: 'x', children: [] }
    const v2 = migrateTreeNodeV1toV2(minimal)
    expect(v2.macro_name).toBe('x')
    expect(v2.style_name).toBeUndefined()
    expect(v2.env_mode).toBeUndefined()
    expect(v2.children).toEqual([])
  })

  it('migrates temporary nodes with deterministic whole-tree coordinates', () => {
    const v2: SyntaxTreeNodeV2 = {
      macro_name: 'outer', kind: 'custom-skin', mdata: null,
      children: [
        { macro_name: 'same', env_mode: 'text', kind: '', mdata: null, children: [] },
        { macro_name: 'branch', kind: 'binder', mdata: null, children: [
          { macro_name: 'same', env_mode: 'formula_inline', kind: '', mdata: null, children: [] },
        ] },
      ],
    }
    const v3 = migrateTreeNodeV2toV3(v2)
    expect(v3.macro_name).toBe('outer')
    expect(v3.kind).toBe('custom-skin')
    expect(v3.children[0]).toEqual(expect.objectContaining({
      macro_name: '#0', temporary_source: 'same', env_mode: 'text',
    }))
    expect(v3.children[1].children[0]).toEqual(expect.objectContaining({
      macro_name: '#1.0', temporary_source: 'same', env_mode: 'formula_inline',
    }))
  })

  it('preserves legacy binder identity when migrating v2 to v3', () => {
    const migrated = migrateTreeNodeV2toV3({
      macro_name: 'root', kind: '', mdata: null, children: [
        { macro_name: 'x', kind: 'binder', mdata: null, children: [] },
        { macro_name: 'x', kind: '', mdata: null, children: [] },
      ],
    })
    expect(migrated.children[0].binder_name).toBe('x')
    expect(resolveSnlSemantics(migrated, {}).tree.children[1].kind).toBe('bvar')
  })

  it('converts legacy derived binding metadata into structured Tree3 source syntax', () => {
    const migrated = migrateTreeNodeV2toV3({
      macro_name: 'x', kind: 'bvar', mdata: { src: 'ctx', bindRef: 'b1', keep: 1 }, children: [],
    })
    expect(migrated.postfix).toEqual({ type: 'name', name: 'ctx' })
    expect(migrated.mdata).toEqual({ keep: 1 })
    expect(isSyntaxTreeDocumentV3({
      macro_name: 'x', kind: 'bvar', mdata: { src: 'ctx' }, children: [],
    })).toBe(false)
  })

  it('assigns # to a temporary root and preserves temporary texttt plus unknown fields', () => {
    const v2 = {
      macro_name: 'literal', env_mode: 'text', temporary_format: 'texttt',
      kind: 'partial', mdata: null, extension_data: { owner: 'consumer' }, children: [],
    } as SyntaxTreeNodeV2
    const v3 = migrateSyntaxTreeDocument(v2)
    expect(v3).toEqual({
      macro_name: '#', temporary_source: 'literal', env_mode: 'text', temporary_format: 'texttt',
      kind: 'partial', mdata: null, extension_data: { owner: 'consumer' }, children: [],
    })
    expect(isSyntaxTreeDocumentV3(v3 as any)).toBe(true)
  })

  it('keeps current tree v3 documents idempotent', () => {
    const current = {
      macro_name: 'root', kind: 'const-skin', mdata: null, children: [{
        macro_name: '#0', temporary_source: 'x', env_mode: 'formula_inline',
        kind: 'sub', mdata: null, children: [],
      }],
    }
    expect(isSyntaxTreeDocumentV2(current)).toBe(true)
    expect(isSyntaxTreeDocumentV3(current)).toBe(true)
    expect(migrateSyntaxTreeDocument(current as any)).toEqual(current)
  })

  it('rejects temporary v3 nodes with missing payload, wrong coordinates, or invalid format', () => {
    const base = {
      macro_name: '#', temporary_source: 'x', env_mode: 'text',
      kind: 'sub', mdata: null, children: [],
    }
    expect(isSyntaxTreeDocumentV3({ ...base, temporary_source: undefined } as any)).toBe(false)
    expect(isSyntaxTreeDocumentV3({ ...base, macro_name: '#0' } as any)).toBe(false)
    expect(isSyntaxTreeDocumentV3({ ...base, temporary_format: 'code' } as any)).toBe(false)
  })
})
