import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { FunctionsHttpError } from '@supabase/supabase-js'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { toast } from 'vue-sonner'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { useLiveMatchesStore, type LiveMatch } from '@/stores/liveMatches'
import type { Tables } from '@/types/database.types'

// Store de cupones multi-partido (live-coupons-ux.md). **Deliberadamente
// "tonto"** (mismo principio que `liveMatches.ts` §1.2 y `debt_balances`/
// `account_balances`): nunca deriva el estado de una predicción, de un partido
// dentro de un cupón (`bet_status`), del cupón (`status`), la cuota total ni la
// posible ganancia — todo eso llega ya resuelto en las vistas server-side
// (`bet_slip_summary`, `bet_slip_match_status`, `security_invoker=true`). Acá
// solo se lee/ensambla/muestra y se disparan acciones directas del usuario
// (crear cupón, quitar cupón).
//
// Decisión de arquitectura (reportada): store nuevo separado de `liveMatches.ts`
// — mismo criterio de separación por dominio que `debts.ts`/`debtPeople.ts`.
// `liveMatches.ts` sigue siendo dueño de la lista completa de `live_matches`;
// este store deriva cuáles están vinculados a un cupón (`linkedLiveMatchIds`),
// y `LiveMatchesView` calcula los "partidos sueltos" por diferencia de
// conjuntos (IDs ya en memoria, barato y seguro — NO es derivar estado).

export type BetSlipLeg = Tables<'bet_slip_legs'>
/** Estado de apuesta de un partido DENTRO de un cupón (server-side, §3.1). */
export type BetStatus = 'won' | 'lost' | 'live' | 'pending'
/** Estado de un cupón completo (server-side, §3.2). */
export type CouponStatus = 'won' | 'lost' | 'in_progress'

export interface CouponMatch {
  /** `bet_slip_matches.id` (el partido-dentro-de-cupón, no el `live_matches`). */
  id: string
  liveMatchId: string | null
  /** Vinculado a un partido real de Flashscore (§3.1 matiz): `live_match_id`
   * no es null. Si es false, no se sigue en vivo (sus legs quedan pending/
   * not_monitorable) — el frontend lo usa solo para el copy de la fila. */
  isLinked: boolean
  betStatus: BetStatus
  /** Snapshot en vivo del partido (marcador/minuto/stats), o `null` si no está
   * vinculado. */
  liveMatch: LiveMatch | null
  legs: BetSlipLeg[]
}

export interface Coupon {
  id: string
  reference: string | null
  stakeAmount: number | null
  status: CouponStatus
  totalOdds: number | null
  potentialWinnings: number | null
  legsMissingOdds: number
  matchCount: number
  wonMatches: number
  liveMatchesCount: number
  pendingMatches: number
  lostMatches: number
  matches: CouponMatch[]
}

/** Grupo que se manda a la Edge Function `create-bet-slip` (§9.5). Un grupo sin
 * `matchId` queda "no vinculado" (sus legs se guardan `not_monitorable`). */
export interface CreateBetSlipGroup {
  matchId?: string
  homeTeam?: string
  awayTeam?: string
  competition?: string
  legs: {
    marketType: string
    marketLabel: string
    selectionLabel: string
    threshold: number | null
    selector: string | null
    odds: number | null
    rawText: string | null
  }[]
}

// Formas crudas de las queries (casteadas: `database.types.ts` modela las
// vistas con todo nullable y el embed `live_matches` con `incidents: Json`
// recursivo — se aísla acá con casts documentados, mismo criterio que
// `liveMatches.ts` con `incidents`).
interface RawSummaryRow {
  bet_slip_id: string
  reference: string | null
  stake_amount: number | null
  status: string | null
  total_odds: number | null
  potential_winnings: number | null
  legs_missing_odds: number | null
  match_count: number | null
  won_matches: number | null
  live_matches_count: number | null
  pending_matches: number | null
  lost_matches: number | null
}
interface RawMatchRow {
  id: string
  bet_slip_id: string
  live_match_id: string | null
  created_at: string
  live_matches: LiveMatch | null
  bet_slip_legs: BetSlipLeg[] | null
}
interface RawStatusRow {
  bet_slip_match_id: string | null
  status: string | null
}

