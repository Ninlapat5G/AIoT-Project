import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  define: {
    global: 'globalThis',
  },
  optimizeDeps: {
    include: ['mqtt'],
    esbuildOptions: {
      define: { global: 'globalThis' },
    },
  },
})
