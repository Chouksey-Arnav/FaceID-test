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
            id.inclimport { defineConfig } from 'vite';
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
        // face-api UMD bundle is ~6.7 MB uncompressed — raise the limit
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

  resolve: {
    alias: {
      // ── FIX #1 ───────────────────────────────────────────────────────────────
      // Force Vite to use face-api.js's self-contained UMD build instead of its
      // ESM build. The ESM build imports @tensorflow/tfjs-core, -converter, and
      // -backend-webgl as separate packages, causing Vite to try to pre-bundle
      // them independently — resulting in duplicate TF.js instances and
      // "is not a function" crashes at runtime.
      //
      // The UMD build (dist/face-api.js) bundles TF.js internally, so Vite never
      // needs to separately resolve the @tensorflow sub-packages. This makes the
      // build deterministic and removes the double-bundle issue entirely.
      'face-api.js': 'face-api.js/dist/face-api.js',
    },
  },

  // ── FIX #2 ─────────────────────────────────────────────────────────────────
  // Only list face-api.js here. The @tensorflow sub-packages are now bundled
  // inside the UMD build above and should NOT be listed as separate optimized
  // deps — doing so caused esbuild to pre-bundle them and then Rollup to bundle
  // them a second time via face-api's internal imports.
  optimizeDeps: {
    include: ['face-api.js'],
    esbuildOptions: {
      // face-api UMD uses some modern JS patterns
      target: 'esnext',
    },
  },

  build: {
    target: 'esnext',

    commonjsOptions: {
      // ── FIX #3 ─────────────────────────────────────────────────────────────
      // The previous config had [/face-api\.js/, /node_modules/].
      //
      // The /node_modules/ regex told @rollup/plugin-commonjs to CJS-transform
      // EVERY package in node_modules. This is destructive:
      //   • framer-motion v11 is pure ESM and breaks when CJS-transformed
      //   • chart.js and other ESM packages have circular-dep issues under CJS
      //   • It adds enormous overhead → Vercel build timeout
      //
      // The correct scope is face-api.js only (the UMD build is CJS format).
      include: [/face-api/],
      transformMixedEsModules: true,
    },

    rollupOptions: {
      output: {
        manualChunks(id) {
          // face-api UMD bundle gets its own chunk so the main app bundle stays lean.
          // @tensorflow is no longer a separate import (it's inside the UMD), so
          // the old `id.includes('@tensorflow')` check is removed.
          if (id.includes('face-api')) {
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
});udes('chart.js') ||
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
