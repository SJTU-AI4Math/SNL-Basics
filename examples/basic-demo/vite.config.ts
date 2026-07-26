import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // Required for any library exporting React components: keep exactly one React copy.
  resolve: { dedupe: ['react', 'react-dom', 'react/jsx-runtime'] },
})
