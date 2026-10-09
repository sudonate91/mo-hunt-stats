import preact from '@preact/preset-vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves the site under /<repo>/ ; CI sets VITE_BASE=/mo-hunt-stats/
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    preact(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // registered in main.tsx via virtual:pwa-register (drives UpdateToast)
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'MO Hunt Stats',
        short_name: 'MO Hunt',
        description: 'Missouri deer and turkey harvest by county. Data: Missouri Department of Conservation.',
        theme_color: '#121212',
        background_color: '#121212',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // App shell only; data JSON is runtime-cached so a data refresh never needs a new SW.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        globIgnores: ['data/**'],
        // Navigations are served from the precached index.html (so a stale HTML never points at deleted hashed
        // assets); every filter URL maps to the same shell because all query params are ignored.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/data\//, /\/assets\//],
        ignoreURLParametersMatching: [/.*/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/data\/[^/]+\.json$/.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'data',
              expiration: { maxEntries: 16 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
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
