// @ts-check
/**
 * Unified migration script for SNL-Basics schema.
 * Applies:
 *   - Macro v6 → v7: tag→style_name, react_renderer_key→block_template_name,
 *     variadic_left/join/right → separator + template with #*, tags: []
 *   - Macro v7/v8 → v9: preserve localized text templates; styles[0] is default
 *   - Syntax tree v1 → v2: name→macro_name, style→style_name, envMode→env_mode
 *
 * NOTE: SnlMacro.name stays as `name` (NOT renamed to macro_name).
 *
 * Usage:
 *   node scripts/migrate-schema.mjs [--write] [--target <path>...]
 *
 * At least one --target is required; SNL-Basics does not own consumer data.
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const write = process.argv.includes('--write')
const dryRun = !write

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/migrate-schema.mjs [--write] [--target <path>...]')
  console.log('Default is dry-run. --write creates <path>.bak before overwriting.')
  process.exit(0)
}

const targetIdx = process.argv.indexOf('--target')
const targets = targetIdx >= 0
  ? process.argv.slice(targetIdx + 1).filter(a => !a.startsWith('--'))
  : []
if (targets.length === 0) {
  console.error('At least one --target <path> is required.')
  process.exit(2)
}

// --- Macro v6→v7 migration (source-equivalent to src/schema/migrate-macro.ts) ---

function migrateStyleV6toV7(style) {
  const { variadic_left, variadic_join, variadic_right, tag, react_renderer_key, tags, ...rest } = style
  let template = rest.template || ''
  const hasLegacyDynamicFields = variadic_left !== undefined || variadic_join !== undefined || variadic_right !== undefined
  if (hasLegacyDynamicFields) {
    template = `${variadic_left ?? ''}#*${variadic_right ?? ''}`
  }
  const blockTemplateName = react_renderer_key ?? rest.block_template_name
  if (blockTemplateName && rest.mode !== 'block') {
    throw new Error('block_template_name is valid only in block mode')
  }
  return {
    style_name: tag ?? rest.style_name ?? 'default',
    mode: rest.mode,
    template,
    ...(variadic_join !== undefined ? { separator: variadic_join } : {}),
    ...(blockTemplateName ? { block_template_name: blockTemplateName } : {}),
    tags: tags ?? [],
  }
}

function migrateMacroV6toV7(macro) {
  return {
    name: macro.name,
    description: macro.description,
    source: macro.source,
    ...(macro.kind !== undefined ? { kind: macro.kind } : {}),
    dynamic_arity: macro.dynamic_arity,
    tags: macro.tags ?? [],
    styles: (macro.styles || []).map(migrateStyleV6toV7),
  }
}

const ASCII_IDENTIFIER_START = /^[A-Za-z0-9_\\]$/
const ASCII_IDENTIFIER_CONTINUE = /^[A-Za-z0-9_.-]$/
const UNSAFE_UNICODE_IDENTIFIER = /[\p{White_Space}\p{Cc}\p{Cf}\p{Cs}]/u
const MODES = new Set(['formula_inline', 'formula_display', 'text', 'block'])

/** @param {string} value */
function isSnlIdentifier(value) {
  if (value.length === 0) return false
  const chars = [...value]
  const first = chars.shift()
  if (first === undefined) return false
  if (first.charCodeAt(0) <= 0x7f
    ? !ASCII_IDENTIFIER_START.test(first)
    : UNSAFE_UNICODE_IDENTIFIER.test(first)) return false
  return chars.every((char) => char.charCodeAt(0) <= 0x7f
    ? ASCII_IDENTIFIER_CONTINUE.test(char)
    : !UNSAFE_UNICODE_IDENTIFIER.test(char))
}

/** @param {any} value */
function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/** @param {any} macro @param {boolean} [requireTags] */
function isMacroBase(macro, requireTags = true) {
  if (!macro || typeof macro !== 'object' || Array.isArray(macro)) return false
  if (typeof macro.name !== 'string' || !isSnlIdentifier(macro.name) ||
      typeof macro.description !== 'string') return false
  if (typeof macro.dynamic_arity !== 'boolean') return false
  if (requireTags ? !isStringArray(macro.tags) : macro.tags !== undefined && !isStringArray(macro.tags)) return false
  if (macro.kind !== undefined && typeof macro.kind !== 'string') return false
  return macro.source && typeof macro.source === 'object' && !Array.isArray(macro.source) &&
    isStringArray(macro.source.entries) && isStringArray(macro.source.urls)
}

/** @param {any} style */
function isStyleV7(style) {
  if (!style || typeof style !== 'object' || Array.isArray(style)) return false
  if (typeof style.style_name !== 'string' || !isSnlIdentifier(style.style_name)) return false
  if (!MODES.has(style.mode) || !isStringArray(style.tags)) return false
  if ('tag' in style || 'variadic_left' in style || 'variadic_join' in style || 'variadic_right' in style) return false
  if (style.separator !== undefined && typeof style.separator !== 'string') return false
  if (style.block_template_name !== undefined &&
      (style.mode !== 'block' || typeof style.block_template_name !== 'string')) return false
  return style.mode === 'text'
    ? typeof style.template === 'string' || isI18nString(style.template)
    : typeof style.template === 'string'
}

