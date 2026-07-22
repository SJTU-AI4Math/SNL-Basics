import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  publicDir: false,
  plugins: [react()],
  build: {
    lib: { entry: resolve(root, 'src/entry-react/index.ts'), fileName: 'entry', formats: ['es'] },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'katex',
        'react-markdown',
        'remark-gfm',
        'remark-math',
        'rehype-katex',
      ],
    },
    outDir: 'dist-lib',
    emptyOutDir: false,
  },
})
