/**
 * Macro-schema migrations.
 *
 * v7 introduced snake_case style fields and serialized I18n maps in text
 * templates. The current v9 shape keeps that model: `styles[0]` is the sole
 * implicit default and localization stays inside each text style.
 */
import type { I18n } from '../runtime'
import type { SnlMacro, SnlMacroStyle } from '../snl-macro/types'
import { isSnlIdentifier } from '../snl-syntax-tree/identifier'

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

interface MacroStyleV7Common {
  style_name: string
  separator?: string
  tags: string[]
}

export type MacroStyleV7Base =
  | (MacroStyleV7Common & {
      mode: 'formula_inline' | 'formula_display'
      template: string
      block_template_name?: never
    })
  | (MacroStyleV7Common & {
      mode: 'text'
      template: string | I18n<string, string>
      block_template_name?: never
    })
  | (MacroStyleV7Common & {
      mode: 'block'
      template: string
      block_template_name?: string
    })

/** v9 macro shape: legacy kinds remain readable for explicit migration. */
export interface MacroV9 extends Omit<SnlMacro, 'kind'> {
  kind?: string
}

/** v10 persisted shape: documents materialize a display kind; `partial` is renamed to `sub`. */
export type MacroV10 = Omit<SnlMacro, 'kind' | 'default_style'> & {
  kind: string
  default_style?: never
}

/** v7 macro shape: ordered styles, with I18n permitted only in text templates. */
export interface MacroV7 extends Omit<MacroV9, 'styles'> {
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
    Object.prototype.hasOwnProperty.call(values, record.default_language) &&
    typeof values[record.default_language] === 'string' &&
    keys.every((key) => typeof values[key] === 'string')
  )
}

function isStyleV7(input: unknown): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const style = input as Record<string, unknown>
  if (typeof style.style_name !== 'string' || !isSnlIdentifier(style.style_name) ||
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
  if (typeof value.name !== 'string' || !isSnlIdentifier(value.name) ||
      typeof value.description !== 'string') return false
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
  if (style.tag !== undefined &&
      (typeof style.tag !== 'string' || !isSnlIdentifier(style.tag))) return false
  if (style.style_name !== undefined &&
      (typeof style.style_name !== 'string' || !isSnlIdentifier(style.style_name))) return false
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Detect an old v7 document. */
export function isMacroDocumentV7(db: Record<string, unknown>): boolean {
  if (!isPlainRecord(db)) return false
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
  if (!isPlainRecord(db)) return false
  for (const macro of Object.values(db)) {
    if (!macro || typeof macro !== 'object' || Array.isArray(macro)) return false
    const value = macro as Record<string, unknown>
    if (!isMacroBase(value, false) || 'default_style' in value) return false
    if (!Array.isArray(value.styles) || value.styles.length === 0 ||
        value.styles.some((style) => !isStyleV6(style))) return false
  }
  return true
}

/** Validate the published v8 schema (required language defaults, invariant templates). */
export function isMacroDocumentV8(db: Record<string, unknown>): boolean {
  if (!isPlainRecord(db)) return false
  for (const macro of Object.values(db)) {
    if (!macro || typeof macro !== 'object' || Array.isArray(macro)) return false
    const value = macro as Record<string, unknown>
    if (!isMacroBase(value) || !isStringRecord(value.default_style)) return false
    const styles = value.styles as Record<string, unknown>[] | undefined
    if (!styles || styles.length === 0 || styles.some((style) => {
      if (!isStyleV7(style) || typeof style.template !== 'string') return true
      return false
    })) return false
    const styleNames = styles.map((style) => style.style_name as string)
    if (new Set(styleNames).size !== styleNames.length) return false
    if (Object.keys(value.default_style).some((language) => language.trim().length === 0)) return false
    if (Object.values(value.default_style).some((name) => !styleNames.includes(name))) return false
  }
  return true
}

/** Validate the current v9 schema: styles[0] is default and text templates may localize. */
export function isMacroDocumentV9(db: Record<string, unknown>): boolean {
  if (!isPlainRecord(db)) return false
  for (const macro of Object.values(db)) {
    if (!macro || typeof macro !== 'object' || Array.isArray(macro)) return false
    const value = macro as Record<string, unknown>
    if (!isMacroBase(value) || 'default_style' in value) return false
    const styles = value.styles as Record<string, unknown>[] | undefined
    if (!styles || styles.length === 0 || styles.some((style) => !isStyleV7(style))) return false
    const styleNames = styles.map((style) => style.style_name as string)
    if (new Set(styleNames).size !== styleNames.length) return false
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
  } as MacroStyleV7Base
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

export interface MacroV7ToV8Options {
  /** Split localized v7 templates into invariant v8 styles. */
  split_localized_templates?: boolean
}

export interface MacroV7ToV9Options {
  /** @deprecated Localized text templates are preserved inside their style. */
  split_localized_templates?: boolean
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalize(item)]))
}

