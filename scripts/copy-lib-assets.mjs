import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
mkdirSync(join(root, 'dist-lib'), { recursive: true })
copyFileSync(join(root, 'src/operator-katex/style.css'), join(root, 'dist-lib/style.css'))
copyFileSync(join(root, 'public/katex-template-db.json'), join(root, 'dist-lib/katex-template-db.json'))
