import type { Session, User } from '@supabase/supabase-js'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { hexToHslTriple, readableTextColor } from '@/lib/colors'
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

// Debe coincidir con la clave leída por el script inline de `index.html`
// (que aplica el acento cacheado antes del primer paint), mismo criterio que
// `THEME_STORAGE_KEY`.
const ACCENT_STORAGE_KEY = 'tipapp:accent-color'

const ACCENT_HEX_PATTERN = /^#[0-9a-f]{6}$/i

function isAccentColor(value: unknown): value is string {
  return typeof value === 'string' && ACCENT_HEX_PATTERN.test(value)
}

function readCachedAccentColor(): string | null {
  try {
    const cached = localStorage.getItem(ACCENT_STORAGE_KEY)
    if (isAccentColor(cached)) return cached
  } catch {
    // localStorage no disponible (privacy mode, etc.) — cae al color de
    // fábrica.
  }
  return null
}

function cacheAccentColor(value: string | null) {
  try {
    if (value === null) {
      localStorage.removeItem(ACCENT_STORAGE_KEY)
    } else {
      localStorage.setItem(ACCENT_STORAGE_KEY, value)
    }
  } catch {
    // Igual que arriba: si falla el cacheo, el acento sigue aplicado en esta
    // sesión, solo no sobrevive a un refresh — degradación aceptable.
  }
}

/**
 * Aplica (o revierte, si `hex === null`) el color de acento al DOM
 * sobreescribiendo `--primary`/`--primary-foreground`/`--ring` inline sobre
 * `documentElement` — gana por especificidad sobre los bloques fijos
 * `:root`/`.dark` de `main.css` sin importar cuál esté activo
 * (accent-color-ux.md sección 7), así que no depende de si el modo actual es
 * claro u oscuro para aplicar `--primary`/`--primary-foreground`.
 *
 * Decisión sobre `--ring` (no prescrita por la spec de UX, sección 2 del
 * encargo): SÍ se refleja el acento en `--ring`. Hoy, en `:root`, `--ring` es
 * literalmente igual a `--primary` (`main.css`) — dejar el anillo de foco
 * desincronizado del acento elegido rompería esa relación ya existente (el
 * resto de los botones primarios cambiaría de color pero su anillo de foco
 * seguiría con el azul de fábrica). En light se replica el mismo valor que
 * `--primary`. En dark, el `--ring` fijo (`217.2 91.2% 65%`) NO comparte el
 * lightness de `--primary` fijo (que se queda en 53.3%) — es a propósito más
 * claro para seguir siendo visible contra fondo oscuro. Se replica esa misma
 * relación con `hexToHslTriple(hex, { minLightness: 65 })`: mismo hue/
 * saturación del acento elegido, con un piso de lightness de 65% para
 * cualquier acento, incluso los más oscuros (p. ej. el Gris de
 * `COLOR_SWATCHES`), para que el anillo de foco siga siendo visible.
 */