function stylesStructurallyMatch(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const { style_name: _leftName, template: _leftTemplate, ...leftStructure } = left
  const { style_name: _rightName, template: _rightTemplate, ...rightStructure } = right
  return JSON.stringify(canonicalize(leftStructure)) === JSON.stringify(canonicalize(rightStructure))
}

/** Upgrade a validated published-v8 macro while preserving implicit and explicit style behavior. */
function migrateLegacyV8Macro(macro: MacroV7 & { default_style: Record<string, string> }): MacroV9 {
  const firstName = macro.styles[0]?.style_name
  const mappedNames = Object.values(macro.default_style)
  if (firstName && mappedNames.every((styleName) => styleName === firstName)) {
    const { default_style: _legacyDefaultStyle, ...current } = macro
    return { ...current, styles: current.styles as SnlMacroStyle[] }
  }

  const byName = new Map(macro.styles.map((style) => [style.style_name, style]))
  const mapped = Object.entries(macro.default_style).map(([language, styleName]) => ({
    language,
    style: byName.get(styleName),
  }))
  const firstStyle = macro.styles[0]
  const hasEnglishDefault = Object.prototype.hasOwnProperty.call(macro.default_style, 'en')
  const structuralBase = mapped[0]?.style as unknown as Record<string, unknown> | undefined
  const unsafeFirstStyleFallback = !hasEnglishDefault && (
    !firstStyle || firstStyle.mode !== 'text' || typeof firstStyle.template !== 'string' ||
    !structuralBase ||
    !stylesStructurallyMatch(structuralBase, firstStyle as unknown as Record<string, unknown>)
  )
  if (!structuralBase || unsafeFirstStyleFallback || mapped.some(({ style }) =>
      !style || style.mode !== 'text' || typeof style.template !== 'string' ||
      !stylesStructurallyMatch(structuralBase, style as unknown as Record<string, unknown>))) {
    throw new Error(
      `macro "${macro.name}" has a nonredundant legacy default_style map whose styles cannot be merged safely`,
    )
  }

  const used = new Set(macro.styles.map((style) => style.style_name))
  const stem = `${firstName ?? 'default'}_localized_default`
  let syntheticName = stem
  let suffix = 2
  while (used.has(syntheticName)) syntheticName = `${stem}_${suffix++}`
  const values: Record<string, string> = Object.fromEntries(
    mapped.map(({ language, style }) => [language, style!.template as string]),
  )
  if (!hasEnglishDefault) values.en = firstStyle.template as string
  const synthetic = {
    ...mapped[0].style!,
    style_name: syntheticName,
    template: { type: 'i18n' as const, default_language: 'en', values },
  } as SnlMacroStyle
  const { default_style: _legacyDefaultStyle, ...current } = macro
  return { ...current, styles: [synthetic, ...(current.styles as SnlMacroStyle[])] }
}

/** Preserve ordered styles and localized text templates in schema v9. */
export function migrateMacroV7toV9(
  macro: MacroV7,
  _options: MacroV7ToV9Options = {},
): MacroV9 {
  if (macro.styles.length === 0) throw new Error(`macro "${macro.name}" has no styles`)
  const legacyDefault = (macro as MacroV7 & { default_style?: unknown }).default_style
  if (legacyDefault !== undefined) {
    if (!isStringRecord(legacyDefault)) {
      throw new Error(`macro "${macro.name}" has an invalid legacy default_style map`)
    }
    return migrateLegacyV8Macro(macro as MacroV7 & { default_style: Record<string, string> })
  }
  const styles = macro.styles.map((style) => {
    if (style.mode === 'text') {
      if (typeof style.template !== 'string' && !isI18nString(style.template)) {
        throw new Error(
          `macro "${macro.name}" style "${style.style_name}" has a malformed localized template`,
        )
      }
      return { ...style } as SnlMacroStyle
    }
    if (typeof style.template !== 'string') {
      throw new Error(
        `macro "${macro.name}" style "${style.style_name}" may localize templates only in text mode`,
      )
    }
    return { ...style } as SnlMacroStyle
  })
  const { default_style: _legacyDefaultStyle, ...current } = macro as MacroV7 & {
    default_style?: Record<string, string>
  }
  return { ...current, styles }
}

