import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { FunctionsHttpError } from '@supabase/supabase-js'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { toast } from 'vue-sonner'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import type { Tables } from '@/types/database.types'

/** Tipo de un leg (predicción) — usado por componentes que muestran legs
 * sueltos. Con el rediseño de cupones multi-partido los legs cuelgan de
 * `bet_slip_matches`, no de `live_matches`: viven en el store `betSlips.ts`,
 * no acá. Se conserva el alias por compatibilidad de imports. */
export type BetSlipLeg = Tables<'bet_slip_legs'>

/** Fila de `live_matches` (sección 1.1: se traen en una sola query,
 * cardinalidad chica). Se conserva el `snake_case` del row real en vez de
 * mapear a `camelCase`: mantener el tipo alineado 1:1 con `Tables<'live_matches'>`
 * evita una capa de transformación que podría desincronizarse, y el "store
 * tonto" (sección 1.2) solo lee/muestra.
 *
 * Rediseño cupones: los legs YA NO se embeben acá (migraron a
 * `bet_slip_matches.bet_slip_legs`). Un `live_matches` puede estar suelto (sin
 * cupón) o referenciado por un `bet_slip_matches`; este store es dueño de la
 * lista completa de partidos y `betSlips.ts` deriva cuáles están vinculados. */
// `incidents` se reemplaza por `unknown` (se castea a `MatchIncident[]` en la
// vista): el tipo `Json` recursivo de `database.types.ts`, dentro de un `ref`
// reactivo + computeds, dispara TS2589 ("type instantiation excessively
// deep") — sacar esa recursión del tipo reactivo lo resuelve sin perder nada
// (el store es "tonto", no lee `incidents`).
export type LiveMatch = Omit<Tables<'live_matches'>, 'incidents'> & {
  incidents: unknown
}

/** Partido devuelto por la Edge Function `search-matches` (live-matches-ux.md
 * sección 5.1). Es un proxy sobre el feed externo (Flashscore), no una tabla
 * propia: nunca incluye finalizados y la lista ya viene acotada por `dayOffset`
 * (sección 1.11). El `matchId` es el `mid` de Flashscore — se compara contra
 * `live_matches.flashscore_mid` para detectar partidos ya seguidos. */
export interface SearchMatch {
  matchId: string
  homeTeam: string
  awayTeam: string
  league: string | null
  kickoffAt: string
  status: 'upcoming' | 'live'
}

const MATCH_SELECT = '*'

/**
 * Store de partidos en vivo (live-matches-ux.md). **Deliberadamente "tonto"**
 * (sección 1.2): nunca deriva marcador/minuto/stats/estado de leg — todo eso
 * ya viene resuelto server-side en la fila que trajo el Edge Function/cron.
 * Acá solo se lee/muestra y se disparan acciones directas del usuario
 * (agregar/pausar/reanudar/quitar).
 *
 * Decisión de optimismo (reportada en el resumen): `addMatch` NO es optimista
 * (sección 1.8: depende de un roundtrip real de OCR + alta atómica server-side
 * que puebla el snapshot inicial — no hay nada que mostrar hasta que responde).
 * En cambio `toggleMonitoring`/`removeMatch` SÍ son optimistas con rollback:
 * son mutaciones directas y simples del usuario sobre una fila propia (no
 * derivadas del cron), mismo criterio que ya usa el resto de la app para
 * acciones directas (expenses/debts). Realtime confirma/corrige el valor
 * autoritativo después.
 */
