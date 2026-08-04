/**
 * Macro-schema migrations.
 *
 * v7 introduced snake_case style fields and allowed serialized I18n maps in
 * text templates. v8 restores every style template to a plain string and adds
 * `SnlMacro.default_style`, a language-to-style-name map.
 */
import type { I18n } from '../runtime'
import type { SnlMacro, SnlMacroStyle } from '../snl-macro/types'

/** v6 style shape (pre-v7 migration). */
export interface MacroStyleV6 {
  tag?: string
  style_name?: string
  mode: string
  template: string
  variadic_left?: string
  variadic_join?: string
  variadic_right?: string
  react_renderer_key?: string
  block_template_name?: string
  tags?: string[]
}

/** v6 macro shape (pre-v7 migration). */
export interface MacroV6 {
  name: string
  description: string
  source: { entries: string[]; urls: string[] }
  dynamic_arity: boolean
  kind?: string
  tags?: string[]
  styles: MacroStyleV6[]
}

export interface MacroStyleV7Base {
  style_name: string
  mode: 'formula_inline' | 'formula_display' | 'text' | 'block'
  template: string | I18n<string, string>
  separator?: string
  block_template_name?: string
  tags: string[]
}

/** v7 macro shape: ordered styles, with I18n permitted only in text templates. */
export interface MacroV7 extends Omit<SnlMacro, 'default_style' | 'styles'> {
  styles: MacroStyleV7Base[]
}

function isI18nString(value: unknown): value is I18n<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.type !== 'i18n' || typeof record.default_language !== 'string') return false
  if (!record.values || typeof record.values !== 'object' || Array.isArray(record.values)) return false
  const values = record.values as Record<string, unknown>
  const keys = Object.keys(values)
  return (
    keys.length > 0 &&
    typeof values[record.default_language] === 'string' &&
    keys.every((key) => typeof values[key] === 'string')
  )
}

// Exactly the IDENT token grammar accepted inside `[style]` by the parser.
const STYLE_NAME_RE = /^[A-Za-z0-9_\\][A-Za-z0-9_.-]*$/

function isStyleV7(input: unknown): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const style = input as Record<string, unknown>
  if (typeof style.style_name !== 'string' || !STYLE_NAME_RE.test(style.style_name) ||
      'tag' in style || 'variadic_left' in style ||
      'variadic_join' in style || 'variadic_right' in style) return false
  if (!Array.isArray(style.tags) || !style.tags.every((tag) => typeof tag === 'string')) return false
  if (style.separator !== undefined && typeof style.separator !== 'string') return false
  if (style.block_template_name !== undefined &&
      (style.mode !== 'block' || typeof style.block_template_name !== 'string')) return false
  if (style.mode === 'text') return typeof style.template === 'string' || isI18nString(style.template)
  if (style.mode === 'formula_inline' || style.mode === 'formula_display' || style.mode === 'block') {
    return typeof style.template === 'string'
  }
  return false
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isMacroBase(value: Record<string, unknown>, requireTags = true): boolean {
  if (typeof value.name !== 'string' || typeof value.description !== 'string') return false
  if (typeof value.dynamic_arity !== 'boolean') return false
  if (requireTags ? !isStringArray(value.tags) : value.tags !== undefined && !isStringArray(value.tags)) return false
  if (value.kind !== undefined && typeof value.kind !== 'string') return false
  if (!value.source || typeof value.source !== 'object' || Array.isArray(value.source)) return false
  const source = value.source as Record<string, unknown>
  return isStringArray(source.entries) && isStringArray(source.urls)
}

function isStyleV6(input: unknown): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const style = input as Record<string, unknown>
  if (!['formula_inline', 'formula_display', 'text', 'block'].includes(String(style.mode))) return false
  if (typeof style.template !== 'string') return false
  if (style.tag !== undefined && typeof style.tag !== 'string') return false
  if (style.style_name !== undefined && typeof style.style_name !== 'string') return false
  if (style.tags !== undefined && !isStringArray(style.tags)) return false
  for (const field of ['variadic_left', 'variadic_join', 'variadic_right', 'react_renderer_key', 'block_template_name']) {
    if (style[field] !== undefined && typeof style[field] !== 'string') return false
  }
  return true
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value as Record<string, unknown>).every((item) => typeof item === 'string')
}

/** Detect an old v7 document. */
export function isMacroDocumentV7(db: Record<string, unknown>): boolean {
  for (const macro of Object.values(db)) {
    if (!macro || typeof macro !== 'object' || Array.isArray(macro)) return false
    const value = macro as Record<string, unknown>
    if (!isMacroBase(value)) return false
    if ('default_style' in value) return false
    const styles = value.styles as Record<string, unknown>[] | undefined
    if (!styles || styles.length === 0 || styles.some((style) => !isStyleV7(style))) return false
    const names = styles.map((style) => style.style_name as string)
    if (new Set(names).size !== names.length) return false
  }
  return true
}

function isMacroDocumentV6(db: Record<string, unknown>): boolean {
  for (const macro of Object.values(db)) {
    if (!macro || typeof macro !== 'object' || Array.isArray(macro)) return false
    const value = macro as Record<string, unknown>
    if (!isMacroBase(value, false) || 'default_style' in value) return false
    if (!Array.isArray(value.styles) || value.styles.length === 0 ||
        value.styles.some((style) => !isStyleV6(style))) return false
  }
  return true
}