/** Published schema-v8 Style: every Template is language-invariant. */
export type MacroV8Style = SnlMacroStyle extends infer Style
  ? Style extends SnlMacroStyle
    ? Omit<Style, 'template'> & { template: string }
    : never
  : never

/** Published schema-v8 record retained for migration/source compatibility. */
export interface MacroV8 extends Omit<MacroV9, 'styles'> {
  default_style: Record<string, string>
  styles: MacroV8Style[]
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

/**
 * Retained published v7→v8 migration. New consumers should migrate directly to
 * v9 with migrateMacroV7toV9.
 */
export function migrateMacroV7toV8(
  macro: MacroV7,
  options: MacroV7ToV8Options = {},
): MacroV8 {
  if (macro.styles.length === 0) throw new Error(`macro "${macro.name}" has no styles`)
  const used = new Set(macro.styles.map((style) => style.style_name))
  const styles: MacroV8Style[] = []
  const defaultStyleEntries: Array<[string, string]> = []
  macro.styles.forEach((style, styleIndex) => {
    if (typeof style.template === 'string') {
      styles.push({ ...style, template: style.template } as MacroV8Style)
      if (styleIndex === 0) defaultStyleEntries.push(['en', style.style_name])
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
        'opt in with split_localized_templates=true or migrate directly to v9',
      )
    }
    const languages = Object.keys(style.template.values)
    const primary = style.template.default_language
    for (const language of [primary, ...languages.filter((item) => item !== primary)]) {
      const template = style.template.values[language]
      if (template === undefined) continue
      const style_name = language === primary
        ? style.style_name
        : languageStyleName(style.style_name, language, used)
      styles.push({ ...style, style_name, template } as MacroV8Style)
      if (styleIndex === 0) defaultStyleEntries.push([language, style_name])
    }
  })
  return { ...macro, default_style: Object.fromEntries(defaultStyleEntries), styles }
}

/** Canonicalize one v9 Macro for schema v10. */
export function migrateMacroV9toV10(macro: MacroV9): MacroV10 {
  const { default_style: _legacyDefaultStyle, ...current } = macro
  return {
    ...current,
    kind: macro.kind === 'partial' || macro.kind === 'sub'
      ? 'sub'
      : typeof macro.kind === 'string' && macro.kind.length > 0 ? macro.kind : 'const',
  }
}

/** Validate current schema v10 while leaving historical validators permissive. */
export function isMacroDocumentV10(db: Record<string, unknown>): boolean {
  if (!isMacroDocumentV9(db)) return false
  return Object.values(db).every((macro) => {
    const kind = (macro as Record<string, unknown>).kind
    return typeof kind === 'string' && kind.length > 0 && kind !== 'partial'
  })
}

/** Migrate a v6, v7, v8, or v9 document to schema v10. */
export function migrateMacroDocument(
  db: Record<string, MacroV6 | MacroV7 | MacroV8 | MacroV9 | MacroV10>,
  options: MacroV7ToV9Options = {},
): Record<string, SnlMacro> {
  if (!isPlainRecord(db)) throw new Error('macro document must be a plain object')
  if (isMacroDocumentV10(db as Record<string, unknown>)) return { ...db } as Record<string, SnlMacro>

  const entries: Array<[string, SnlMacro]> = []
  for (const [key, input] of Object.entries(db)) {
    const one = { [key]: input } as Record<string, unknown>
    let v7: MacroV7
    if (isMacroDocumentV9(one) || isMacroDocumentV7(one)) {
      v7 = input as MacroV7
    } else if (isMacroDocumentV8(one)) {
      v7 = input as MacroV7 & { default_style: Record<string, string> }
    } else if (isMacroDocumentV6(one)) {
      v7 = migrateMacroV6toV7(input as MacroV6)
    } else {
      throw new Error(`macro document entry ${JSON.stringify(key)} is not valid v6, v7, v8, v9, or v10 data`)
    }
    entries.push([key, migrateMacroV9toV10(migrateMacroV7toV9(v7, options))])
  }
  return Object.fromEntries(entries)
}
