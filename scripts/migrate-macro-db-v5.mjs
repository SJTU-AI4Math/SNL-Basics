// @ts-check
/**
 * Migrate macro-DB from v4 to v5 (SnlMacro 0.7.0 — mode/display per style,
 * styles as ordered array).
 *
 *   v4 shape:
 *     "Add.add": {
 *       name, description, source, kind, arity,
 *       mode: "formula",              // macro-level
 *       display?: "inline"|"block",   // macro-level (formula only)
 *       defaultStyle: "infix",
 *       styles: {
 *         "infix": { template, variadic_join?, react_renderer_key? }
 *       }
 *     }
 *
 *   v5 shape:
 *     "Add.add": {
 *       name, description, source, kind, arity,
 *       styles: [
 *         { tag: "infix", mode: "formula", display?: "inline"|"block",
 *           template, variadic_join?, react_renderer_key? }
 *       ]
 *     }
 *
 * Rules:
 *  - `styles` becomes an ordered array. `defaultStyle` (v4) determines which
 *    element is placed FIRST — v5 treats `styles[0]` as the implicit default.
 *    Remaining styles keep their v4 insertion order.
 *  - Every style inherits the macro's v4 `mode` (formula/text/block) and,
 *    when applicable, `display`. Migration alone can't distinguish styles
 *    that "should" have different modes — authors edit later.
 *  - Top-level `mode`, `display`, and `defaultStyle` are removed.
 *
 * Idempotent: if a DB is already in v5 shape (styles is an array), we skip it.
 *
 * Usage:
 *   node scripts/migrate-macro-db-v5.mjs [--dry-run]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const targets = [
  join(__dirname, '..', 'public', 'snl-macro-db.json'),
  join(__dirname, '..', 'public', 'snl-macro-db-samples.json'),
]

const dryRun = process.argv.includes('--dry-run')

/** True if every macro in db already has `styles` as an array (v5). */
function isV5(db) {
  return Object.values(db).every(
    (m) => m && typeof m === 'object' && Array.isArray(m.styles),
  )
}

/** Migrate one v4 macro to v5. */
function migrateMacro(macro) {
  const {
    mode: macroMode = 'formula',
    display: macroDisplay,
    defaultStyle,
    styles: stylesMap = {},
    ...rest
  } = macro

  const tags = Object.keys(stylesMap)
  // Order: defaultStyle first, then the rest in insertion order.
  const orderedTags = []
  if (defaultStyle && tags.includes(defaultStyle)) {
    orderedTags.push(defaultStyle)
  }
  for (const t of tags) {
    if (!orderedTags.includes(t)) orderedTags.push(t)
  }

  const styles = orderedTags.map((tag) => {
    const raw = stylesMap[tag] ?? {}
    /** @type {Record<string, unknown>} */
    const s = {
      tag,
      mode: macroMode,
      template: typeof raw.template === 'string' ? raw.template : '',
    }
    if (macroMode === 'formula' && macroDisplay) {
      s.display = macroDisplay
    }
    if (raw.variadic_join !== undefined) s.variadic_join = raw.variadic_join
    if (raw.react_renderer_key !== undefined) {
      s.react_renderer_key = raw.react_renderer_key
    }
    return s
  })

  return { ...rest, styles }
}

function migrateDb(db) {
  /** @type {Record<string, any>} */
  const out = {}
  for (const [name, macro] of Object.entries(db)) {
    if (!macro || typeof macro !== 'object') continue
    out[name] = migrateMacro(macro)
  }
  return out
}

for (const target of targets) {
  const raw = readFileSync(target, 'utf8')
  const db = JSON.parse(raw)
  if (isV5(db)) {
    console.log(`[skip] ${target} already in v5 shape`)
    continue
  }
  const next = migrateDb(db)
  const outText = JSON.stringify(next, null, 2) + '\n'
  if (dryRun) {
    console.log(`[dry-run] would write ${target}`)
  } else {
    writeFileSync(target, outText, 'utf8')
    console.log(`[ok] wrote ${target}`)
  }
}
