// @ts-check
/**
 * Migrate macro-DB from v3 to v4 (SnlMacro 0.6.0 — styles system):
 *
 *   v3 shape (one macro per style, render fields nested under `katex_react`):
 *     "Mul.mul.infix":    { name, description, source, katex_react: { arity, mode, template, kind } }
 *     "Mul.mul.implicit": { name, description, source, katex_react: { arity, mode, template, kind } }
 *
 *   v4 shape (grouped by base name, render styles keyed by the dotted suffix):
 *     "Mul.mul": {
 *       name, description, source,
 *       kind, arity, mode, display?,        // lifted out of katex_react
 *       defaultStyle: "implicit",
 *       styles: {
 *         "implicit": { template, variadic_join?, react_renderer_key? },
 *         "infix":    { template, variadic_join?, react_renderer_key? }
 *       }
 *     }
 *
 * Grouping rule: split the macro name on '.'. If there is more than one
 * segment, the LAST segment is the style tag and the rest is the base name.
 * Macros that appear only once and whose "base" would collide with a known
 * multi-segment macro (e.g. `FOL.forall.typed`) are preserved as-is via the
 * BASE_NAME_OVERRIDES map — the dotted suffix there is part of the identity,
 * not a style. Single-segment names (pmatrix, matrix.row) get a synthetic
 * `default` style tag.
 *
 * `defaultStyle` is taken from DEFAULT_STYLE_OVERRIDES when present, else the
 * first style tag encountered for that base name.
 *
 * This is a one-shot for the bundled 20-macro DB — not a general migrator.
 *
 * Usage:
 *   node scripts/migrate-macro-db-v4.mjs [--dry-run]
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

// Macros whose full dotted name (minus the FINAL style suffix) is itself a
// meaningful identity — the trailing `.typed` etc. is part of the base name,
// not a style tag. Maps v3 name → { base, style }.
const BASE_NAME_OVERRIDES = {
  'FOL.forall.binder': { base: 'FOL.forall', style: 'binder' },
  'FOL.forall.binderTyped': { base: 'FOL.forall.typed', style: 'binder' },
  'FOL.exists.binder': { base: 'FOL.exists', style: 'binder' },
  'FOL.exists.binderTyped': { base: 'FOL.exists.typed', style: 'binder' },
  // Sample block macros keep their full dotted name as identity; the trailing
  // segment is NOT a style tag — each gets a synthetic `default` style.
  'sample.list': { base: 'sample.list', style: 'default' },
  'sample.table': { base: 'sample.table', style: 'default' },
  'sample.centered': { base: 'sample.centered', style: 'default' },
  'sample.displayFrac': { base: 'sample.displayFrac', style: 'default' },
  // matrix.row is its own macro (the dotted `.row` is identity, not a style).
  'matrix.row': { base: 'matrix.row', style: 'default' },
}

// Base name → arity override (the R6 table pins FOL.app as variadic even though
// its v3 entry was `fixed`; all other macros keep their v3 arity).
const ARITY_OVERRIDES = {
  'FOL.app': 'variadic',
}

// Base name → the style tag to use when SNL source omits `[style]`.
const DEFAULT_STYLE_OVERRIDES = {
  'DivRing.div': 'frac',
  'Mul.mul': 'implicit',
  'FOL.implies': 'infix',
}

/** Split a v3 macro name into { base, style }. */
function splitName(name) {
  if (BASE_NAME_OVERRIDES[name]) {
    return BASE_NAME_OVERRIDES[name]
  }
  const dot = name.lastIndexOf('.')
  if (dot === -1) {
    // Single-segment name (pmatrix, sample.list already has a dot though).
    return { base: name, style: 'default' }
  }
  return { base: name.slice(0, dot), style: name.slice(dot + 1) }
}

/** True if the DB is already in v4 shape (has `styles`, no `katex_react`). */
function isV4(db) {
  return Object.values(db).every(
    (m) => m && typeof m === 'object' && 'styles' in m && !('katex_react' in m),
  )
}

function migrateDb(db) {
  /** @type {Record<string, any>} */
  const out = {}
  for (const [name, macro] of Object.entries(db)) {
    if (!macro || typeof macro !== 'object') continue
    const kr = macro.katex_react ?? {}
    const { base, style } = splitName(name)

    if (!out[base]) {
      out[base] = {
        name: base,
        description: macro.description ?? '',
        source: macro.source ?? { entries: [], urls: [] },
        ...(kr.kind !== undefined ? { kind: kr.kind } : {}),
        arity: ARITY_OVERRIDES[base] ?? kr.arity ?? 'fixed',
        mode: kr.mode ?? 'formula',
        ...(kr.display !== undefined ? { display: kr.display } : {}),
        defaultStyle: DEFAULT_STYLE_OVERRIDES[base] ?? style,
        styles: {},
      }
    }

    /** @type {Record<string, unknown>} */
    const styleEntry = { template: kr.template ?? '' }
    if (kr.variadic_join !== undefined) styleEntry.variadic_join = kr.variadic_join
    if (kr.react_renderer_key !== undefined)
      styleEntry.react_renderer_key = kr.react_renderer_key
    out[base].styles[style] = styleEntry
  }

  // Safety: ensure every defaultStyle is a real key in styles.
  for (const macro of Object.values(out)) {
    if (!macro.styles[macro.defaultStyle]) {
      const first = Object.keys(macro.styles)[0]
      console.warn(
        `[migrate-macro-db-v4] ${macro.name}: defaultStyle "${macro.defaultStyle}" ` +
          `not in styles; falling back to "${first}"`,
      )
      macro.defaultStyle = first
    }
  }
  return out
}

let totalChanged = 0
for (const dbPath of targets) {
  let raw
  try {
    raw = readFileSync(dbPath, 'utf8')
  } catch {
    console.warn(`[migrate-macro-db-v4] skip (missing): ${dbPath}`)
    continue
  }
  const db = JSON.parse(raw)
  const migrated = isV4(db) ? db : migrateDb(db)
  const before = Object.keys(db).length
  const after = Object.keys(migrated).length
  totalChanged += 1
  if (dryRun) {
    const note = isV4(db) ? 'already v4 (normalize formatting)' : `${before} → ${after} grouped`
    console.log(`[dry-run] ${dbPath}: ${note}`)
    console.log(Object.keys(migrated).join(', '))
  } else {
    writeFileSync(dbPath, `${JSON.stringify(migrated, null, 2)}\n`, 'utf8')
    const note = isV4(db)
      ? `already v4, re-serialized (${after} macro(s))`
      : `${before} → ${after} macro(s) migrated`
    console.log(`[migrate-macro-db-v4] ${dbPath}: ${note}`)
  }
}
if (dryRun) {
  console.log(`[dry-run] total: ${totalChanged} file(s) would change`)
}
