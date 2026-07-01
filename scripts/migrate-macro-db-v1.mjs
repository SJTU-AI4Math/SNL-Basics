// @ts-check
/**
 * Migrate public/snl-macro-db.json from the old nested
 *   { name: { description, styles: { styleKey: { latex, childCount, kind, description } } } }
 * shape to the flat SnlMacro v1 schema
 *   { "name.styleKey": SnlMacro }.
 *
 * Transforms applied to each template:
 *   - flatten (name, styleKey) -> "name.styleKey"
 *   - drop the ",style=@STYLE@" fragment from \htmlData attr lists
 *   - re-index placeholders: @CHILD1@ -> @CHILD0@, @CHILDn@ -> @CHILD<n-1>@
 *
 * Idempotent: if the input already looks v1 (entries carry katex_react),
 * it no-ops with a warning.
 *
 * Usage: npm run migrate-db-v1
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dbPath = join(__dirname, '..', 'public', 'snl-macro-db.json')

/** Drop `,style=@STYLE@` fragments and 0-index @CHILDn@ placeholders. */
function transformTemplate(latex) {
  let out = latex.replace(/,style=@STYLE@/g, '')
  out = out.replace(/@CHILD(\d+)@/g, (_, n) => `@CHILD${Number(n) - 1}@`)
  return out
}

function migrate(oldDb) {
  /** @type {Record<string, any>} */
  const next = {}
  for (const [oldName, entry] of Object.entries(oldDb)) {
    const topDescription = entry?.description ?? ''
    const styles = entry?.styles ?? {}
    for (const [styleKey, rec] of Object.entries(styles)) {
      const name = `${oldName}.${styleKey}`
      const description = [topDescription, rec?.description]
        .filter((s) => s && String(s).length > 0)
        .join(' — ')
      next[name] = {
        name,
        description,
        source: { entries: [], urls: [] },
        typst: {
          built_in: '',
          synthesis: { output_type: 'formula', macro: '' },
        },
        latex: {
          built_in: '',
          synthesis: { output_type: 'formula', macro: '' },
        },
        markdown: '',
        text: '',
        katex_react: {
          arity: 'fixed',
          mode: 'math',
          template: transformTemplate(String(rec?.latex ?? '')),
        },
      }
    }
  }
  return next
}

function looksV1(db) {
  const values = Object.values(db)
  return values.length > 0 && values.every((v) => v && typeof v === 'object' && 'katex_react' in v)
}

const raw = readFileSync(dbPath, 'utf8')
const db = JSON.parse(raw)

if (looksV1(db)) {
  console.warn('[migrate-macro-db-v1] input already looks v1 (has katex_react) — no-op.')
  process.exit(0)
}

const migrated = migrate(db)
writeFileSync(dbPath, `${JSON.stringify(migrated, null, 2)}\n`, 'utf8')
console.log(
  `[migrate-macro-db-v1] migrated ${Object.keys(db).length} top entries -> ${Object.keys(migrated).length} flat macros.`,
)
