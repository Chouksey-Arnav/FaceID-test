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
      // Force the self-contained UMD build of face-api.js.
      // The ESM build pulls in @tensorflow sub-packages as separate peer deps,
      // causing Vite to double-bundle TF.js and produce runtime crashes.
      // The UMD build ships TF.js internally — no separate @tensorflow resolution needed.
      'face-api.js': 'face-api.js/dist/face-api.js',
    },
  },

  optimizeDeps: {
    // Only face-api.js — NOT the @tensorflow sub-packages.
    // Those are already inside the UMD build above. Listing them separately
    // causes esbuild to pre-bundle them AND Rollup to bundle them again → duplicates.
    include: ['face-api.js'],
    esbuildOptions: {
      target: 'esnext',
    },
  },

  build: {
    target: 'esnext',

    commonjsOptions: {
      // Scope CJS transformation to face-api only.
      // The previous /node_modules/ regex transformed every package,
      // breaking framer-motion v11 (pure ESM) and causing Vercel build timeouts.
      include: [/face-api/],
      transformMixedEsModules: true,
    },

    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('face-api')) return 'face-api';
          if (id.includes('framer-motion')) return 'framer-motion';
          if (
            id.includes('react') ||
            id.includes('react-dom') ||
            id.includes('react-hot-toast')
          ) return 'react-vendor';
          if (id.includes('chart.js') || id.includes('react-chartjs-2')) return 'charts';
          if (id.includes('dexie')) return 'dexie';
        },
      },
    },
  },
});
