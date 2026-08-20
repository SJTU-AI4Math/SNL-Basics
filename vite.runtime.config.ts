import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

/**
 * One multi-entry ESM graph for every public JavaScript entry point.
 *
 * Keeping these entries in one Rollup graph preserves runtime identity for
 * classes and functions exported through both the root and lean subpaths,
 * while code splitting still lets `./runtime` and `./hover` avoid loading the
 * React/KaTeX entry chunks.
 */
export default defineConfig({
  publicDir: false,
  plugins: [react()],
  build: {
    lib: {
      entry: {
        index: resolve(root, 'src/snl-react-view/index.ts'),
        entry: resolve(root, 'src/entry-react/index.ts'),
        runtime: resolve(root, 'src/runtime/index.ts'),
        core: resolve(root, 'src/core/index.ts'),
        hover: resolve(root, 'src/hover/index.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'katex',
        'react-markdown',
        'rehype-highlight',
        'lowlight',
        'remark-gfm',
        'remark-math',
        'rehype-katex',
      ],
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
    outDir: 'dist-lib',
    emptyOutDir: false,
  },
})
