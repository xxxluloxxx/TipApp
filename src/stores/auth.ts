import type { Session, User } from '@supabase/supabase-js'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import type { Tables } from '@/types/database.types'

export type AuthStatus = 'pending' | 'authenticated' | 'unauthenticated'

export const useAuthStore = defineStore('auth', () => {
  const status = ref<AuthStatus>('pending')
  const user = ref<User | null>(null)
  const profile = ref<Tables<'profiles'> | null>(null)

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

  return {
    status,
    user,
    profile,
    initialize,
    signIn,
    signUp,
    signOut,
  }
})
