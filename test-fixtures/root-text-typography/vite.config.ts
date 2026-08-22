import { realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const fixture = dirname(fileURLToPath(import.meta.url))
const repository = resolve(fixture, '../..')

export default defineConfig({
  server: {
    fs: {
      // Worktrees share a dependency tree with the primary checkout. Allow
      // Vite to serve the real font files so the browser gate tests glyphs,
      // rather than silently comparing two generic-serif fallbacks.
      allow: [repository, realpathSync(resolve(repository, 'node_modules'))],
    },
  },
})
