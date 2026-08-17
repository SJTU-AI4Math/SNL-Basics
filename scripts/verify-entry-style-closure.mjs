import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'src/entry-react/style.css'), 'utf8')
const publicCss = readFileSync(join(root, 'dist-lib/entry.css'), 'utf8')
const harness = readFileSync(join(root, 'test-fixtures/entry-narrow/main.tsx'), 'utf8')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

if (source !== publicCss) {
  throw new Error('public Entry stylesheet is not a byte-for-byte copy of src/entry-react/style.css')
}
if (pkg.exports?.['./entry/style.css']?.default !== './dist-lib/entry.css') {
  throw new Error('entry/style.css does not export dist-lib/entry.css')
}

const requiredRules = [
  /\[data-entry-body\] \.snl-text\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*word-break:\s*break-word/s,
  /\[data-entry-body\] \.snl-text \.snl-math-span\s*\{[^}]*overflow-wrap:\s*normal[^}]*word-break:\s*normal/s,
  /\[data-entry-body\] \.snl-text \.katex\s*\{[^}]*overflow-wrap:\s*normal[^}]*word-break:\s*normal/s,
  /\[data-entry-body\] \.snl-text pre\s*\{[^}]*overflow-wrap:\s*normal[^}]*word-break:\s*normal/s,
  /\[data-entry-body\] \.snl-text code\s*\{[^}]*overflow-wrap:\s*normal[^}]*word-break:\s*normal/s,
  /\[data-entry-body\] \.katex-panel\s*\{[^}]*overflow-x:\s*auto/s,
  /\[data-entry-body\] \.katex-panel \.katex\s*\{[^}]*overflow-wrap:\s*normal[^}]*word-break:\s*normal/s,
]
for (const required of requiredRules) {
  if (!required.test(publicCss)) throw new Error(`public Entry stylesheet is missing ${required}`)
}
if (!harness.includes("import '../../dist-lib/entry.css'") || harness.includes('snl-react-view/style.css')) {
  throw new Error('Entry geometry harness is not isolated to the public Entry stylesheet')
}

console.log('public Entry stylesheet closure verified')
