import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { formatDateOnly, nowTimeInputValue, todayDateInputValue } from '@/lib/date'
import {
  type IronBucket,
  type IronGranularity,
  isInCurrentMonth,
  monthStartDate,
  nextMonthStartDate,
  sumCigaretteUnits,
} from '@/lib/iron'
import type { Tables } from '@/types/database.types'

export type IronCigarette = Tables<'iron_cigarettes'>
export type IronPack = Tables<'iron_packs'>

/** Referencia mínima a la fila "pareja" de una mitad completa (la otra parte),
 * para resolver en el Historial si ambas mitades cayeron el mismo día o en
 * días distintos (iron-ux.md sección 5.3) sin traer la fila entera. */
export type CigaretteRef = Pick<IronCigarette, 'id' | 'smoked_date' | 'smoked_time' | 'closes_cigarette_id'>

/** Fila viva de `iron_current_status` ya normalizada (sección 1.3): 0 o 1 por
 * usuario. Los campos del view son nullable en el tipo generado; acá solo se
 * construye cuando `pending_id` existe, así que todos son no-null. */
export interface PendingHalf {
  pending_id: string
  user_id: string
  pending_since_date: string
  pending_since_time: string
}

/** iron-ux.md sección 7: alta/edición de compra de cajetilla. `link` decide si
 * se genera un `expense` real (sección 2); `accountId` solo es obligatorio si
 * `link` está activo. */
export interface IronPackPayload {
  cost: number
  purchasedDate: string
  purchasedTime: string
  link: boolean
  accountId: string | null
}

// Límite defensivo del proyecto (MAX_* = 200). Un solo día real de Iron jamás
// se acerca, pero se mantiene el hábito preventivo del resto de los stores.
const MAX_IRON_ROWS = 200

/**
 * Store de Iron (docs/features/iron-ux.md sección 11.8). Nunca "trae todo el
 * historial": el dashboard fetchea el día de hoy + el mes en curso acotados,
 * el Historial fetchea un día puntual, y las Tendencias delegan la agregación a
 * las RPC `iron_cigarette_totals`/`iron_pack_totals` (agregación en Postgres,
 * nunca sumada en cliente sobre una lista sin acotar — sección 1.7).
 *
 * Patrón de mutación (sección 7.2):
 * - Registro de consumo (entero/mitad): **optimista** con "Deshacer" por toast
 *   (patrón nuevo del proyecto, sección 4.4), por ser de altísima frecuencia.
 * - Cerrar/descartar mitad, y compras vinculadas / ediciones que tocan el
 *   `expense`: **no optimistas**, vía RPC atómica (esperan la respuesta real).
 * - Compras sin vínculo (alta/edición/borrado): tabla simple.
 */
