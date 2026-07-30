import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

/**
 * Standalone build of the Reader runtime.
 *
 * The runtime is pure data plumbing (`read_localized`, `ReaderRuntime`) with no
 * imports of its own, but it used to be reachable only through the package
 * barrel — which also exports the React views, and through them KaTeX. Every
 * panel that merely wanted to localize a button label therefore pulled the
 * whole math engine into its bundle. Cat 2026-07-25: "各个 Panel 开起来都非常慢".
 */
export default defineConfig({
  publicDir: false,
  build: {
    lib: {
      entry: {
        runtime: resolve(root, 'src/runtime/index.ts'),
        core: resolve(root, 'src/core/index.ts'),
        // DOM-only hover highlighting. Same motivation as the two above: the
        // policy is reachable through the barrel, but the barrel also exports
        // the React views and with them KaTeX, so a consumer that only wants
        // hover over already-rendered markup would ship the whole math engine.
        hover: resolve(root, 'src/hover/index.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'katex'],
    },
    outDir: 'dist-lib',
    emptyOutDir: false,
  },
})