function applyAccentToDom(hex: string | null) {
  const root = document.documentElement

  if (hex === null) {
    root.style.removeProperty('--primary')
    root.style.removeProperty('--primary-foreground')
    root.style.removeProperty('--ring')
    return
  }

  const primaryHsl = hexToHslTriple(hex)
  if (!primaryHsl) return // Hex corrupto (p. ej. localStorage editado a mano): no tocar nada.
  root.style.setProperty('--primary', primaryHsl)

  const foregroundHex = readableTextColor(hex) ?? '#ffffff'
  const foregroundHsl = hexToHslTriple(foregroundHex)
  if (foregroundHsl) root.style.setProperty('--primary-foreground', foregroundHsl)

  const isDark = root.classList.contains('dark')
  const ringHsl = hexToHslTriple(hex, isDark ? { minLightness: 65 } : undefined)
  if (ringHsl) root.style.setProperty('--ring', ringHsl)
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

  // Mismo mecanismo de aplicación temprana que el tema (ver comentario
  // arriba), pero para el color de acento: se inicializa desde el caché de
  // `localStorage` (el script inline de `index.html` ya lo aplicó antes del
  // primer paint) y se re-aplica acá para sincronizar el estado reactivo.
  const accentColor = ref<string | null>(readCachedAccentColor())
  applyAccentToDom(accentColor.value)

  // El valor "sistema" es dinámico: si el usuario cambia el tema del SO
  // mientras la app sigue abierta, se refleja en vivo sin recargar.
  if (typeof window.matchMedia === 'function') {
    const darkMediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    darkMediaQuery.addEventListener('change', () => {
      if (themePreference.value === 'system') {
        applyThemeToDom('system')
        // El cálculo de `--ring` para el acento depende de si el modo activo
        // es oscuro (ver `applyAccentToDom`) — al cambiar de modo por un
        // cambio del SO hay que recalcularlo, si no el anillo de foco queda
        // con el lightness del modo anterior.
        applyAccentToDom(accentColor.value)
      }
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

    // Mismo criterio que arriba para el color de acento: el perfil remoto
    // manda. A diferencia del tema (que siempre tiene un valor válido), acá
    // el remoto puede ser `NULL` (color de fábrica) — se normaliza a `null`
    // si no es un hex reconocible antes de comparar.
    if (data) {
      const remoteAccent = isAccentColor(data.accent_color) ? data.accent_color : null
      if (remoteAccent !== accentColor.value) {
        accentColor.value = remoteAccent
        applyAccentToDom(remoteAccent)
        cacheAccentColor(remoteAccent)
      }
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
    // Igual que en el listener de `matchMedia`: cambiar de modo claro/oscuro
    // puede cambiar el lightness que le corresponde a `--ring` (ver
    // `applyAccentToDom`), así que hay que recalcularlo con el acento actual.
    applyAccentToDom(accentColor.value)
    cacheThemePreference(value)
    void persistThemePreference(value)
  }

  /**
   * Escritura en segundo plano de `profiles.accent_color`. Mismo patrón que
   * `persistThemePreference`: separada de `selectAccentColor` para poder
   * reintentar solo esta parte desde la acción del toast de error, sin
   * repetir la aplicación optimista al DOM (accent-color-ux.md sección 5: si
   * falla, el color visual NO se revierte, "Reintentar" solo reintenta el
   * guardado remoto).
   */
  async function persistAccentColor(value: string | null) {
    if (!user.value) return

    const { error } = await supabase
      .from('profiles')
      .update({ accent_color: value })
      .eq('id', user.value.id)

    if (error) {
      console.error('[auth] No se pudo guardar el color de acento', error)
      toast.error('No pudimos guardar tu color de acento', {
        description: 'Se aplicó igual en este dispositivo, pero podría no verse así en otra sesión.',
        action: {
          label: 'Reintentar',
          onClick: () => {
            void persistAccentColor(value)
          },
        },
      })
      return
    }

    if (profile.value) profile.value = { ...profile.value, accent_color: value }
  }

  /**
   * Aplicación optimista (accent-color-ux.md sección 5): cambia el DOM y el
   * swatch marcado al instante, cachea en `localStorage` para el próximo
   * arranque, y recién después dispara el guardado remoto en segundo plano
   * sin esperar su resultado ni revertir nada si falla.
   */
  function selectAccentColor(value: string | null) {
    accentColor.value = value
    applyAccentToDom(value)
    cacheAccentColor(value)
    void persistAccentColor(value)
  }

  /**
   * Escritura optimista de `profiles.display_name`. Mismo criterio que
   * `selectTheme`/`selectAccentColor` (reflejo inmediato en el saludo de
   * Inicio y el drawer, ambos leen `profile.display_name` reactivamente),
   * pero SIN la capa de `localStorage`/aplicación al DOM: esas existen en
   * tema/acento por el requisito de pre-paint, el nombre no lo necesita.
   */
  async function updateDisplayName(value: string | null): Promise<void> {
    if (!user.value) return

    const previous = profile.value?.display_name ?? null
    if (previous === value) return // sin cambios reales, no re-escribir

    // Optimista: se refleja de inmediato en el saludo de Inicio y el drawer
    // (ambos leen authStore.profile.display_name reactivamente), sin esperar
    // la confirmación del servidor — mismo criterio que tema/acento.
    if (profile.value) profile.value = { ...profile.value, display_name: value }

    const { error } = await supabase
      .from('profiles')
      .update({ display_name: value })
      .eq('id', user.value.id)

    if (error) {
      console.error('[auth] No se pudo guardar el nombre de perfil', error)
      toast.error('No pudimos guardar tu nombre', {
        description: 'Se aplicó igual en este dispositivo, pero podría no verse así en otra sesión.',
        action: {
          label: 'Reintentar',
          onClick: () => {
            void updateDisplayName(value)
          },
        },
      })
    }
  }

  return {
    status,
    user,
    profile,
    themePreference,
    accentColor,
    initialize,
    signIn,
    signUp,
    signOut,
    selectTheme,
    selectAccentColor,
    updateDisplayName,
  }
})
