// Detección de capacidad de Web Push y utilidades VAPID (live-matches-ux.md
// sección 6.4). Feature-detection confiable + un heurístico de user-agent
// solo para el copy de iOS (frágil a propósito, con fallback seguro, ver doc).

/** ¿El navegador soporta el stack completo de Web Push? En Safari iOS **sin**
 * instalar a pantalla de inicio esto da `false` (las APIs no existen en ese
 * contexto) — es la señal principal y confiable (sección 6.4). */
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined'
    && 'Notification' in window
    && 'serviceWorker' in navigator
    && 'PushManager' in window
  )
}

/** ¿Corre como PWA instalada (standalone) vs. pestaña normal? Refuerzo
 * opcional del copy (sección 6.4), no imprescindible para la lógica. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const standaloneMedia = window.matchMedia?.('(display-mode: standalone)').matches ?? false
  // `navigator.standalone` es propiedad no estándar de Safari iOS.
  const iosStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true
  return standaloneMedia || iosStandalone
}

/** Heurístico de user-agent para decidir el copy específico de iOS (sección
 * 6.4). Sabidamente frágil — el fallback si deja de matchear es el texto
 * genérico, nunca un error visible. */
export function isHeuristicallyIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
}

/** Convierte la clave pública VAPID (base64url) al `Uint8Array` que espera
 * `PushManager.subscribe({ applicationServerKey })` (patrón estándar). */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  // Se construye sobre un `ArrayBuffer` explícito (no `ArrayBufferLike`) para
  // que el tipo sea `Uint8Array<ArrayBuffer>` y satisfaga el `BufferSource`
  // que espera `PushManager.subscribe({ applicationServerKey })` (TS 5.7+
  // distingue `ArrayBuffer` de `SharedArrayBuffer` en los typed arrays).
  const buffer = new ArrayBuffer(rawData.length)
  const outputArray = new Uint8Array(buffer)
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}