export const useLiveMatchesStore = defineStore('liveMatches', () => {
  const matches = ref<LiveMatch[]>([])
  let channel: RealtimeChannel | null = null

  const hasMatches = computed(() => matches.value.length > 0)

  function matchById(id: string): LiveMatch | undefined {
    return matches.value.find(match => match.id === id)
  }

  function upsertMatch(next: LiveMatch) {
    const idx = matches.value.findIndex(match => match.id === next.id)
    if (idx === -1) {
      matches.value = [...matches.value, next]
      return
    }
    const list = [...matches.value]
    list.splice(idx, 1, next)
    matches.value = list
  }

  /** Todos los partidos seguidos del usuario (sección 1.1): una sola query,
   * sin paginar ni acotar por fecha — seguro por la cardinalidad chica. */
  async function fetchAll(): Promise<boolean> {
    const { data, error } = await supabase
      .from('live_matches')
      .select(MATCH_SELECT)
      .order('last_changed_at', { ascending: false })

    if (error) {
      console.error('[liveMatches] No se pudieron cargar los partidos', error)
      return false
    }

    matches.value = (data ?? []) as unknown as LiveMatch[]
    return true
  }

  async function fetchOne(id: string): Promise<LiveMatch | null> {
    const { data, error } = await supabase
      .from('live_matches')
      .select(MATCH_SELECT)
      .eq('id', id)
      .maybeSingle()

    if (error) {
      console.error('[liveMatches] No se pudo cargar el partido', error)
      return null
    }
    if (!data) return null

    const match = data as unknown as LiveMatch
    upsertMatch(match)
    return match
  }

  /**
   * Busca partidos en vivo/por jugar (live-matches-ux.md sección 5.1) vía la
   * Edge Function `search-matches` — mismo patrón de invocación que `add-match`
   * (JWT de usuario automático, `FunctionsHttpError` para el body de error).
   * Devuelve la lista tipada o un `errorCode` (mismo estilo discriminante que
   * `addMatch`, para que el componente decida la rama de UI sin `try/catch`).
   */
  async function searchMatches(dayOffset: number, query?: string): Promise<
    { matches: SearchMatch[] } | { errorCode: string }
  > {
    const trimmed = query?.trim()
    const { data, error } = await supabase.functions.invoke('search-matches', {
      body: {
        dayOffset,
        // El contrato exige 2+ caracteres para filtrar por equipo: por debajo
        // de eso se pide el día completo, sin `query` (sección 5.1.1).
        ...(trimmed && trimmed.length >= 2 ? { query: trimmed } : {}),
      },
    })

    if (error) {
      let errorCode = 'unknown'
      if (error instanceof FunctionsHttpError) {
        try {
          const body = await error.context.json()
          if (typeof body?.error === 'string') errorCode = body.error
        } catch {
          // Cuerpo no-JSON: se queda con 'unknown' (estado de error genérico).
        }
      }
      console.error('[liveMatches] search-matches falló', error)
      return { errorCode }
    }

    const results = (data?.matches ?? []) as SearchMatch[]
    return { matches: results }
  }

  /**
   * Alta de partido (sección 1.8/5.5): NO optimista. Llama al Edge Function
   * `add-match`, que hace el primer poll sincrónico y crea partido + legs de
   * forma atómica. Devuelve un discriminante para que el Sheet decida la rama
   * de UI (duplicado → copy específico, resto → toast genérico).
   *
   * El partido llega ya resuelto por el buscador del paso 1 (sección 5.1): se
   * mandan `matchId`/`homeTeam`/`awayTeam` en vez de una URL. OJO: el campo del
   * backend se llama `competition` (no `league`); el `league` del picker es lo
   * más cercano que tenemos, así que se mapea `competition: league ?? undefined`.
   */
  async function addMatch(payload: {
    matchId: string
    homeTeam: string
    awayTeam: string
    league?: string | null
  }): Promise<
    { match: LiveMatch } | { errorCode: string }
  > {
    // Rediseño cupones (§9.1 camino A): el alta suelta ya no lleva legs — un
    // partido sin foto queda suelto, sin predicciones. El cupón multi-partido
    // se crea por la Edge Function `create-bet-slip` (store `betSlips.ts`).
    const { data, error } = await supabase.functions.invoke('add-match', {
      body: {
        matchId: payload.matchId,
        homeTeam: payload.homeTeam,
        awayTeam: payload.awayTeam,
        competition: payload.league ?? undefined,
        legs: [],
      },
    })

    if (error) {
      let errorCode = 'unknown'
      if (error instanceof FunctionsHttpError) {
        try {
          const body = await error.context.json()
          if (typeof body?.error === 'string') errorCode = body.error
        } catch {
          // Cuerpo no-JSON: se queda con 'unknown' (toast genérico).
        }
      }
      console.error('[liveMatches] add-match falló', error)
      return { errorCode }
    }

    const created = data?.match as LiveMatch | undefined
    if (!created) return { errorCode: 'unknown' }

    // Inserción/actualización en la lista local (Realtime también podría
    // traer la fila; `upsertMatch` dedupe por id, sin duplicar la card).
    upsertMatch(created)
    return { match: created }
  }

  /** Pausar/reanudar el monitoreo (sección 3.4): optimista con rollback. */
  function toggleMonitoring(id: string): void {
    const previous = matchById(id)
    if (!previous) return

    const nextState = previous.state === 'paused' ? 'monitoring' : 'paused'
    upsertMatch({ ...previous, state: nextState })

    const persist = async (): Promise<void> => {
      const { data, error } = await supabase
        .from('live_matches')
        .update({ state: nextState })
        .eq('id', id)
        .select(MATCH_SELECT)
        .single()

      if (error || !data) {
        upsertMatch(previous)
        toast.error('No se pudo actualizar el partido', {
          description: 'Revisá tu conexión e intentá de nuevo.',
          action: {
            label: 'Reintentar',
            onClick: () => {
              upsertMatch({ ...previous, state: nextState })
              void persist()
            },
          },
        })
        return
      }

      upsertMatch(data as unknown as LiveMatch)
    }

    void persist()
  }

  /** Quitar un partido (sección 1.9/3.4): optimista, sin guard de conteo
   * (los legs son hijos en cascada, ningún otro recurso lo referencia). */
  function removeMatch(id: string): void {
    const removed = matchById(id)
    if (!removed) return

    matches.value = matches.value.filter(match => match.id !== id)

    const persist = async (): Promise<void> => {
      const { error } = await supabase.from('live_matches').delete().eq('id', id)

      if (error) {
        upsertMatch(removed)
        toast.error('No se pudo quitar el partido', {
          description: 'Revisá tu conexión e intentá de nuevo.',
        })
        return
      }

      toast.success('Partido quitado')
    }

    void persist()
  }

  // --- Tiempo real (sección 1.3) ------------------------------------------

  function applyMatchChange(payload: {
    eventType: 'INSERT' | 'UPDATE' | 'DELETE'
    new: Record<string, unknown>
    old: Record<string, unknown>
  }): void {
    if (payload.eventType === 'DELETE') {
      const oldId = payload.old?.id as string | undefined
      if (oldId) matches.value = matches.value.filter(match => match.id !== oldId)
      return
    }

    const row = payload.new as unknown as Tables<'live_matches'>
    if (!row?.id) return
    upsertMatch(row as unknown as LiveMatch)
  }

  /** Suscribe a `postgres_changes` de `live_matches`, filtrado por `user_id`
   * (sección 1.3). Idempotente: si ya hay un canal, no crea otro. Los legs de
   * cupón viven en `betSlips.ts` (su propia suscripción), no acá. */
  function subscribeRealtime(): void {
    if (channel) return
    const authStore = useAuthStore()
    const userId = authStore.user?.id
    if (!userId) return

    channel = supabase
      .channel('live-matches-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_matches', filter: `user_id=eq.${userId}` },
        payload => applyMatchChange(payload as never),
      )
      .subscribe()
  }

  function unsubscribeRealtime(): void {
    if (!channel) return
    void supabase.removeChannel(channel)
    channel = null
  }

  return {
    matches,
    hasMatches,
    matchById,
    fetchAll,
    fetchOne,
    searchMatches,
    addMatch,
    toggleMonitoring,
    removeMatch,
    subscribeRealtime,
    unsubscribeRealtime,
  }
})
