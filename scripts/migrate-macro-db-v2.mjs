// @ts-check
/**
 * Migrate macro-DB templates from v1 (@CHILDn@ / @CHILDREN@ + hand-written
 * \htmlData wrappers) to v2 (LaTeX-native #N / #* placeholders, NO \htmlData).
 *
 * Per template string:
 *   1. Strip EVERY \htmlData{attr}{body} wrapper (outer + nested inner) via a
 *      balanced-brace parser, keeping just the body. The view layer re-adds a
 *      single auto-wrap at render time.
 *   2. @CHILDn@  → #n      (0-indexed children — DB is already 0-indexed)
 *   3. @CHILDREN@ → #*     (variadic children)
 *
 * Idempotent: templates already in v2 shape (no \htmlData, no @CHILD*) pass
 * through unchanged.
 *
 * Usage:
 *   node scripts/migrate-macro-db-v2.mjs [--dry-run]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const targets = [
  join(__dirname, '..', 'public', 'snl-macro-db.json'),
]

const dryRun = process.argv.includes('--dry-run')

/**
 * Read a balanced `{...}` group starting at index `i` (s[i] must be `{`).
 * Backslash escapes the following char so `\{` / `\}` don't unbalance.
 * @param {string} s
 * @param {number} i
 * @returns {{ content: string, end: number }}
 */
function readBraceGroup(s, i) {
  if (s[i] !== '{') {
    throw new Error(`expected '{' at ${i} in: ${s}`)
  }
  let depth = 0
  let j = i
  for (; j < s.length; j++) {
    const c = s[j]
    if (c === '\\') {
      j++ // skip escaped char
      continue
    }
    if (c === '{') {
      depth++
    } else if (c === '}') {
      depth--
      if (depth === 0) {
        j++
        break
      }
    }
  }
  if (depth !== 0) {
    throw new Error(`unbalanced braces from ${i} in: ${s}`)
  }
  return { content: s.slice(i + 1, j - 1), end: j }
}

const HTMLDATA = '\\htmlData'

/**
 * Recursively remove every \htmlData{attr}{body} wrapper, keeping bodies.
 * @param {string} s
 * @returns {string}
 */
function stripHtmlData(s) {
  let out = ''
  let i = 0
  while (i < s.length) {
    if (s.startsWith(HTMLDATA, i)) {
      i += HTMLDATA.length
      const attr = readBraceGroup(s, i)
      i = attr.end
      const body = readBraceGroup(s, i)
      i = body.end
      out += stripHtmlData(body.content) // drop attr, recurse into body
    } else {
      out += s[i]
      i++
    }
  }
  return out
}

/** @param {string} latex */
function transformTemplate(latex) {
  let out = stripHtmlData(latex)
  out = out.replace(/@CHILD(\d+)@/g, (_, n) => `#${Number(n)}`)
  out = out.replace(/@CHILDREN@/g, '#*')
  return out
}

let totalChanged = 0
for (const dbPath of targets) {
  let raw
  try {
    raw = readFileSync(dbPath, 'utf8')
  } catch {
    console.warn(`[migrate-macro-db-v2] skip (missing): ${dbPath}`)
    continue
  }
  const db = JSON.parse(raw)
  let changed = 0
  for (const [name, macro] of Object.entries(db)) {
    const kr = macro?.katex_react
    const template = kr?.template
    if (typeof template !== 'string' || template.length === 0) {
      continue
    }
    const next = transformTemplate(template)
    if (next !== template) {
      changed++
      if (dryRun) {
        console.log(`--- ${name}`)
        console.log(`  before: ${template}`)
        console.log(`  after:  ${next}`)
      }
      kr.template = next
    }
  }
  totalChanged += changed
  if (dryRun) {
    console.log(`[dry-run] ${dbPath}: ${changed} template(s) would change`)
  } else {
    writeFileSync(dbPath, `${JSON.stringify(db, null, 2)}\n`, 'utf8')
    console.log(`[migrate-macro-db-v2] ${dbPath}: ${changed} template(s) migrated`)
  }
}
if (dryRun) {
  console.log(`[dry-run] total: ${totalChanged} template(s) would change`)
}
