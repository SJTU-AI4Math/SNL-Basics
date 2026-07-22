// @ts-check
/**
 * Unified migration script for SNL-Basics schema.
 * Applies:
 *   - Macro v6 → v7: tag→style_name, react_renderer_key→block_template_name,
 *     variadic_left/join/right → separator + template with #*, tags: []
 *   - Syntax tree v1 → v2: name→macro_name, style→style_name, envMode→env_mode
 *
 * NOTE: SnlMacro.name stays as `name` (NOT renamed to macro_name).
 *
 * Usage:
 *   node scripts/migrate-schema.mjs [--write] [--target <path>...]
 *
 * Without --target, migrates default bundled files.
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const write = process.argv.includes('--write')
const dryRun = !write

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/migrate-schema.mjs [--write] [--target <path>...]')
  console.log('Default is dry-run. --write creates <path>.bak before overwriting.')
  process.exit(0)
}

const defaultTargets = [
  join(__dirname, '..', 'public', 'snl-macro-db.json'),
]

const targetIdx = process.argv.indexOf('--target')
const targets = targetIdx >= 0
  ? process.argv.slice(targetIdx + 1).filter(a => !a.startsWith('--'))
  : defaultTargets

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

function isMacroDocumentV7(db) {
  for (const macro of Object.values(db)) {
    if (!macro || typeof macro !== 'object') continue
    if (!('name' in macro)) return false
    if (!Array.isArray(macro.tags)) return false
    const styles = macro.styles
    if (!Array.isArray(styles) || styles.length === 0) return false
    for (const s of styles) {
      if (typeof s.style_name !== 'string' || !Array.isArray(s.tags)) return false
      if ('tag' in s || 'variadic_left' in s || 'variadic_join' in s || 'variadic_right' in s) return false
    }
  }
  return true
}

function migrateMacroDb(db) {
  const out = {}
  for (const [key, macro] of Object.entries(db)) {
    if (!macro || typeof macro !== 'object') continue
    out[key] = migrateMacroV6toV7(macro)
  }
  return out
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

function isSyntaxTreeV2(node) {
  if (!node || typeof node !== 'object' || !('macro_name' in node) || 'name' in node) return false
  return !Array.isArray(node.children) || node.children.every(isSyntaxTreeV2)
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
    if ('children' in doc && ('name' in doc || 'macro_name' in doc)) {
      // Syntax tree
      if (isSyntaxTreeV2(doc)) {
        console.log(`[skip] ${target} — already tree v2`)
        continue
      }
      result = migrateTreeNode(doc)
      kind = 'tree v1→v2'
    } else {
      // Macro DB
      if (isMacroDocumentV7(doc)) {
        console.log(`[skip] ${target} — already macro v7`)
        continue
      }
      result = migrateMacroDb(doc)
      kind = 'macro v6→v7'
    }
  } else {
    console.log(`[skip] ${target} — unrecognized format`)
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
