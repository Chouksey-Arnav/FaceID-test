import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'robots.txt', 'models/**/*'],
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
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/(cdn\.jsdelivr\.net|unpkg\.com)\/face-api\.js/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'face-api-models',
              expiration: { maxEntries: 20, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 10, maxAgeSeconds: 365 * 24 * 60 * 60 },
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
    include: ['face-api.js'],
    esbuildOptions: {
      target: 'esnext',
    },
  },

  build: {
    target: 'esnext',

    commonjsOptions: {
      // ── THIS IS THE FIX — confirmed by running vite build locally ───────────
      //
      // The previous config had:  include: [/face-api/]
      // That only transformed face-api.js, leaving these CJS packages
      // untransformed, which caused Rollup to throw during the Vercel build:
      //
      //   "createContext" is not exported by node_modules/react/index.js
      //      framer-motion v11 does named ESM imports from React (CJS)
      //
      //   "default" is not exported by node_modules/dexie/dist/...
      //      Dexie v4's ESM wrapper imports from its own CJS default
      //
      //   "default" is not exported by node_modules/rgbcolor/index.js
      //      canvg (used inside jsPDF) does a default import from CJS rgbcolor
      //
      // Setting include:[/node_modules/] tells @rollup/plugin-commonjs to
      // transform ALL CJS files in node_modules. Pure-ESM files (.mjs) are
      // automatically skipped by the plugin regardless of this setting —
      // so framer-motion's own .mjs files are never touched.
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
