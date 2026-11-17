/// <reference lib="webworker" />
// Service worker custom (estrategia `injectManifest` de vite-plugin-pwa).
// -----------------------------------------------------------------------------
// Se usa injectManifest (SW propio) en vez de generateSW: Vite compila este
// archivo con esbuild e inyecta el manifiesto de precache en
// `self.__WB_MANIFEST`. Antes alojaba los listeners de Web Push de "Partidos
// en vivo" (feature eliminada el 2026-11-17).
//
// Se preserva el comportamiento de auto-update/precache que ya funcionaba en
// producción con generateSW+autoUpdate: `precacheAndRoute(self.__WB_MANIFEST)`
// precachea el mismo build estático de Vite, y `self.skipWaiting()` +
// `clientsClaim()` replican la activación inmediata que generateSW aplicaba
// por defecto con `registerType: 'autoUpdate'`, de modo que `useRegisterSW`
// en App.vue sigue reflejando la versión nueva sin que el usuario cierre la
// app. El listener de `SKIP_WAITING` cubre además el flujo manual de
// `updateServiceWorker(true)`.
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

self.skipWaiting()
clientsClaim()

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})
