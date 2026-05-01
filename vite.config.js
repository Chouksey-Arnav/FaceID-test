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
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      workbox: {
        // face-api model weights can be large — raise the limit
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm}'],
        runtimeCaching: [
          {
            // Cache face-api model weights from CDN
            urlPattern: /^https:\/\/(cdn\.jsdelivr\.net|unpkg\.com)\/face-api\.js/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'face-api-models',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
              },
            },
          },
          {
            // Cache Google Fonts
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

  // ── face-api.js is a CommonJS / mixed-ESM package —————————————————————————
  // Without this, esbuild errors during `vite build` on Vercel.
  optimizeDeps: {
    include: [
      'face-api.js',
      // Pull in the TF.js sub-packages explicitly so esbuild pre-bundles them
      '@tensorflow/tfjs-core',
      '@tensorflow/tfjs-converter',
      '@tensorflow/tfjs-backend-webgl',
    ],
    esbuildOptions: {
      // face-api uses top-level await patterns in newer TF builds
      target: 'esnext',
    },
  },

  build: {
    target: 'esnext',

    commonjsOptions: {
      // Transform every CJS module inside node_modules, including face-api.js
      include: [/face-api\.js/, /node_modules/],
      transformMixedEsModules: true,
    },

    rollupOptions: {
      output: {
        // Separate face-api.js into its own chunk so the main bundle stays lean
        manualChunks(id) {
          if (id.includes('face-api.js') || id.includes('@tensorflow')) {
            return 'face-api';
          }
          if (id.includes('framer-motion')) {
            return 'framer-motion';
          }
          if (
            id.includes('react') ||
            id.includes('react-dom') ||
            id.includes('react-hot-toast')
          ) {
            return 'react-vendor';
          }
          if (
            id.includes('chart.js') ||
            id.includes('react-chartjs-2')
          ) {
            return 'charts';
          }
          if (id.includes('dexie')) {
            return 'dexie';
          }
        },
      },
    },
  },

  // Silence the "use client" directive warning from framer-motion
  resolve: {
    alias: {},
  },
});