export const useIronStore = defineStore('iron', () => {
  const pendingHalf = ref<PendingHalf | null>(null)
  /** Filas de `iron_cigarettes` de HOY (para el resumen "Hoy" del dashboard y
   * el optimismo del registro rápido). No es un historial completo. */
  const todayCigarettes = ref<IronCigarette[]>([])
  /** Suma de `iron_packs.cost` del mes calendario en curso (sección 4.5) —
   * siempre disponible, esté o no vinculada la compra. */
  const monthPackSpend = ref(0)
  /** ¿Existe alguna compra de cajetilla alguna vez? (sección 6.2, para ocultar
   * el gráfico de gasto a quien nunca usó esa parte de Iron). */
  const hasAnyPackEver = ref(false)
  /** ¿Existe algún registro de consumo alguna vez? (sección 4.7, para el hint
   * de estado vacío total del dashboard). */
  const hasAnyCigaretteEver = ref(false)

  /** Total de cigarrillos de hoy (`SUM(entero=1, mitad=0.5)`, sección 1.2). */
  const todayCigaretteUnits = computed(() => sumCigaretteUnits(todayCigarettes.value))

  // Traza temp-id -> id real de un registro rápido ya persistido, para que
  // "Deshacer" pueda borrar la fila correcta aunque el insert ya haya resuelto.
  const realIdByTemp = new Map<string, string>()
  // temp-ids cuyo "Deshacer" se tocó ANTES de que el insert resolviera: el
  // callback de persistencia borra la fila real apenas exista.
  const undoneTempIds = new Set<string>()

  function currentUserId(): string | null {
    return useAuthStore().user?.id ?? null
  }

  function removeCigaretteLocal(id: string): void {
    todayCigarettes.value = todayCigarettes.value.filter(row => row.id !== id)
  }

  function replaceCigaretteLocal(id: string, next: IronCigarette): void {
    const idx = todayCigarettes.value.findIndex(row => row.id === id)
    if (idx === -1) return
    const list = [...todayCigarettes.value]
    list.splice(idx, 1, next)
    todayCigarettes.value = list
  }

  // --- Fetch acotado (nunca "todo el historial") -----------------------------

  async function fetchCurrentStatus(): Promise<boolean> {
    const { data, error } = await supabase
      .from('iron_current_status')
      .select('*')
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('[iron] No se pudo cargar el estado de mitad pendiente', error)
      return false
    }

    pendingHalf.value = data && data.pending_id
      ? {
          pending_id: data.pending_id,
          user_id: data.user_id ?? '',
          pending_since_date: data.pending_since_date ?? '',
          pending_since_time: data.pending_since_time ?? '',
        }
      : null
    return true
  }

  async function fetchTodayCigarettes(): Promise<boolean> {
    const today = todayDateInputValue()
    const { data, error } = await supabase
      .from('iron_cigarettes')
      .select('*')
      .eq('smoked_date', today)
      .order('smoked_time', { ascending: true })
      .limit(MAX_IRON_ROWS)

    if (error) {
      console.error('[iron] No se pudieron cargar los cigarrillos de hoy', error)
      return false
    }
    todayCigarettes.value = (data ?? []) as IronCigarette[]
    return true
  }

  async function fetchMonthSpend(): Promise<boolean> {
    const { data, error } = await supabase
      .from('iron_packs')
      .select('cost')
      .gte('purchased_date', monthStartDate())
      .lt('purchased_date', nextMonthStartDate())
      .limit(MAX_IRON_ROWS)

    if (error) {
      console.error('[iron] No se pudo cargar el gasto del mes', error)
      return false
    }
    monthPackSpend.value = (data ?? []).reduce((sum, row) => sum + (row.cost ?? 0), 0)
    return true
  }

  async function fetchHasAnyPack(): Promise<boolean> {
    const { data, error } = await supabase.from('iron_packs').select('id').limit(1)
    if (error) {
      console.error('[iron] No se pudo verificar si hay compras de cajetilla', error)
      return false
    }
    hasAnyPackEver.value = (data ?? []).length > 0
    return true
  }

  async function fetchHasAnyCigarette(): Promise<boolean> {
    const { data, error } = await supabase.from('iron_cigarettes').select('id').limit(1)
    if (error) {
      console.error('[iron] No se pudo verificar si hay registros de consumo', error)
      return false
    }
    hasAnyCigaretteEver.value = (data ?? []).length > 0
    return true
  }

  /** Carga inicial del dashboard (sección 4.7): estado + resumen de hoy + gasto
   * del mes + existencia de compras. Devuelve `false` si alguna falló. */
  async function fetchDashboard(): Promise<boolean> {
    const results = await Promise.all([
      fetchCurrentStatus(),
      fetchTodayCigarettes(),
      fetchMonthSpend(),
      fetchHasAnyPack(),
      fetchHasAnyCigarette(),
    ])
    return results.every(Boolean)
  }

  /** Historial de un día puntual (sección 5.2): cigarrillos + compras de ese
   * día, más las filas "pareja" de las mitades completas (que pueden caer en
   * otro día) para resolver la referencia cruzada de la sección 5.3. */
  async function fetchDay(date: string): Promise<
    {
      cigarettes: IronCigarette[]
      packs: IronPack[]
      partners: CigaretteRef[]
      /** `expense_id` -> `account_id` de las compras vinculadas del día, para
       * pintar el badge de cuenta (sección 5.3) y prefill del Sheet de edición. */
      linkedExpenseAccounts: Record<string, string>
    } | null
  > {
    const [cigRes, packRes] = await Promise.all([
      supabase
        .from('iron_cigarettes')
        .select('*')
        .eq('smoked_date', date)
        .order('smoked_time', { ascending: true })
        .limit(MAX_IRON_ROWS),
      supabase
        .from('iron_packs')
        .select('*')
        .eq('purchased_date', date)
        .order('purchased_time', { ascending: true })
        .limit(MAX_IRON_ROWS),
    ])

    if (cigRes.error || packRes.error) {
      console.error('[iron] No se pudo cargar el día', cigRes.error ?? packRes.error)
      return null
    }

    const cigarettes = (cigRes.data ?? []) as IronCigarette[]
    const packs = (packRes.data ?? []) as IronPack[]

    // Parejas: para cada mitad completa del día, resolver la otra parte.
    const completoMitades = cigarettes.filter(c => c.kind === 'mitad' && c.status === 'completo')
    const parentIds = completoMitades
      .map(c => c.closes_cigarette_id)
      .filter((id): id is string => !!id)
    const originalIds = completoMitades.filter(c => !c.closes_cigarette_id).map(c => c.id)

    const orParts: string[] = []
    if (parentIds.length) orParts.push(`id.in.(${parentIds.join(',')})`)
    if (originalIds.length) orParts.push(`closes_cigarette_id.in.(${originalIds.join(',')})`)

    let partners: CigaretteRef[] = []
    if (orParts.length) {
      const { data, error } = await supabase
        .from('iron_cigarettes')
        .select('id, smoked_date, smoked_time, closes_cigarette_id')
        .or(orParts.join(','))
        .limit(MAX_IRON_ROWS)
      if (error) {
        console.error('[iron] No se pudieron resolver las parejas de mitades', error)
        return null
      }
      partners = (data ?? []) as CigaretteRef[]
    }

    // Cuenta de las compras vinculadas del día (una sola query embebida).
    const linkedExpenseIds = packs
      .map(p => p.linked_expense_id)
      .filter((id): id is string => !!id)
    const linkedExpenseAccounts: Record<string, string> = {}
    if (linkedExpenseIds.length) {
      const { data, error } = await supabase
        .from('expenses')
        .select('id, account_id')
        .in('id', linkedExpenseIds)
      if (error) {
        console.error('[iron] No se pudieron resolver las cuentas de compras vinculadas', error)
        return null
      }
      for (const row of data ?? []) linkedExpenseAccounts[row.id] = row.account_id
    }

    return { cigarettes, packs, partners, linkedExpenseAccounts }
  }

  /** Tendencias (sección 6.3): delega la agregación por bucket a las RPC de
   * Postgres, acotadas por ventana. Devuelve buckets sparse; el cliente rellena
   * los ceros con `buildIronTrendSeries`. */
  async function fetchTrend(
    granularity: IronGranularity,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<{ cigarettes: IronBucket[], packs: IronBucket[] } | null> {
    const params = {
      p_granularity: granularity,
      p_window_start: formatDateOnly(windowStart),
      p_window_end: formatDateOnly(windowEnd),
    }
    const [cigRes, packRes] = await Promise.all([
      supabase.rpc('iron_cigarette_totals', params),
      supabase.rpc('iron_pack_totals', params),
    ])

    if (cigRes.error || packRes.error) {
      console.error('[iron] No se pudieron cargar las tendencias', cigRes.error ?? packRes.error)
      return null
    }

    return {
      cigarettes: (cigRes.data ?? []).map(row => ({
        period_start: row.period_start,
        total: Number(row.cigarette_count),
      })),
      packs: (packRes.data ?? []).map(row => ({
        period_start: row.period_start,
        total: Number(row.money_spent),
      })),
    }
  }

  // --- Registro rápido de consumo (optimista + "Deshacer", sección 4.4) ------

  /** Registra un cigarrillo entero o abre una mitad, de forma optimista.
   * Devuelve el `tempId` para el "Deshacer" del toast, o `null` si no hay
   * sesión. */
  function logCigarette(kind: 'entero' | 'mitad'): { tempId: string } | null {
    const userId = currentUserId()
    if (!userId) {
      toast.error('No pudimos registrar esto', { description: 'Revisá tu conexión e intentá de nuevo.' })
      return null
    }

    const now = new Date()
    const tempId = `temp-${crypto.randomUUID()}`
    const status = kind === 'entero' ? 'completo' : 'mitad_pendiente'
    const smokedDate = todayDateInputValue(now)
    const smokedTime = `${nowTimeInputValue(now)}:00`
    const optimistic: IronCigarette = {
      id: tempId,
      user_id: userId,
      kind,
      status,
      smoked_date: smokedDate,
      smoked_time: smokedTime,
      closes_cigarette_id: null,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    }

    const applyOptimistic = () => {
      todayCigarettes.value = [...todayCigarettes.value, optimistic]
      if (kind === 'mitad') {
        pendingHalf.value = {
          pending_id: tempId,
          user_id: userId,
          pending_since_date: smokedDate,
          pending_since_time: smokedTime,
        }
      }
    }

    const persist = async () => {
      const { data, error } = await supabase
        .from('iron_cigarettes')
        .insert({ user_id: userId, kind, status, smoked_date: smokedDate, smoked_time: smokedTime })
        .select('*')
        .single()

      if (error || !data) {
        removeCigaretteLocal(tempId)
        if (pendingHalf.value?.pending_id === tempId) pendingHalf.value = null
        toast.error('No pudimos registrar esto', {
          description: 'Revisá tu conexión e intentá de nuevo.',
          action: {
            label: 'Reintentar',
            onClick: () => {
              applyOptimistic()
              void persist()
            },
          },
        })
        return
      }

      // Si el usuario ya tocó "Deshacer" antes de que resolviera el insert.
      if (undoneTempIds.has(tempId)) {
        undoneTempIds.delete(tempId)
        await supabase.from('iron_cigarettes').delete().eq('id', data.id)
        return
      }

      replaceCigaretteLocal(tempId, data)
      realIdByTemp.set(tempId, data.id)
      if (pendingHalf.value?.pending_id === tempId) {
        pendingHalf.value = { ...pendingHalf.value, pending_id: data.id }
      }
    }

    applyOptimistic()
    void persist()
    return { tempId }
  }

  /** "Deshacer" de un registro rápido (sección 4.4): quita la fila local y
   * borra la del servidor (ya sea que el insert haya resuelto o no todavía). */
  function undoLog(tempId: string): void {
    const realId = realIdByTemp.get(tempId)
    const localId = realId ?? tempId
    removeCigaretteLocal(localId)
    if (pendingHalf.value && (pendingHalf.value.pending_id === tempId || pendingHalf.value.pending_id === realId)) {
      pendingHalf.value = null
    }

    if (realId) {
      realIdByTemp.delete(tempId)
      void supabase.from('iron_cigarettes').delete().eq('id', realId).then(({ error }) => {
        if (error) console.error('[iron] No se pudo deshacer el registro', error)
      })
    } else {
      // Todavía no persistió: el callback de `persist` lo borrará al resolver.
      undoneTempIds.add(tempId)
    }
  }

  // --- Cerrar / descartar mitad pendiente (RPC, no optimista, sección 1.4) ----

  /** Cierra la mitad pendiente. Sin argumento usa la del estado actual
   * (`pendingHalf`, dashboard); con `id` explícito cierra esa fila puntual
   * (fila "Cerrar" del Historial, sección 5.3) — como el invariante garantiza
   * una sola mitad pendiente por usuario, ambos apuntan a la misma fila. */
  async function closePendingHalf(id?: string): Promise<boolean> {
    const targetId = id ?? pendingHalf.value?.pending_id
    if (!targetId || targetId.startsWith('temp-')) return false

    const { error } = await supabase.rpc('close_pending_half', {
      p_cigarette_id: targetId,
      p_smoked_date: todayDateInputValue(),
      p_smoked_time: nowTimeInputValue(),
    })
    if (error) {
      console.error('[iron] No se pudo cerrar la mitad', error)
      toast.error('No pudimos cerrar la mitad', {
        description: 'Revisá tu conexión e intentá de nuevo.',
        action: { label: 'Reintentar', onClick: () => void closePendingHalf(targetId) },
      })
      return false
    }

    if (pendingHalf.value?.pending_id === targetId) pendingHalf.value = null
    // El cierre inserta una fila `completo` con fecha/hora de ahora: refrescamos
    // el resumen de hoy para que el conteo lo refleje.
    await fetchTodayCigarettes()
    return true
  }

  async function discardPendingHalf(): Promise<boolean> {
    const id = pendingHalf.value?.pending_id
    if (!id || id.startsWith('temp-')) return false

    const { error } = await supabase.rpc('discard_pending_half', { p_cigarette_id: id })
    if (error) {
      console.error('[iron] No se pudo descartar la mitad', error)
      toast.error('No pudimos descartar la mitad', {
        description: 'Revisá tu conexión e intentá de nuevo.',
        action: { label: 'Reintentar', onClick: () => void discardPendingHalf() },
      })
      return false
    }

    pendingHalf.value = null
    // Sección 4.3: sin AlertDialog, con red de seguridad vía "Deshacer" (revierte
    // el estado a `mitad_pendiente`, un update de una sola tabla permitido por
    // el índice único parcial mientras no haya otra mitad abierta).
    toast('Media descartada', {
      duration: 5000,
      action: { label: 'Deshacer', onClick: () => void undoDiscard(id) },
    })
    return true
  }

  async function undoDiscard(id: string): Promise<void> {
    const { data, error } = await supabase
      .from('iron_cigarettes')
      .update({ status: 'mitad_pendiente' })
      .eq('id', id)
      .select('*')
      .single()

    if (error || !data) {
      console.error('[iron] No se pudo deshacer el descarte', error)
      toast.error('No pudimos deshacer el descarte')
      return
    }

    pendingHalf.value = {
      pending_id: data.id,
      user_id: data.user_id,
      pending_since_date: data.smoked_date,
      pending_since_time: data.smoked_time,
    }
  }

  // --- Edición / borrado de cigarrillo entero (sección 5.3) ------------------

  async function editCigaretteTime(id: string, date: string, time: string): Promise<boolean> {
    const { error } = await supabase
      .from('iron_cigarettes')
      .update({ smoked_date: date, smoked_time: time })
      .eq('id', id)

    if (error) {
      console.error('[iron] No se pudo editar la hora', error)
      toast.error('No pudimos guardar los cambios', { description: 'Revisá tu conexión e intentá de nuevo.' })
      return false
    }
    return true
  }

  async function deleteCigarette(id: string): Promise<boolean> {
    const { error } = await supabase.from('iron_cigarettes').delete().eq('id', id)
    if (error) {
      console.error('[iron] No se pudo eliminar el cigarrillo', error)
      toast.error('No pudimos eliminar el registro', { description: 'Revisá tu conexión e intentá de nuevo.' })
      return false
    }
    removeCigaretteLocal(id)
    return true
  }

  // --- Compra de cajetilla (sección 7.2) -------------------------------------

  function applyMonthDelta(dateStr: string, delta: number): void {
    if (isInCurrentMonth(dateStr)) monthPackSpend.value += delta
  }

  /** Alta de compra. Sin vínculo: insert simple. Con vínculo: RPC atómica
   * `create_iron_pack_linked` (crea el `expense` real). Devuelve el id nuevo o
   * un discriminante de error para que el Sheet decida la rama de UI. */
  async function addPack(payload: IronPackPayload): Promise<{ id: string } | { error: true }> {
    const userId = currentUserId()
    if (!userId) return { error: true }

    if (payload.link) {
      const { data, error } = await supabase.rpc('create_iron_pack_linked', {
        p_account_id: payload.accountId!,
        p_cost: payload.cost,
        p_purchased_date: payload.purchasedDate,
        p_purchased_time: payload.purchasedTime,
      })
      if (error || !data) {
        console.error('[iron] No se pudo registrar la compra vinculada', error)
        return { error: true }
      }
      hasAnyPackEver.value = true
      applyMonthDelta(payload.purchasedDate, payload.cost)
      return { id: data }
    }

    const { data, error } = await supabase
      .from('iron_packs')
      .insert({
        user_id: userId,
        cost: payload.cost,
        purchased_date: payload.purchasedDate,
        purchased_time: payload.purchasedTime,
      })
      .select('id')
      .single()

    if (error || !data) {
      console.error('[iron] No se pudo registrar la compra', error)
      return { error: true }
    }
    hasAnyPackEver.value = true
    applyMonthDelta(payload.purchasedDate, payload.cost)
    return { id: data.id }
  }

  /** Edición de compra (sección 2.6). Si nunca estuvo vinculada y sigue sin
   * estarlo: update simple. En cualquier otro caso (sigue vinculada, o se
   * activa/desactiva el vínculo): RPC `update_iron_pack`, que preserva el id. */
  async function updatePack(pack: IronPack, payload: IronPackPayload): Promise<{ id: string } | { error: true }> {
    const wasLinked = !!pack.linked_expense_id
    let newId = pack.id

    if (!wasLinked && !payload.link) {
      const { data, error } = await supabase
        .from('iron_packs')
        .update({
          cost: payload.cost,
          purchased_date: payload.purchasedDate,
          purchased_time: payload.purchasedTime,
        })
        .eq('id', pack.id)
        .select('id')
        .single()

      if (error || !data) {
        console.error('[iron] No se pudo actualizar la compra', error)
        return { error: true }
      }
      newId = data.id
    } else {
      const { data, error } = await supabase.rpc('update_iron_pack', {
        p_pack_id: pack.id,
        p_cost: payload.cost,
        p_purchased_date: payload.purchasedDate,
        p_purchased_time: payload.purchasedTime,
        p_link: payload.link,
        p_account_id: payload.accountId ?? undefined,
      })
      if (error || !data) {
        console.error('[iron] No se pudo actualizar la compra vinculada', error)
        return { error: true }
      }
      newId = data
    }

    // Ajuste del gasto del mes: saca el costo viejo (si caía en el mes) y suma
    // el nuevo (si cae en el mes).
    applyMonthDelta(pack.purchased_date, -pack.cost)
    applyMonthDelta(payload.purchasedDate, payload.cost)
    return { id: newId }
  }

  /** Borrado de compra (sección 2.5). Vinculada: RPC `delete_iron_pack`
   * (cascada al `expense`). Sin vínculo: delete simple. */
  async function deletePack(pack: IronPack): Promise<boolean> {
    if (pack.linked_expense_id) {
      const { error } = await supabase.rpc('delete_iron_pack', { p_pack_id: pack.id })
      if (error) {
        console.error('[iron] No se pudo eliminar la compra vinculada', error)
        toast.error('No pudimos eliminar la cajetilla', { description: 'Revisá tu conexión e intentá de nuevo.' })
        return false
      }
    } else {
      const { error } = await supabase.from('iron_packs').delete().eq('id', pack.id)
      if (error) {
        console.error('[iron] No se pudo eliminar la compra', error)
        toast.error('No pudimos eliminar la cajetilla', { description: 'Revisá tu conexión e intentá de nuevo.' })
        return false
      }
    }

    applyMonthDelta(pack.purchased_date, -pack.cost)
    return true
  }

  return {
    pendingHalf,
    todayCigarettes,
    todayCigaretteUnits,
    monthPackSpend,
    hasAnyPackEver,
    hasAnyCigaretteEver,
    fetchCurrentStatus,
    fetchDashboard,
    fetchHasAnyPack,
    fetchDay,
    fetchTrend,
    logCigarette,
    undoLog,
    closePendingHalf,
    discardPendingHalf,
    editCigaretteTime,
    deleteCigarette,
    addPack,
    updatePack,
    deletePack,
  }
})