/** @param {Record<string, any>} db */
function isMacroDocumentV7(db) {
  for (const macro of Object.values(db)) {
    if (!isMacroBase(macro) || 'default_style' in macro) return false
    if (!Array.isArray(macro.styles) || macro.styles.length === 0 || macro.styles.some((style) => !isStyleV7(style))) return false
    const names = macro.styles.map((style) => style.style_name)
    if (new Set(names).size !== names.length) return false
  }
  return true
}

/** @param {any} style */
function isStyleV6(style) {
  if (!style || typeof style !== 'object' || Array.isArray(style)) return false
  if (!MODES.has(style.mode) || typeof style.template !== 'string') return false
  if (style.tags !== undefined && !isStringArray(style.tags)) return false
  if (style.tag !== undefined &&
      (typeof style.tag !== 'string' || !isSnlIdentifier(style.tag))) return false
  if (style.style_name !== undefined &&
      (typeof style.style_name !== 'string' || !isSnlIdentifier(style.style_name))) return false
  for (const field of ['variadic_left', 'variadic_join', 'variadic_right', 'react_renderer_key', 'block_template_name']) {
    if (style[field] !== undefined && typeof style[field] !== 'string') return false
  }
  return true
}

/** @param {Record<string, any>} db */
function isMacroDocumentV6(db) {
  return Object.values(db).every((macro) =>
    isMacroBase(macro, false) && !('default_style' in macro) &&
    Array.isArray(macro.styles) && macro.styles.length > 0 && macro.styles.every(isStyleV6)
  )
}

/** @param {Record<string, any>} db */
function isMacroDocumentV9(db) {
  return Object.values(db).every((macro) => {
    if (!isMacroBase(macro) || 'default_style' in macro) return false
    if (!Array.isArray(macro.styles) || macro.styles.length === 0 ||
        macro.styles.some((style) => !isStyleV7(style))) return false
    const styleNames = macro.styles.map((style) => style.style_name)
    return new Set(styleNames).size === styleNames.length
  })
}

/** @param {any} style */
function isInvariantStyleV8(style) {
  return isStyleV7(style) && typeof style.template === 'string'
}

/** @param {Record<string, any>} db */
function isMacroDocumentLegacyDefault(db) {
  return Object.values(db).every((macro) => {
    if (!isMacroBase(macro) || !macro.default_style ||
        typeof macro.default_style !== 'object' || Array.isArray(macro.default_style)) return false
    if (!Array.isArray(macro.styles) || macro.styles.length === 0 ||
        !macro.styles.every(isInvariantStyleV8)) return false
    const styleNames = macro.styles.map((style) => style.style_name)
    if (new Set(styleNames).size !== styleNames.length) return false
    return Object.entries(macro.default_style).every(([language, name]) =>
      language.trim().length > 0 && typeof name === 'string' && styleNames.includes(name)
    )
  })
}

/** @param {any} value */
function isI18nString(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    value.type === 'i18n' && typeof value.default_language === 'string' &&
    value.values && typeof value.values === 'object' && !Array.isArray(value.values) &&
    Object.keys(value.values).length > 0 &&
    Object.prototype.hasOwnProperty.call(value.values, value.default_language) &&
    typeof value.values[value.default_language] === 'string' &&
    Object.values(value.values).every((item) => typeof item === 'string')
}

/** @param {any} macro */
function migrateMacroV7toV9(macro) {
  const { default_style: _legacyDefaultStyle, ...current } = macro
  return { ...current, styles: macro.styles.map((style) => ({ ...style })) }
}

/** @param {unknown} value @returns {unknown} */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalize(item)]))
}

/** @param {any} left @param {any} right */
function stylesStructurallyMatch(left, right) {
  const { style_name: _leftName, template: _leftTemplate, ...leftStructure } = left
  const { style_name: _rightName, template: _rightTemplate, ...rightStructure } = right
  return JSON.stringify(canonicalize(leftStructure)) === JSON.stringify(canonicalize(rightStructure))
}

