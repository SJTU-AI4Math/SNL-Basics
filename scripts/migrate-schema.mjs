// @ts-check
/**
 * Unified migration script for SNL-Basics schema.
 * Applies:
 *   - Macro v6 → v7: tag→style_name, react_renderer_key→block_template_name,
 *     variadic_left/join/right → separator + template with #*, tags: []
 *   - Macro v7/v8/v9/v10 → v11: complete TemplateSpec localization and canonical const/sub kinds
 *   - Syntax tree v1/v2 → v3: temporary payload/coordinate separation
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
  if (Object.prototype.hasOwnProperty.call(style, 'separator')) {
    throw new Error('v6 extension field "separator" collides with the managed v7/v11 separator field')
  }
  const {
    variadic_left, variadic_join, variadic_right,
    tag: _tag, style_name: _styleName, mode: _mode, template: _template,
    react_renderer_key: _reactRendererKey, block_template_name: _blockTemplateName,
    tags: _tags, ...extensions
  } = style
  let template = style.template || ''
  const hasLegacyDynamicFields = variadic_left !== undefined || variadic_join !== undefined || variadic_right !== undefined
  if (hasLegacyDynamicFields) template = `${variadic_left ?? ''}#*${variadic_right ?? ''}`
  const blockTemplateName = style.react_renderer_key ?? style.block_template_name
  if (blockTemplateName && style.mode !== 'block') {
    throw new Error('block_template_name is valid only in block mode')
  }
  return {
    ...extensions,
    style_name: style.tag ?? style.style_name ?? 'default',
    mode: style.mode,
    template,
    ...(variadic_join !== undefined ? { separator: variadic_join } : {}),
    ...(style.mode === 'block' && blockTemplateName ? { block_template_name: blockTemplateName } : {}),
    tags: style.tags ?? [],
  }
}

function migrateMacroV6toV7(macro) {
  const { name, description, source, kind, dynamic_arity, tags, styles, ...extensions } = macro
  return {
    ...extensions,
    name,
    description,
    source,
    ...(kind !== undefined ? { kind } : {}),
    dynamic_arity,
    tags: tags ?? [],
    styles: (styles || []).map(migrateStyleV6toV7),
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

/** @param {Record<string, any>} db */
function isMacroDocumentV10(db) {
  return isMacroDocumentV9(db) && Object.values(db).every((macro) =>
    typeof macro.kind === 'string' && macro.kind.length > 0 && macro.kind !== 'partial'
  )
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

/** @param {any} macro */
function migrateMacroV9toV10(macro) {
  const { default_style: _legacyDefaultStyle, ...current } = macro
  return {
    ...current,
    kind: macro.kind === 'partial' || macro.kind === 'sub'
      ? 'sub'
      : typeof macro.kind === 'string' && macro.kind.length > 0 ? macro.kind : 'const',
  }
}

/** @param {string} template */
function analyzePlaceholders(template) {
  const source = template.replace(/\\#/g, '\u0001ESCAPED_HASH\u0001')
  let maxIndex = -1
  for (const match of source.matchAll(/#(\d{1,2})(?!\d)/g)) maxIndex = Math.max(maxIndex, Number(match[1]))
  return { positional_arity: maxIndex + 1, variadic: /#\*/.test(source), invalid: /#\d{3,}/.test(source) }
}

/** @param {any} style @param {string} body */
function directStyleTemplate(style, body) {
  const {
    style_name: _styleName, tags: _tags, mode: _mode, template: _template,
    separator: _separator, block_template_name: _blockTemplateName, ...extensions
  } = style
  for (const field of ['body', 'type']) {
    if (Object.prototype.hasOwnProperty.call(extensions, field)) {
      throw new Error(`style extension field ${JSON.stringify(field)} collides with schema v11 TemplateSpec`)
    }
  }
  return {
    ...extensions,
    mode: style.mode,
    body,
    ...(style.separator !== undefined ? { separator: style.separator } : {}),
    ...(style.mode === 'block' && style.block_template_name !== undefined
      ? { block_template_name: style.block_template_name } : {}),
  }
}

/** @param {any} style */
function migrateDirectStyleToV11(style) {
  const template = typeof style.template === 'string'
    ? directStyleTemplate(style, style.template)
    : {
        type: 'i18n',
        default_language: style.template.default_language,
        values: Object.fromEntries(Object.entries(style.template.values)
          .map(([language, body]) => [language, directStyleTemplate(style, body)])),
      }
  return { style_name: style.style_name, tags: [...style.tags], template }
}

/** @param {any} macro */
function migrateMacroV10toV11(macro) {
  return { ...macro, styles: macro.styles.map(migrateDirectStyleToV11) }
}

/** @param {any} macro */
function migrateMacroV8toV11(macro) {
  const normalized = migrateMacroV9toV10(macro)
  const firstName = macro.styles[0]?.style_name
  const mappedNames = Object.values(macro.default_style)
  if (firstName && mappedNames.every((name) => name === firstName)) return migrateMacroV10toV11(normalized)

  const byName = new Map(macro.styles.map((style) => [style.style_name, style]))
  const hasEnglishDefault = Object.prototype.hasOwnProperty.call(macro.default_style, 'en')
  const values = Object.create(null)
  const mappedStyles = []
  for (const [language, styleName] of Object.entries(macro.default_style)) {
    const style = byName.get(styleName)
    if (!style) throw new Error(`macro ${JSON.stringify(macro.name)} default_style references unknown style ${JSON.stringify(styleName)}`)
    values[language] = directStyleTemplate(style, style.template)
    mappedStyles.push(style)
  }
  if (!hasEnglishDefault) {
    const first = macro.styles[0]
    if (!first) throw new Error(`macro ${JSON.stringify(macro.name)} has no styles`)
    values.en = directStyleTemplate(first, first.template)
    mappedStyles.push(first)
  }
  if (new Set(mappedStyles.map((style) => JSON.stringify(style.tags))).size !== 1) {
    throw new Error(`macro ${JSON.stringify(macro.name)} has a legacy default_style map whose selected Style tags cannot be localized`)
  }
  const used = new Set(macro.styles.map((style) => style.style_name))
  const stem = `${firstName ?? 'default'}_localized_default`
  let style_name = stem
  let suffix = 2
  while (used.has(style_name)) style_name = `${stem}_${suffix++}`
  const lifted = migrateMacroV10toV11(normalized)
  return {
    ...lifted,
    styles: [{ style_name, tags: [...mappedStyles[0].tags], template: { type: 'i18n', default_language: 'en', values } }, ...lifted.styles],
  }
}

/** @param {any} value */
function isTemplateSpec(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || 'type' in value ||
      !MODES.has(value.mode) || typeof value.body !== 'string' ||
      (value.separator !== undefined && typeof value.separator !== 'string')) return false
  return value.block_template_name === undefined ||
    (value.mode === 'block' && typeof value.block_template_name === 'string')
}

const LOCALIZED_TEMPLATE_FIELDS = new Set(['type', 'default_language', 'values'])

/** @param {any} value @returns {any[] | null} */
function templateSpecs(value) {
  if (isTemplateSpec(value)) return [value]
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.type !== 'i18n' ||
      Object.keys(value).some((field) => !LOCALIZED_TEMPLATE_FIELDS.has(field)) ||
      typeof value.default_language !== 'string' || !value.values ||
      typeof value.values !== 'object' || Array.isArray(value.values) ||
      !Object.prototype.hasOwnProperty.call(value.values, value.default_language) ||
      Object.keys(value.values).length === 0 || !Object.values(value.values).every(isTemplateSpec)) return null
  return Object.values(value.values)
}

const CURRENT_STYLE_FIELDS = new Set(['style_name', 'tags', 'template'])

/** @param {Record<string, any>} db */
function isMacroDocumentV11(db) {
  return Object.values(db).every((macro) => {
    if (!isMacroBase(macro) || typeof macro.kind !== 'string' || macro.kind.length === 0 ||
        macro.kind === 'partial' || 'default_style' in macro || !Array.isArray(macro.styles) || macro.styles.length === 0) return false
    const names = []
    for (const style of macro.styles) {
      if (!style || typeof style !== 'object' || Array.isArray(style) ||
          typeof style.style_name !== 'string' || !isSnlIdentifier(style.style_name) ||
          !isStringArray(style.tags) || Object.keys(style).some((field) => !CURRENT_STYLE_FIELDS.has(field))) return false
      const specs = templateSpecs(style.template)
      if (!specs) return false
      const contracts = new Set(specs.map((spec) => {
        const analysis = analyzePlaceholders(spec.body)
        return `${analysis.variadic ? 'dynamic' : 'fixed'}:${analysis.positional_arity}`
      }))
      if (contracts.size !== 1 || specs.some((spec) => {
        const analysis = analyzePlaceholders(spec.body)
        return analysis.invalid || analysis.variadic !== macro.dynamic_arity
      })) return false
      names.push(style.style_name)
    }
    return new Set(names).size === names.length
  })
}

/** @param {Record<string, any>} db */
function migrateMacroDb(db) {
  const entries = []
  for (const [key, macro] of Object.entries(db)) {
    const one = { [key]: macro }
    let migrated
    if (isMacroDocumentV11(one)) migrated = macro
    else if (isMacroDocumentV10(one)) migrated = migrateMacroV10toV11(macro)
    else if (isMacroDocumentLegacyDefault(one)) migrated = migrateMacroV8toV11(macro)
    else if (isMacroDocumentV9(one) || isMacroDocumentV7(one)) {
      migrated = migrateMacroV10toV11(migrateMacroV9toV10(migrateMacroV7toV9(macro)))
    } else if (isMacroDocumentV6(one)) {
      migrated = migrateMacroV10toV11(migrateMacroV9toV10(migrateMacroV7toV9(migrateMacroV6toV7(macro))))
    } else throw new Error(`entry ${JSON.stringify(key)} is not valid v6–v11 data`)
    entries.push([key, migrated])
  }
  const result = Object.fromEntries(entries)
  if (!isMacroDocumentV11(result)) throw new Error('migrated macro document violates schema v11')
  return result
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

/** @param {number[]} path */
function treeCoordinate(path) {
  return path.length === 0 ? '#' : `#${path.join('.')}`
}

/** @param {any} node @param {number[]} [path] @returns {boolean} */
function isSyntaxTreeV3(node, path = []) {
  if (!isSyntaxTreeV2(node)) return false
  if (node.temporary_format !== undefined && node.temporary_format !== 'texttt') return false
  if (node.env_mode !== undefined) {
    if (!['formula_inline', 'formula_display', 'text', 'block'].includes(node.env_mode) ||
        typeof node.temporary_source !== 'string' || node.macro_name !== treeCoordinate(path)) return false
  } else if (node.temporary_source !== undefined || node.temporary_format !== undefined) {
    return false
  }
  const children = /** @type {any[]} */ (node.children)
  return children.every((child, index) => isSyntaxTreeV3(child, [...path, index]))
}

/** @param {any} node @param {number[]} [path] @returns {any} */
function migrateTreeV2toV3(node, path = []) {
  const { children: rawChildren, ...rest } = node
  const children = /** @type {any[]} */ (rawChildren)
  const temporary = node.env_mode !== undefined
  return {
    ...rest,
    macro_name: temporary ? treeCoordinate(path) : node.macro_name,
    ...(temporary ? { temporary_source: node.temporary_source ?? node.macro_name } : {}),
    children: children.map((child, index) => migrateTreeV2toV3(child, [...path, index])),
  }
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
      if (isSyntaxTreeV3(doc)) {
        console.log(`[skip] ${target} — already tree v3`)
        continue
      }
      const wasV2 = isSyntaxTreeV2(doc)
      const v2 = wasV2 ? doc : migrateTreeNode(doc)
      result = migrateTreeV2toV3(v2)
      kind = wasV2 ? 'tree v2→v3' : 'tree v1→v3'
    } else {
      // Macro DB
      if (isMacroDocumentV11(doc)) {
        console.log(`[skip] ${target} — already macro v11`)
        continue
      }
      try {
        result = migrateMacroDb(doc)
      } catch (error) {
        console.error(`[error] cannot migrate ${target}: ${error instanceof Error ? error.message : String(error)}`)
        exitCode = 1
        continue
      }
      kind = 'macro v6/v7/v8/v9/v10→v11'
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
