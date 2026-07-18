// =============================================================================
// webpush.ts
// -----------------------------------------------------------------------------
// Envío de notificaciones Web Push (protocolo VAPID) a una PushSubscription
// del navegador. Usa la librería estándar `web-push` (npm) vía specifier
// npm: de Deno — es la primera opción recomendada por el encargo antes de
// implementar el protocolo a mano (VAPID JWT + payload AES128GCM).
//
// CAVEAT (ver resumen final de esta iteración, supabase-backend-expert):
// no se pudo probar un envío real end-to-end contra un push service real
// (no hay una suscripción de navegador real disponible en este entorno de
// implementación) — se validó únicamente que el import/compilación de la
// librería funciona en el runtime de Edge Functions al desplegar. Si en
// producción `web-push` resulta incompatible con el runtime (Deno Deploy),
// la alternativa documentada es reimplementar el protocolo a mano.
// =============================================================================

// @ts-ignore -- web-push no trae tipos oficiales resueltos para el runtime npm: de Deno.
import webpush from 'npm:web-push@3.6.7'

export interface PushSubscriptionRow {
  endpoint: string
  p256dh: string
  auth: string
}

export interface PushPayload {
  title: string
  body: string
  matchId: string
  urgent: boolean
}

let configured = false
function ensureConfigured() {
  if (configured) return
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com'
  if (!publicKey || !privateKey) {
    throw new Error('VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY no configurados como secrets de la Edge Function.')
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)
  configured = true
}

/**
 * Envía un Push a una suscripción. Devuelve `false` si el proveedor la
 * reportó inválida (404/410 → hay que podarla de push_subscriptions), o
 * `true` en cualquier otro caso (éxito, o error transitorio que no implica
 * que la suscripción esté muerta).
 */
export async function sendPush(sub: PushSubscriptionRow, payload: PushPayload): Promise<boolean> {
  ensureConfigured()
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({
        title: payload.title,
        body: payload.body,
        data: { matchId: payload.matchId },
      }),
      {
        urgency: payload.urgent ? 'high' : 'normal',
        TTL: payload.urgent ? 3600 : 600,
      },
    )
    return true
  } catch (e) {
    const status = (e as { statusCode?: number })?.statusCode
    if (status === 404 || status === 410) return false
    console.error('sendPush: error no fatal (no se poda la suscripción):', e)
    return true
  }
}
