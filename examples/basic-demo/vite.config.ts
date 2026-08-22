import react from '@vitejs/plugin-react'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, searchForWorkspaceRoot } from 'vite'

const demoRoot = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(demoRoot, '../..')

export default defineConfig({
  plugins: [react()],
  // Required for any library exporting React components: keep exactly one React copy.
  resolve: { dedupe: ['react', 'react-dom', 'react/jsx-runtime'] },
  // The linked package's built CSS resolves its bundled font files from dist-lib/.
  server: { fs: { allow: [searchForWorkspaceRoot(demoRoot), packageRoot] } },
})
