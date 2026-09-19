import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// BASE_PATH lets the same build be hosted under a sub-path (GitHub Pages).
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*', 'tessdata/*', 'vendor/**/*'],
      manifest: {
        name: 'V-Flat Scanner',
        short_name: 'V-Flat',
        description: '책을 바닥에 두고 카메라를 대면 자동으로 페이지를 펴고 글자를 인식합니다.',
        lang: 'ko',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b0f14',
        theme_color: '#0b0f14',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // OpenCV.js alone is ~13 MB; precache everything so the app is fully
        // usable with no network after the first visit.
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,gz}'],
        navigateFallback: `${base}index.html`,
      },
    }),
  ],
});
