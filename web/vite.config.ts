import preact from '@preact/preset-vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// GitHub Pages serves the site under /<repo>/ ; CI sets VITE_BASE=/mo-hunt-stats/
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [preact(), tailwindcss()],
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules/uplot') ? 'uplot' : undefined),
      },
    },
  },
})
