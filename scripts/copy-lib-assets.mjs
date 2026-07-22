import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const entryTypes = join(root, 'dist-lib/entry-types')

function makeDeclarationsNodeNextCompatible(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      makeDeclarationsNodeNextCompatible(path)
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith('.d.ts')) continue
    const declaration = readFileSync(path, 'utf8')
    const nodeNextCompatible = declaration.replace(
      /(from\s+['"]|import\(['"])(\.[^'"]+?)(['"]\)?)/g,
      (match, prefix, specifier, suffix) => /\.(?:[cm]?js|json)$/.test(specifier)
        ? match
        : `${prefix}${specifier}.js${suffix}`,
    )
    writeFileSync(path, nodeNextCompatible)
  }
}

makeDeclarationsNodeNextCompatible(entryTypes)

mkdirSync(join(root, 'dist-lib'), { recursive: true })
copyFileSync(join(root, 'src/snl-react-view/style.css'), join(root, 'dist-lib/style.css'))
copyFileSync(join(root, 'src/entry-react/style.css'), join(root, 'dist-lib/entry.css'))
writeFileSync(join(root, 'dist-lib/entry.d.ts'), "export * from './entry-types/entry-react/index.js'\n")
copyFileSync(join(root, 'public/snl-macro-db.json'), join(root, 'dist-lib/snl-macro-db.json'))
rmSync(join(root, 'dist-lib/snl-macro-db-samples.json'), { force: true })