export const useBetSlipsStore = defineStore('betSlips', () => {
  const coupons = ref<Coupon[]>([])
  let channel: RealtimeChannel | null = null
  let refetchTimer: ReturnType<typeof setTimeout> | null = null

  const hasCoupons = computed(() => coupons.value.length > 0)

  /** IDs de `live_matches` que pertenecen a algún cupón — `LiveMatchesView` los
   * excluye para armar la lista de partidos sueltos (diferencia de conjuntos). */
  const linkedLiveMatchIds = computed(() => {
    const set = new Set<string>()
    for (const coupon of coupons.value) {
      for (const match of coupon.matches) {
        if (match.liveMatchId) set.add(match.liveMatchId)
      }
    }
    return set
  })

  function couponById(id: string): Coupon | undefined {
    return coupons.value.find(c => c.id === id)
  }

  /** Trae cupones + sus partidos + estados en 3 queries (cardinalidad chica,
   * §1.1). Ensambla en cliente sin derivar ningún estado (solo un join por id
   * de datos ya resueltos server-side). */
  async function fetchAll(): Promise<boolean> {
    const [summaryRes, matchesRes, statusRes] = await Promise.all([
      supabase.from('bet_slip_summary').select('*'),
      supabase.from('bet_slip_matches').select('*, live_matches(*), bet_slip_legs(*)'),
      supabase.from('bet_slip_match_status').select('bet_slip_match_id, status'),
    ])

    if (summaryRes.error || matchesRes.error || statusRes.error) {
      console.error(
        '[betSlips] No se pudieron cargar los cupones',
        summaryRes.error ?? matchesRes.error ?? statusRes.error,
      )
      return false
    }

    const summaries = (summaryRes.data ?? []) as unknown as RawSummaryRow[]
    const matchRows = (matchesRes.data ?? []) as unknown as RawMatchRow[]
    const statusRows = (statusRes.data ?? []) as unknown as RawStatusRow[]

    const statusByMatchId = new Map<string, BetStatus>()
    for (const row of statusRows) {
      if (row.bet_slip_match_id) {
        statusByMatchId.set(row.bet_slip_match_id, (row.status as BetStatus) ?? 'pending')
      }
    }

    const matchesBySlip = new Map<string, RawMatchRow[]>()
    for (const row of matchRows) {
      const list = matchesBySlip.get(row.bet_slip_id) ?? []
      list.push(row)
      matchesBySlip.set(row.bet_slip_id, list)
    }

    coupons.value = summaries.map((summary) => {
      const rawMatches = (matchesBySlip.get(summary.bet_slip_id) ?? [])
        .sort((a, b) => a.created_at.localeCompare(b.created_at))

      const matches: CouponMatch[] = rawMatches.map(row => ({
        id: row.id,
        liveMatchId: row.live_match_id,
        isLinked: row.live_match_id !== null,
        betStatus: statusByMatchId.get(row.id) ?? 'pending',
        liveMatch: row.live_matches ?? null,
        legs: row.bet_slip_legs ?? [],
      }))

      return {
        id: summary.bet_slip_id,
        reference: summary.reference,
        stakeAmount: summary.stake_amount,
        status: (summary.status as CouponStatus) ?? 'in_progress',
        totalOdds: summary.total_odds,
        potentialWinnings: summary.potential_winnings,
        legsMissingOdds: summary.legs_missing_odds ?? 0,
        matchCount: summary.match_count ?? matches.length,
        wonMatches: summary.won_matches ?? 0,
        liveMatchesCount: summary.live_matches_count ?? 0,
        pendingMatches: summary.pending_matches ?? 0,
        lostMatches: summary.lost_matches ?? 0,
        matches,
      }
    })

    return true
  }

  /**
   * Alta atómica de un cupón multi-partido (§9.5) vía la Edge Function
   * `create-bet-slip` (que orquesta el primer poll de los partidos vinculados y
   * la RPC transaccional). NO optimista (§1.8): el cliente no puede insertar sin
   * los `bet_slip_id`/`live_match_id` reales que devuelve el servidor. Al OK
   * refetchea cupones + partidos sueltos (crea `live_matches` nuevos que deben
   * excluirse de "sueltos").
   */
  async function createBetSlip(payload: {
    stakeAmount: number | null
    reference: string | null
    groups: CreateBetSlipGroup[]
  }): Promise<{ ok: true } | { errorCode: string }> {
    const { error } = await supabase.functions.invoke('create-bet-slip', {
      body: {
        stakeAmount: payload.stakeAmount,
        reference: payload.reference,
        groups: payload.groups,
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
      console.error('[betSlips] create-bet-slip falló', error)
      return { errorCode }
    }

    const liveMatchesStore = useLiveMatchesStore()
    await Promise.all([fetchAll(), liveMatchesStore.fetchAll()])
    return { ok: true }
  }

  /**
   * Quitar un cupón completo (decisión del encargo, §6.1): optimista con
   * rollback, sin guard de conteo. La cascada `ON DELETE CASCADE` borra sus
   * `bet_slip_matches`/`bet_slip_legs`; los `live_matches` subyacentes
   * sobreviven y reaparecen como "partidos sueltos" (ya están en la lista de
   * `liveMatches.ts`; al desaparecer de `linkedLiveMatchIds` se recalculan
   * solos).
   */
  function removeCoupon(id: string): void {
    const idx = coupons.value.findIndex(c => c.id === id)
    if (idx === -1) return
    const removed = coupons.value[idx]!

    coupons.value = coupons.value.filter(c => c.id !== id)

    const persist = async (): Promise<void> => {
      const { error } = await supabase.from('bet_slips').delete().eq('id', id)

      if (error) {
        const list = [...coupons.value]
        list.splice(idx, 0, removed)
        coupons.value = list
        toast.error('No se pudo quitar el cupón', {
          description: 'Revisá tu conexión e intentá de nuevo.',
        })
        return
      }

      toast.success('Cupón quitado')
    }

    void persist()
  }

  // --- Tiempo real (§1 original) ------------------------------------------
  //
  // Los estados de apuesta (`bet_status`/`status`/`total_odds`) viven en VISTAS
  // derivadas — Postgres no emite `postgres_changes` sobre vistas. Por eso, ante
  // cualquier cambio en las tablas de origen (`bet_slips`/`bet_slip_matches`/
  // `bet_slip_legs`) o en el snapshot en vivo (`live_matches`), se hace un
  // refetch debounced completo (3 queries chicas): mantiene el estado derivado
  // correcto sin reconciliarlo a mano en cliente (que sería derivar estado,
  // prohibido). El minuto en vivo tickea client-side sin red (mismo reloj que
  // los partidos sueltos), así que no depende de este refetch.

  function scheduleRefetch(): void {
    if (refetchTimer) clearTimeout(refetchTimer)
    refetchTimer = setTimeout(() => {
      void fetchAll()
    }, 700)
  }

  function subscribeRealtime(): void {
    if (channel) return
    const authStore = useAuthStore()
    const userId = authStore.user?.id
    if (!userId) return

    channel = supabase
      .channel('bet-slips-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bet_slips', filter: `user_id=eq.${userId}` }, () => scheduleRefetch())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bet_slip_matches', filter: `user_id=eq.${userId}` }, () => scheduleRefetch())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bet_slip_legs', filter: `user_id=eq.${userId}` }, () => scheduleRefetch())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_matches', filter: `user_id=eq.${userId}` }, () => scheduleRefetch())
      .subscribe()
  }

  function unsubscribeRealtime(): void {
    if (refetchTimer) {
      clearTimeout(refetchTimer)
      refetchTimer = null
    }
    if (!channel) return
    void supabase.removeChannel(channel)
    channel = null
  }

  return {
    coupons,
    hasCoupons,
    linkedLiveMatchIds,
    couponById,
    fetchAll,
    createBetSlip,
    removeCoupon,
    subscribeRealtime,
    unsubscribeRealtime,
  }
})
