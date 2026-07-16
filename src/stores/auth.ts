import type { Session, User } from '@supabase/supabase-js'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { supabase } from '@/lib/supabase'
import type { Tables } from '@/types/database.types'

export type AuthStatus = 'pending' | 'authenticated' | 'unauthenticated'

// `database.types.ts` infiere `theme_preference` como `string` plano (el
// generador no modela el `check` de Postgres como union) — se declara acá
// el tipo real en vez de depender del tipo generado (ver tarea de
// theme-toggle-ux.md).
export type ThemePreference = 'light' | 'dark' | 'system'

// Debe coincidir con la clave leída por el script inline de `index.html`
// (que aplica el tema cacheado antes del primer paint, ver comentario ahí).
const THEME_STORAGE_KEY = 'tipapp:theme-preference'

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

function readCachedThemePreference(): ThemePreference {
  try {
    const cached = localStorage.getItem(THEME_STORAGE_KEY)
    if (isThemePreference(cached)) return cached
  } catch {
    // localStorage no disponible (privacy mode, etc.) — cae al default.
  }
  return 'system'
}

function cacheThemePreference(value: ThemePreference) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, value)
  } catch {
    // Igual que arriba: si falla el cacheo, el tema sigue aplicado en esta
    // sesión, solo no sobrevive a un refresh — degradación aceptable.
  }
}

function resolvesToDark(value: ThemePreference): boolean {
  if (value === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  return value === 'dark'
}

function applyThemeToDom(value: ThemePreference) {
  document.documentElement.classList.toggle('dark', resolvesToDark(value))
}

export const useAuthStore = defineStore('auth', () => {
  const status = ref<AuthStatus>('pending')
  const user = ref<User | null>(null)
  const profile = ref<Tables<'profiles'> | null>(null)

  // Se inicializa desde `localStorage` (cacheado por `selectTheme` en una
  // sesión anterior) para poder aplicar el tema ni bien se crea el store
  // (ver `applyThemeToDom(themePreference.value)` más abajo), sin esperar a
  // que se resuelva la sesión/perfil de Supabase. El script inline de
  // `index.html` ya adelantó la aplicación al DOM antes del primer paint;
  // esto sincroniza el estado reactivo del store con lo que quedó aplicado,
  // y el valor real de la fuente de verdad (el perfil remoto) llega después
  // vía `loadProfile` y puede corregirlo si difiere (otro dispositivo).
  const themePreference = ref<ThemePreference>(readCachedThemePreference())

  // Aplicación temprana: se ejecuta una sola vez, al crearse el store (Pinia
  // memoiza la instancia), lo antes posible dentro del ciclo de vida de Vue
  // — normalmente durante el setup() del primer componente que usa
  // `useAuthStore()` (el guard del router o `App.vue`), antes de montar la
  // pantalla real.
  applyThemeToDom(themePreference.value)

  // El valor "sistema" es dinámico: si el usuario cambia el tema del SO
  // mientras la app sigue abierta, se refleja en vivo sin recargar.
  if (typeof window.matchMedia === 'function') {
    const darkMediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    darkMediaQuery.addEventListener('change', () => {
      if (themePreference.value === 'system') applyThemeToDom('system')
    })
  }

  // Memoiza la promesa de inicialización: el guard del router y App.vue
  // pueden llamar a `initialize()` múltiples veces (en cada navegación /
  // en el mount), pero la resolución real de sesión debe ocurrir una sola
  // vez por carga de la app (sección 4.3 de expenses-mvp-ux.md).
  let initPromise: Promise<void> | null = null

  function applySession(session: Session | null) {
    user.value = session?.user ?? null
    status.value = session ? 'authenticated' : 'unauthenticated'
  }

  async function loadProfile(userId: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      console.error('[auth] No se pudo cargar el perfil del usuario', error)
      profile.value = null
      return
    }

    profile.value = data

    // El perfil remoto es la fuente de verdad real; `localStorage` es solo
    // el caché de arranque. Si difiere (p. ej. se cambió desde otra
    // sesión/dispositivo), se corrige acá: se aplica al DOM y se
    // resincroniza el caché local.
    if (data && isThemePreference(data.theme_preference) && data.theme_preference !== themePreference.value) {
      themePreference.value = data.theme_preference
      applyThemeToDom(data.theme_preference)
      cacheThemePreference(data.theme_preference)
    }
  }

  function initialize(): Promise<void> {
    if (initPromise) return initPromise

    initPromise = (async () => {
      const { data } = await supabase.auth.getSession()
      applySession(data.session)

      if (data.session?.user) {
        await loadProfile(data.session.user.id)
      }

      supabase.auth.onAuthStateChange((_event, newSession) => {
        applySession(newSession)
        if (newSession?.user) {
          void loadProfile(newSession.user.id)
        } else {
          profile.value = null
        }
      })
    })()

    return initPromise
  }

  async function signIn(email: string, password: string): Promise<void> {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  /**
   * Devuelve si el `signUp` dejó una sesión activa de inmediato
   * (auto-confirm, caso A de la sección 1.5) o si quedó pendiente de
   * confirmación de email (`session === null`, caso B).
   */
  async function signUp(email: string, password: string): Promise<{ hasSession: boolean }> {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    return { hasSession: data.session !== null }
  }

  async function signOut(): Promise<void> {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  /**
   * Escritura en segundo plano de `profiles.theme_preference`. Separada de
   * `selectTheme` para poder reintentar solo esta parte desde la acción del
   * toast de error, sin repetir la aplicación optimista al DOM (sección 5
   * de theme-toggle-ux.md: si falla, el tema visual NO se revierte, la
   * acción "Reintentar" solo reintenta el guardado remoto).
   */
  async function persistThemePreference(value: ThemePreference) {
    if (!user.value) return

    const { error } = await supabase
      .from('profiles')
      .update({ theme_preference: value })
      .eq('id', user.value.id)

    if (error) {
      console.error('[auth] No se pudo guardar la preferencia de tema', error)
      toast.error('No pudimos guardar tu preferencia de tema', {
        description: 'Se aplicó igual en este dispositivo, pero podría no verse así en otra sesión.',
        action: {
          label: 'Reintentar',
          onClick: () => {
            void persistThemePreference(value)
          },
        },
      })
      return
    }

    if (profile.value) profile.value = { ...profile.value, theme_preference: value }
  }

  /**
   * Aplicación optimista (sección 4 de theme-toggle-ux.md): cambia el DOM y
   * el `radiogroup` al instante, cachea en `localStorage` para el próximo
   * arranque, y recién después dispara el guardado remoto en segundo plano
   * sin esperar su resultado ni revertir nada si falla.
   */
  function selectTheme(value: ThemePreference) {
    themePreference.value = value
    applyThemeToDom(value)
    cacheThemePreference(value)
    void persistThemePreference(value)
  }

  return {
    status,
    user,
    profile,
    themePreference,
    initialize,
    signIn,
    signUp,
    signOut,
    selectTheme,
  }
})
