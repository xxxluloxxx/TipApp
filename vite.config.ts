import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    tailwindcss(),
    VitePWA({
      // Estrategia injectManifest: el SW se escribe a mano en `src/sw.ts`
      // (Vite lo compila con esbuild e inyecta el precache en
      // `self.__WB_MANIFEST`). Se migró desde generateSW porque Web Push
      // (live-matches-ux.md sección 6) necesita listeners propios de `push`/
      // `notificationclick` que generateSW no permite agregar. El precache y
      // el auto-update que ya funcionaban en producción se preservan dentro
      // de `src/sw.ts` (ver comentario ahí).
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      // El registro corre a mano desde App.vue vía `virtual:pwa-register/vue`
      // (useRegisterSW), para poder forzar la recarga automática apenas hay
      // una versión nueva — el script auto-inyectado por defecto solo llama a
      // `register()` sin esa lógica, y la app instalada se quedaba con el JS
      // viejo en memoria hasta que el usuario la cerraba a mano.
      injectRegister: false,
      // No se agrega runtimeCaching para el dominio de Supabase: REST/Auth
      // siempre deben ir a la red, nunca servirse desde cache. globPatterns
      // solo precachea el build estático de Vite (JS/CSS/HTML/fuentes).
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
      },
      manifest: {
        name: 'TipApp',
        short_name: 'TipApp',
        description: 'Control de gastos personales',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
