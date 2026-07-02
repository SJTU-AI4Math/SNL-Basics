// @ts-check
/**
 * Migrate macro-DB from v2 to v3 (SnlMacro 0.4.0 shape):
 *
 *   1. Strip the consumer-owned output fields that no longer belong in the
 *      render-only library: `typst`, `latex`, `markdown`, `text`. These moved
 *      to downstream extensions (SNL-Doc-Extension keeps them on-disk).
 *   2. Rename `katex_react.mode` value `'math'` → `'formula'` (math is a
 *      discipline, not a content form). `'text'` / `'block'` are untouched.
 *
 * Idempotent: a macro already in v3 shape (no output fields, mode already
 * 'formula') passes through unchanged.
 *
 * Usage:
 *   node scripts/migrate-macro-db-v3.mjs [--dry-run]
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

const DROPPED_FIELDS = ['typst', 'latex', 'markdown', 'text']

let totalChanged = 0
for (const dbPath of targets) {
  let raw
  try {
    raw = readFileSync(dbPath, 'utf8')
  } catch {
    console.warn(`[migrate-macro-db-v3] skip (missing): ${dbPath}`)
    continue
  }
  const db = JSON.parse(raw)
  let changed = 0
  for (const [name, macro] of Object.entries(db)) {
    if (!macro || typeof macro !== 'object') {
      continue
    }
    let touched = false

    for (const field of DROPPED_FIELDS) {
      if (field in macro) {
        delete macro[field]
        touched = true
      }
    }

    const kr = macro.katex_react
    if (kr && kr.mode === 'math') {
      kr.mode = 'formula'
      touched = true
    }

    if (touched) {
      changed++
      if (dryRun) {
        console.log(`--- ${name}: strip output fields${kr ? `, mode=${kr.mode}` : ''}`)
      }
    }
  }
  totalChanged += changed
  if (dryRun) {
    console.log(`[dry-run] ${dbPath}: ${changed} macro(s) would change`)
  } else {
    writeFileSync(dbPath, `${JSON.stringify(db, null, 2)}\n`, 'utf8')
    console.log(`[migrate-macro-db-v3] ${dbPath}: ${changed} macro(s) migrated`)
  }
}
if (dryRun) {
  console.log(`[dry-run] total: ${totalChanged} macro(s) would change`)
}