/** Detect the v8 default-style schema and validate every mapped style name. */
export function isMacroDocumentV8(db: Record<string, unknown>): boolean {
  for (const macro of Object.values(db)) {
    if (!macro || typeof macro !== 'object') return false
    const value = macro as Record<string, unknown>
    if (!isMacroBase(value) || !isStringRecord(value.default_style)) {
      return false
    }
    const styles = value.styles as Record<string, unknown>[] | undefined
    if (!styles || styles.length === 0 || styles.some((style) => !isStyleV7(style) || typeof style.template !== 'string')) {
      return false
    }
    const styleNames = styles.map((style) => style.style_name as string)
    const names = new Set(styleNames)
    if (names.size !== styleNames.length) return false
    if (Object.keys(value.default_style).some((language) => language.trim().length === 0)) return false
    if (Object.values(value.default_style).some((name) => !names.has(name))) return false
  }
  return true
}

/** Migrate one style from v6 to v7, losslessly. */
export function migrateStyleV6toV7(style: MacroStyleV6): MacroStyleV7Base {
  const { variadic_left, variadic_join, variadic_right } = style
  const separator = variadic_join
  let template = style.template
  const hasLegacyDynamicFields =
    variadic_left !== undefined || variadic_join !== undefined || variadic_right !== undefined
  if (hasLegacyDynamicFields) template = `${variadic_left ?? ''}#*${variadic_right ?? ''}`

  const block_template_name = style.react_renderer_key ?? style.block_template_name
  if (block_template_name && style.mode !== 'block') {
    throw new Error('block_template_name is valid only in block mode')
  }
  return {
    style_name: style.tag ?? style.style_name ?? 'default',
    mode: style.mode as MacroStyleV7Base['mode'],
    template,
    separator,
    ...(style.mode === 'block' && block_template_name ? { block_template_name } : {}),
    tags: style.tags ?? [],
  }
}

/** Migrate one macro from v6 to v7. */
export function migrateMacroV6toV7(macro: MacroV6): MacroV7 {
  return {
    name: macro.name,
    description: macro.description,
    source: macro.source,
    kind: macro.kind,
    dynamic_arity: macro.dynamic_arity,
    tags: macro.tags ?? [],
    styles: macro.styles.map(migrateStyleV6toV7),
  }
}

function languageStyleName(base: string, language: string, used: Set<string>): string {
  const suffix = language.replace(/[^A-Za-z0-9_]/g, '_') || 'language'
  const stem = `${base}_${suffix}`
  let candidate = stem
  let index = 2
  while (used.has(candidate)) candidate = `${stem}_${index++}`
  used.add(candidate)
  return candidate
}

export interface MacroV7ToV8Options {
  /**
   * Split a v7 I18n template into independently named styles. This is opt-in
   * because explicit `Macro[style]` source cannot preserve its old
   * language-dependent behavior under v8's language-independent style model.
   */
  split_localized_templates?: boolean
}

/**
 * Migrate v7 localized text templates into separate plain-string styles.
 *
 * The I18n default-language value keeps the original style name. Other
 * languages get deterministic `<style>_<locale>` names. Only translations of
 * the old implicit first style populate `default_style`. This is opt-in because
 * explicit old style names cannot keep their language-dependent meaning.
 */
export function migrateMacroV7toV8(
  macro: MacroV7,
  options: MacroV7ToV8Options = {},
): SnlMacro {
  if (macro.styles.length === 0) throw new Error(`macro "${macro.name}" has no styles`)
  const used = new Set(macro.styles.map((style) => style.style_name))
  const styles: SnlMacroStyle[] = []
  const default_style: Record<string, string> = {}

  macro.styles.forEach((style, styleIndex) => {
    if (typeof style.template === 'string') {
      const migrated = { ...style, template: style.template } as SnlMacroStyle
      styles.push(migrated)
      if (styleIndex === 0) default_style.en = style.style_name
      return
    }

    if (!isI18nString(style.template)) {
      throw new Error(
        `macro "${macro.name}" style "${style.style_name}" has a malformed localized template`,
      )
    }

    if (!options.split_localized_templates) {
      throw new Error(
        `macro "${macro.name}" style "${style.style_name}" has a localized template; ` +
        'split it manually or opt in with split_localized_templates=true (explicit [style] source changes meaning)',
      )
    }

    const languages = Object.keys(style.template.values)
    const primary = languages.includes(style.template.default_language)
      ? style.template.default_language
      : languages[0]
    const ordered = [primary, ...languages.filter((language) => language !== primary)]
    for (const language of ordered) {
      const template = style.template.values[language]
      if (template === undefined) continue
      const style_name = language === primary
        ? style.style_name
        : languageStyleName(style.style_name, language, used)
      styles.push({ ...style, style_name, template } as SnlMacroStyle)
      if (styleIndex === 0) default_style[language] = style_name
    }
  })

  return { ...macro, default_style, styles }
}

/** Migrate a v6 or v7 document through the current v8 schema. */
export function migrateMacroDocument(
  db: Record<string, MacroV6 | MacroV7 | SnlMacro>,
  options: MacroV7ToV8Options = {},
): Record<string, SnlMacro> {
  if (isMacroDocumentV8(db as Record<string, unknown>)) {
    return { ...db } as Record<string, SnlMacro>
  }
  const isV7 = isMacroDocumentV7(db as Record<string, unknown>)
  if (!isV7 && !isMacroDocumentV6(db as Record<string, unknown>)) {
    throw new Error('macro document is neither valid v6, v7, nor v8 data')
  }
  const out: Record<string, SnlMacro> = {}
  for (const [key, macro] of Object.entries(db)) {
    const v7 = isV7 ? macro as MacroV7 : migrateMacroV6toV7(macro as MacroV6)
    out[key] = migrateMacroV7toV8(v7, options)
  }
  return out
}
