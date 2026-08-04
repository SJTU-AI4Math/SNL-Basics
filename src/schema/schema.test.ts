import { describe, expect, it } from 'vitest'
import {
  migrateMacroDocument,
  migrateStyleV6toV7,
  migrateMacroV6toV7,
  migrateMacroV7toV8,
  isMacroDocumentV7,
  isMacroDocumentV8,
  migrateSyntaxTreeDocument,
  migrateTreeNodeV1toV2,
  isSyntaxTreeDocumentV2,
  MACRO_SCHEMA_VERSION,
  TREE_SCHEMA_VERSION,
} from './index'
import type { MacroV6, MacroStyleV6, SyntaxTreeNodeV1 } from './index'
import type { I18n } from '../runtime'

describe('schema/versions', () => {
  it('exports correct version constants', () => {
    expect(MACRO_SCHEMA_VERSION).toBe(8)
    expect(TREE_SCHEMA_VERSION).toBe(2)
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
    expect(result.Add.default_style).toEqual({ en: 'default' })
  })

  it('isMacroDocumentV7 detects v6 documents', () => {
    const v6Db = { Add: { ...v6Macro, styles: [v6Style] } }
    expect(isMacroDocumentV7(v6Db as any)).toBe(false)
  })

  it('isMacroDocumentV7 detects v7 documents', () => {
    const v7 = { Add: migrateMacroV6toV7(v6Macro) }
    expect(isMacroDocumentV7(v7 as any)).toBe(true)
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

  it('migrates a localized v7 text template into separate v8 styles', () => {
    const i18n: I18n<string, string> = {
      type: 'i18n',
      default_language: 'en',
      values: { en: '#0 is a group', 'zh-CN': '#0 是群' },
    }
    const text = migrateMacroV6toV7(v6Macro)
    text.styles = [{ style_name: 'prose', mode: 'text', template: i18n, tags: [] }]
    expect(isMacroDocumentV7({ Add: text } as any)).toBe(true)
    expect(() => migrateMacroV7toV8(text)).toThrow(/split it manually/)
    const migrated = migrateMacroV7toV8(text, { split_localized_templates: true })
    expect(migrated.default_style).toEqual({ en: 'prose', 'zh-CN': 'prose_zh_CN' })
    expect(migrated.styles).toEqual([
      expect.objectContaining({ style_name: 'prose', template: '#0 is a group' }),
      expect.objectContaining({ style_name: 'prose_zh_CN', template: '#0 是群' }),
    ])
    expect(isMacroDocumentV8({ Add: migrated } as any)).toBe(true)
  })

  it('rejects I18n templates from v8 documents', () => {
    const i18n: I18n<string, string> = {
      type: 'i18n',
      default_language: 'en',
      values: { en: '#0', 'zh-CN': '#0' },
    }
    const text = migrateMacroV6toV7(v6Macro)
    text.styles = [{ style_name: 'prose', mode: 'text', template: '#0', tags: [] }]
    const invalid = {
      ...migrateMacroV7toV8(text),
      styles: [{ style_name: 'prose', mode: 'text', template: i18n, tags: [] }],
    }
    expect(isMacroDocumentV8({ Add: invalid } as any)).toBe(false)
  })

  it('rejects ambiguous or unparseable v8 style schemas', () => {
    const text = migrateMacroV7toV8({
      ...migrateMacroV6toV7(v6Macro),
      styles: [{ style_name: 'prose', mode: 'text', template: '#0', tags: [] }],
    })
    expect(isMacroDocumentV8({ Add: {
      ...text,
      styles: [...text.styles, { ...text.styles[0] }],
    } } as any)).toBe(false)
    expect(isMacroDocumentV8({ Add: {
      ...text,
      default_style: { en: 'bad style' },
      styles: [{ ...text.styles[0], style_name: 'bad style' }],
    } } as any)).toBe(false)
    expect(isMacroDocumentV8({ Add: {
      ...text,
      styles: [{ ...text.styles[0], block_template_name: 'list' }],
    } } as any)).toBe(false)
  })

  it('accepts Unicode Macro and style names under the Parser identifier policy', () => {
    const unicode = migrateMacroV7toV8({
      ...migrateMacroV6toV7(v6Macro),
      name: '群.是群🐈',
      styles: [{ style_name: '默认样式', mode: 'text', template: '群', tags: [] }],
    })
    expect(isMacroDocumentV8({ [unicode.name]: unicode } as any)).toBe(true)
    expect(isMacroDocumentV8({ 'bad!name': { ...unicode, name: 'bad!name' } } as any)).toBe(false)
    expect(isMacroDocumentV8({ X: {
      ...unicode, name: 'X',
      styles: [{ ...unicode.styles[0], style_name: 'bad/name' }],
      default_style: { en: 'bad/name' },
    } } as any)).toBe(false)
  })

  it('validates complete records and never drops malformed entries', () => {
    expect(isMacroDocumentV7({ X: null } as any)).toBe(false)
    expect(() => migrateMacroDocument({ bad: 'value' } as any)).toThrow(/neither valid v6, v7, nor v8/)

    const valid = migrateMacroV7toV8({
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
      expect(isMacroDocumentV8({ X: { ...valid, ...patch } } as any)).toBe(false)
    }
  })

  it('rejects malformed I18n-like templates before producing v8 output', () => {
    const malformed = {
      ...migrateMacroV6toV7(v6Macro),
      styles: [{
        style_name: 'prose', mode: 'text', tags: [],
        template: { type: 'i18n', default_language: 'fr', values: { en: 'X' } },
      }],
    }
    expect(() => migrateMacroV7toV8(malformed as any, {
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

  it('migrateSyntaxTreeDocument handles full tree', () => {
    const v2 = migrateSyntaxTreeDocument(v1Node)
    expect(v2.macro_name).toBe('Add')
    expect(v2.children.length).toBe(2)
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
})
