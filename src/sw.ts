/// <reference lib="webworker" />
// Service worker custom (estrategia `injectManifest` de vite-plugin-pwa).
// -----------------------------------------------------------------------------
// Por qué injectManifest y no generateSW (decisión reportada en el resumen):
// generateSW produce un SW cerrado por Workbox, sin lugar para listeners
// propios. Web Push (live-matches-ux.md sección 6.5) necesita manejar los
// eventos `push` (mostrar la notificación con el payload del Edge Function
// `poll-matches`) y `notificationclick` (abrir/enfocar `/partidos/:id`) del
// lado del SW — eso obliga a escribir el SW a mano. injectManifest es el
// patrón estándar de vite-plugin-pwa para este caso: Vite compila este archivo
// con esbuild e inyecta el manifiesto de precache en `self.__WB_MANIFEST`.
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

// --- Web Push (sección 6.5) --------------------------------------------------

interface PushPayload {
  title?: string
  body?: string
  matchId?: string
  url?: string
  tag?: string
  priority?: 'high' | 'normal'
  data?: { matchId?: string, url?: string }
}

self.addEventListener('push', (event) => {
  let payload: PushPayload = {}
  if (event.data) {
    try {
      payload = event.data.json() as PushPayload
    } catch {
      payload = { title: 'TipApp', body: event.data.text() }
    }
  }

  const title = payload.title ?? 'TipApp'
  const matchId = payload.matchId ?? payload.data?.matchId ?? null
  const url = payload.url ?? payload.data?.url ?? (matchId ? `/partidos/${matchId}` : '/partidos')

  const options: NotificationOptions & { vibrate?: number[] } = {
    body: payload.body ?? '',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: payload.tag,
    data: { matchId, url },
    // Prioridad alta (gol/tarjeta/leg decidido, sección 6.5): mantener visible
    // y vibrar donde el navegador lo soporte.
    requireInteraction: payload.priority === 'high',
    vibrate: payload.priority === 'high' ? [120, 60, 120] : undefined,
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const data = (event.notification.data ?? {}) as { matchId?: string | null, url?: string }
  const targetPath = data.url ?? (data.matchId ? `/partidos/${data.matchId}` : '/partidos')
  const targetUrl = new URL(targetPath, self.location.origin).href

  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clientList) {
      // Reusar una ventana ya abierta: enfocar y navegar a la ruta del partido.
      await client.focus()
      if ('navigate' in client && client.url !== targetUrl) {
        try {
          await client.navigate(targetUrl)
        } catch {
          // Algunos navegadores restringen navigate() entre orígenes/estados;
          // el focus ya ocurrió, es una degradación aceptable.
        }
      }
      return
    }
    await self.clients.openWindow(targetPath)
  })())
})
