import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { isHeuristicallyIOS, isPushSupported, urlBase64ToUint8Array } from '@/lib/pushSupport'

// Estado del permiso del navegador, extendido con 'unsupported' para el caso
// en que la API de Notification directamente no existe (Safari iOS sin
// instalar, etc., sección 6.4).
export type PushPermission = NotificationPermission | 'unsupported'

const BANNER_DISMISSED_KEY = 'tipapp:notifications-banner-dismissed'
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

/**
 * Store de notificaciones Web Push (live-matches-ux.md sección 6). Estado
 * compartido entre el banner de `/partidos` (6.1) y el toggle de Ajustes
 * (6.3): permiso del navegador, si hay una suscripción activa registrada, y
 * la señal de soporte. Las filas de `push_subscriptions` se insertan/borran
 * directo con el cliente Supabase normal (RLS `_own` ya lo cubre, no hace
 * falta Edge Function).
 */
export const usePushNotificationsStore = defineStore('pushNotifications', () => {
  const supported = ref(isPushSupported())
  const permission = ref<PushPermission>(supported.value ? Notification.permission : 'unsupported')
  const isSubscribed = ref(false)
  const isBusy = ref(false)
  const bannerDismissed = ref(readBannerDismissed())

  const isIOS = computed(() => isHeuristicallyIOS())

  // "Activadas" solo si el permiso está concedido Y hay una suscripción
  // registrada (sección 6.3).
  const isEnabled = computed(() => permission.value === 'granted' && isSubscribed.value)

  const statusLabel = computed(() => {
    if (permission.value === 'denied') return 'Bloqueadas por el navegador'
    if (isEnabled.value) return 'Activadas'
    return 'Desactivadas'
  })

  function readBannerDismissed(): boolean {
    try {
      return localStorage.getItem(BANNER_DISMISSED_KEY) === '1'
    } catch {
      return false
    }
  }

  function dismissBanner(): void {
    bannerDismissed.value = true
    try {
      localStorage.setItem(BANNER_DISMISSED_KEY, '1')
    } catch {
      // localStorage no disponible: el banner no volverá esta sesión igual
      // (el ref ya quedó en true), solo no persiste al próximo arranque.
    }
  }

  /** Refresca el estado real leyendo el permiso del navegador y consultando
   * si hay una suscripción activa en el service worker. Llamar al montar las
   * pantallas que muestran el banner/toggle. */
  async function refresh(): Promise<void> {
    supported.value = isPushSupported()
    if (!supported.value) {
      permission.value = 'unsupported'
      isSubscribed.value = false
      return
    }

    permission.value = Notification.permission
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      isSubscribed.value = subscription !== null
    } catch {
      isSubscribed.value = false
    }
  }

  async function persistSubscription(subscription: PushSubscription): Promise<boolean> {
    const authStore = useAuthStore()
    const userId = authStore.user?.id
    if (!userId) return false

    const json = subscription.toJSON()
    const keys = json.keys ?? {}
    if (!keys.p256dh || !keys.auth) return false

    const { error } = await supabase
      .from('push_subscriptions')
      .upsert(
        {
          user_id: userId,
          endpoint: subscription.endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
          user_agent: navigator.userAgent,
        },
        { onConflict: 'user_id,endpoint' },
      )

    if (error) {
      console.error('[push] No se pudo registrar la suscripción', error)
      return false
    }
    return true
  }

  /**
   * Pide permiso (si hace falta) y registra la suscripción Push (sección
   * 6.1). Devuelve el resultado para que la vista muestre el feedback
   * adecuado. No muestra toasts propios en el caso "denegado" (el navegador
   * ya dio su feedback nativo, sección 6.1).
   */
  async function enable(): Promise<{ ok: boolean, reason?: 'unsupported' | 'denied' | 'error' | 'no_key' }> {
    if (!supported.value) return { ok: false, reason: 'unsupported' }
    if (!VAPID_PUBLIC_KEY) {
      console.error('[push] Falta VITE_VAPID_PUBLIC_KEY')
      return { ok: false, reason: 'no_key' }
    }

    isBusy.value = true
    try {
      let currentPermission = Notification.permission
      if (currentPermission === 'default') {
        currentPermission = await Notification.requestPermission()
      }
      permission.value = currentPermission

      if (currentPermission !== 'granted') {
        return { ok: false, reason: 'denied' }
      }

      const registration = await navigator.serviceWorker.ready
      let subscription = await registration.pushManager.getSubscription()
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        })
      }

      const persisted = await persistSubscription(subscription)
      if (!persisted) {
        return { ok: false, reason: 'error' }
      }

      isSubscribed.value = true
      return { ok: true }
    } catch (error) {
      console.error('[push] No se pudo activar las notificaciones', error)
      return { ok: false, reason: 'error' }
    } finally {
      isBusy.value = false
    }
  }

  /**
   * Da de baja la suscripción Push (sección 6.3): borra la fila de
   * `push_subscriptions` y desuscribe del navegador. No revoca el permiso
   * (no es posible vía JS) — reactivar el toggle vuelve a suscribir sin
   * volver a pedir permiso.
   */
  async function disable(): Promise<boolean> {
    if (!supported.value) return false

    isBusy.value = true
    try {
      const authStore = useAuthStore()
      const userId = authStore.user?.id
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()

      if (subscription && userId) {
        await supabase
          .from('push_subscriptions')
          .delete()
          .eq('user_id', userId)
          .eq('endpoint', subscription.endpoint)
        await subscription.unsubscribe()
      }

      isSubscribed.value = false
      return true
    } catch (error) {
      console.error('[push] No se pudo desactivar las notificaciones', error)
      return false
    } finally {
      isBusy.value = false
    }
  }

  return {
    supported,
    permission,
    isSubscribed,
    isBusy,
    isEnabled,
    isIOS,
    statusLabel,
    bannerDismissed,
    dismissBanner,
    refresh,
    enable,
    disable,
  }
})