/** @param {any} macro */
function migrateLegacyV8Macro(macro) {
  const firstName = macro.styles[0].style_name
  const styles = /** @type {any[]} */ (macro.styles)
  const mappedNames = Object.values(macro.default_style)
  if (mappedNames.every((styleName) => styleName === firstName)) return migrateMacroV7toV9(macro)
  const byName = new Map(styles.map((style) => [style.style_name, style]))
  const mapped = Object.entries(macro.default_style).map(([language, styleName]) => ({
    language, style: byName.get(styleName),
  }))
  const base = mapped[0]?.style
  const firstStyle = styles[0]
  const hasEnglishDefault = Object.prototype.hasOwnProperty.call(macro.default_style, 'en')
  const unsafeFirstStyleFallback = !hasEnglishDefault && (
    !firstStyle || firstStyle.mode !== 'text' || typeof firstStyle.template !== 'string' ||
    !base || !stylesStructurallyMatch(base, firstStyle)
  )
  if (!base || unsafeFirstStyleFallback || mapped.some(({ style }) =>
      !style || style.mode !== 'text' || typeof style.template !== 'string' ||
      !stylesStructurallyMatch(base, style))) {
    throw new Error(`macro ${JSON.stringify(macro.name)} has legacy default styles that cannot be merged safely`)
  }
  const used = new Set(styles.map((style) => style.style_name))
  const stem = `${firstName}_localized_default`
  let name = stem
  let suffix = 2
  while (used.has(name)) name = `${stem}_${suffix++}`
  const values = Object.fromEntries(mapped.map(({ language, style }) => [language, style.template]))
  if (!hasEnglishDefault) values.en = firstStyle.template
  const synthetic = {
    ...base, style_name: name,
    template: { type: 'i18n', default_language: 'en', values },
  }
  const current = migrateMacroV7toV9(macro)
  return { ...current, styles: [synthetic, ...current.styles] }
}

/** @param {Record<string, any>} db */
function migrateMacroDb(db) {
  const entries = []
  for (const [key, macro] of Object.entries(db)) {
    const one = { [key]: macro }
    let migrated
    if (isMacroDocumentV9(one) || isMacroDocumentV7(one)) {
      migrated = migrateMacroV7toV9(macro)
    } else if (isMacroDocumentLegacyDefault(one)) {
      migrated = migrateLegacyV8Macro(macro)
    } else if (isMacroDocumentV6(one)) {
      migrated = migrateMacroV7toV9(migrateMacroV6toV7(macro))
    } else {
      throw new Error(`entry ${JSON.stringify(key)} is not valid v6, v7, safe v8, or v9 data`)
    }
    entries.push([key, migrated])
  }
  return Object.fromEntries(entries)
}

// --- Syntax tree v1→v2 migration (source-equivalent to src/schema/migrate-tree.ts) ---

function migrateTreeNode(node) {
  if (!node || typeof node !== 'object') return node
  const { name, style, envMode, children, ...rest } = node
  return {
    ...rest,
    macro_name: name,
    kind: typeof rest.kind === 'string' ? rest.kind : '',
    mdata: rest.mdata ?? null,
    ...(style ? { style_name: style } : {}),
    ...(envMode ? { env_mode: envMode } : {}),
    children: Array.isArray(children) ? children.map(migrateTreeNode) : [],
  }
}

/** @param {any} node */
function isSyntaxTreeV1(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node) ||
      typeof node.name !== 'string' || 'macro_name' in node || !Array.isArray(node.children)) return false
  return node.children.every(isSyntaxTreeV1)
}

/** @param {any} node */
function isSyntaxTreeV2(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node) ||
      typeof node.macro_name !== 'string' || typeof node.kind !== 'string' ||
      !Object.prototype.hasOwnProperty.call(node, 'mdata') || !Array.isArray(node.children) ||
      Object.prototype.hasOwnProperty.call(node, 'name')) return false
  return node.children.every(isSyntaxTreeV2)
}

// --- Main ---

let exitCode = 0
for (const target of targets) {
  let raw
  try {
    raw = readFileSync(target, 'utf8')
  } catch (e) {
    console.error(`[error] cannot read ${target}: ${e.message}`)
    exitCode = 1
    continue
  }

  let doc
  try {
    doc = JSON.parse(raw)
  } catch (e) {
    console.error(`[error] invalid JSON in ${target}: ${e.message}`)
    exitCode = 1
    continue
  }

  // Detect type: macro DB (object of objects with styles) vs tree (has name/macro_name + children)
  let result
  let kind
  if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
    if (isSyntaxTreeV1(doc) || isSyntaxTreeV2(doc)) {
      // Syntax tree
      if (isSyntaxTreeV2(doc)) {
        console.log(`[skip] ${target} — already tree v2`)
        continue
      }
      result = migrateTreeNode(doc)
      kind = 'tree v1→v2'
    } else {
      // Macro DB
      if (isMacroDocumentV9(doc)) {
        console.log(`[skip] ${target} — already macro v9`)
        continue
      }
      try {
        result = migrateMacroDb(doc)
      } catch (error) {
        console.error(`[error] cannot migrate ${target}: ${error instanceof Error ? error.message : String(error)}`)
        exitCode = 1
        continue
      }
      kind = 'macro v6/v7/v8→v9'
    }
  } else {
    console.error(`[error] cannot migrate ${target}: document must be a plain JSON object`)
    exitCode = 1
    continue
  }

  const outText = JSON.stringify(result, null, 2) + '\n'
  if (dryRun) {
    console.log(`[dry-run] ${kind}: would write ${target}`)
  } else {
    copyFileSync(target, `${target}.bak`)
    writeFileSync(target, outText, 'utf8')
    console.log(`[ok] ${kind}: backed up to ${target}.bak and wrote ${target}`)
  }
}

process.exit(exitCode)
