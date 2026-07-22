/**
 * Migrate macro document from v6 (0.9.x) to v7 (0.10.0).
 *
 * v6 style fields: tag, mode, template, variadic_left?, variadic_join?, variadic_right?, react_renderer_key?
 * v7 style fields: style_name, mode, template, separator?, block_template_name?, tags
 *
 * Mapping:
 *   - tag → style_name
 *   - react_renderer_key → block_template_name
 *   - variadic_join → separator (lossless: left+#*+right become template content)
 *   - variadic_left/variadic_right removed (absorbed into template with #*)
 *   - tags: [] added if missing
 *   - SnlMacro.name STAYS as `name` (no rename)
 */
import type { SnlMacro, SnlMacroStyle } from '../snl-macro/types'

/** v6 style shape (pre-migration) */
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

/** v6 macro shape (pre-migration) */
export interface MacroV6 {
  name: string
  description: string
  source: { entries: string[]; urls: string[] }
  dynamic_arity: boolean
  kind?: string
  tags?: string[]
  styles: MacroStyleV6[]
}

/** Validate a serialized I18n<string> value. */
function isI18nString(value: unknown): boolean {
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

/** Detect whether a style is already v7 and respects localized-template rules. */
function isStyleV7(s: Record<string, unknown>): boolean {
  if (!('style_name' in s) || 'tag' in s || 'variadic_left' in s || 'variadic_join' in s || 'variadic_right' in s) {
    return false
  }
  if (!Array.isArray(s.tags) || !s.tags.every((tag) => typeof tag === 'string')) return false
  if (s.mode === 'text') {
    return typeof s.template === 'string' || isI18nString(s.template)
  }
  if (s.mode === 'formula_inline' || s.mode === 'formula_display' || s.mode === 'block') {
    return typeof s.template === 'string'
  }
  return false
}

/** Detect whether a macro document is already v7 */
export function isMacroDocumentV7(db: Record<string, unknown>): boolean {
  for (const macro of Object.values(db)) {
    if (!macro || typeof macro !== 'object') continue
    const m = macro as Record<string, unknown>
    if (!('name' in m)) return false
    if (!Array.isArray(m.tags)) return false
    const styles = m.styles as Record<string, unknown>[] | undefined
    if (styles && styles.some((style) => !isStyleV7(style))) return false
  }
  return true
}

/** Migrate a single style from v6 to v7, losslessly */
export function migrateStyleV6toV7(style: MacroStyleV6): SnlMacroStyle {
  const { variadic_left, variadic_join, variadic_right } = style

  // Build separator from variadic_join
  const separator = variadic_join

  // Build template: if variadic_left/right existed, embed them around #*
  let template = style.template
  const hasLegacyDynamicFields =
    variadic_left !== undefined || variadic_join !== undefined || variadic_right !== undefined
  if (hasLegacyDynamicFields) {
    template = `${variadic_left ?? ''}#*${variadic_right ?? ''}`
  }

  const block_template_name = style.react_renderer_key ?? style.block_template_name
  if (block_template_name && style.mode !== 'block') {
    throw new Error('block_template_name is valid only in block mode')
  }

  const base = {
    style_name: style.tag ?? style.style_name ?? 'default',
    template,
    separator,
    tags: style.tags ?? [],
  }
  if (style.mode === 'text') {
    return { ...base, mode: 'text' }
  }
  return {
    ...base,
    mode: style.mode as 'formula_inline' | 'formula_display' | 'block',
    block_template_name,
  }
}

/** Migrate a single macro from v6 to v7 */
export function migrateMacroV6toV7(macro: MacroV6): SnlMacro {
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

/** Migrate an entire macro document (Record<string, MacroV6>) to v7 */
export function migrateMacroDocument(db: Record<string, MacroV6>): Record<string, SnlMacro> {
  const out: Record<string, SnlMacro> = {}
  for (const [key, macro] of Object.entries(db)) {
    if (!macro || typeof macro !== 'object') continue
    out[key] = migrateMacroV6toV7(macro)
  }
  return out
}
