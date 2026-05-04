import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'robots.txt'],
      manifest: {
        name: 'MedSchoolPrep',
        short_name: 'MedPrep',
        description: 'AI-powered MCAT preparation and medical school admissions coaching',
        theme_color: '#04060b',
        background_color: '#04060b',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // face-api model weights are ~6 MB — raise the cache size limit
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/(cdn\.jsdelivr\.net|unpkg\.com)\/face-api\.js/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'face-api-models',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 365 * 24 * 60 * 60,
              },
            },
          },
        ],
      },
    }),
  ],

  resolve: {
    alias: {
      // Use the self-contained UMD bundle of face-api.js.
      // The default ESM entry pulls in @tensorflow sub-packages separately,
      // causing double-bundling and runtime crashes. The UMD build ships
      // TF.js internally and avoids all of that.
      'face-api.js': 'face-api.js/dist/face-api.js',
    },
  },

  optimizeDeps: {
    // Pre-bundle face-api.js via esbuild in dev mode.
    // Everything else is handled by commonjsOptions during production build.
    include: ['face-api.js'],
    esbuildOptions: {
      target: 'esnext',
    },
  },

  build: {
    target: 'esnext',

    commonjsOptions: {
      // ── THE CRITICAL FIX (confirmed by live build test) ────────────────────
      // Multiple packages ship CJS (.js) files that use module.exports, while
      // ESM consumers try to do named imports from them. Without this,
      // Rollup throws "X is not exported by Y" for:
      //
      //   react / react-dom  → framer-motion named-imports createContext etc.
      //   dexie              → dexie/import-wrapper-prod.mjs default import
      //   rgbcolor           → canvg (used internally by jsPDF) default import
      //   face-api.js UMD    → TF.js internal requires
      //
      // Applying include:[/node_modules/] is safe — pure ESM files (.mjs)
      // are automatically skipped by @rollup/plugin-commonjs.
      include: [/node_modules/],
      transformMixedEsModules: true,
    },

    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('face-api')) return 'face-api';
          if (id.includes('framer-motion')) return 'framer-motion';
          if (
            id.includes('node_modules/react') ||
            id.includes('react-hot-toast')
          ) return 'react-vendor';
          if (
            id.includes('chart.js') ||
            id.includes('react-chartjs-2')
          ) return 'charts';
          if (id.includes('dexie')) return 'dexie';
        },
      },
    },
  },
});
