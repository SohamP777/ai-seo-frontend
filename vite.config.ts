// Your vite.config.ts MUST have:
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',           // ← Must be 'dist'
    emptyOutDir: true,
    rollupOptions: {
      input: '/index.html'    // ← Important for Vercel
    }
  }
})