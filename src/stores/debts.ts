import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Ref } from 'vue'
import { toast } from 'vue-sonner'
import { supabase } from '@/lib/supabase'
import { useAccountsStore } from '@/stores/accounts'
import { useAuthStore } from '@/stores/auth'
import { useCardPeopleStore } from '@/stores/cardPeople'
import type { Tables } from '@/types/database.types'

export type Debt = Tables<'debts'>
export type DebtMovement = Tables<'debt_movements'>
export type DebtDirection = 'lent' | 'borrowed'

export type DebtMovementWithDebt = DebtMovement & {
  debt: Debt
  /** Marca local "insertado/editado optimistamente, esperando confirmación
   * del servidor" — mismo criterio que `ExpenseWithCategory._pending`. */
  _pending?: boolean
}

/** Fila combinada lista para renderizar (secciones 3.5/3.6/6.1 de
 * debts-ux.md): `debts` (cabecera) + `debt_balances` (saldo, sección 1.2) +
 * el nombre de la contraparte, resuelto contra `cardPeopleStore.people` (ya
 * cargado por quien monte esta pantalla, sección 4.1 del doc — no se
 * duplica ese fetch acá). */
export interface DebtSummary {
  id: string
  direction: DebtDirection
  personId: string
  personName: string
  description: string | null
  balance: number
  createdAt: string
}

export interface CreateDebtPayload {
  personId: string
  direction: DebtDirection
  /** Siempre positivo — el usuario nunca tipea un monto negativo (sección
   * 5.1). El primer movimiento del hilo se crea con este monto como
   * "amount" positivo (una deuda nueva siempre *sube* el saldo). */
  amount: number
  accountId: string | null
  movementDate: string
  description: string | null
}

export interface UpdateDebtPayload {
  personId: string
  description: string | null
}

export interface DebtMovementPayload {
  debtId: string
  /** Ya con signo aplicado por el Sheet según el toggle "sube"/"baja"
   * (sección 7.1) — este store nunca decide el signo, solo lo persiste. */
  amount: number
  movementDate: string
  description: string | null
  accountId: string | null
}

const LEDGER_SAFETY_LIMIT = 500
const RECENT_MOVEMENTS_LIMIT = 30
// Red de seguridad defensiva (mismo criterio que SAFETY_LIMIT de
// cardExpenses.ts), no el mecanismo real de corrección: las queries que la
// usan ya van acotadas por rango de fecha (sección 1.3 de debts-ux.md).
const RANGE_SAFETY_LIMIT = 1000

const MOVEMENT_SELECT = '*, debt:debts(*)'

function sortDebtsDesc(list: DebtSummary[]): DebtSummary[] {
  return [...list].sort((a, b) => {
    const aPending = a.balance > 0
    const bPending = b.balance > 0
    // Sección 3.5: pendientes primero, saldadas al final.
    if (aPending !== bPending) return aPending ? -1 : 1
    // Dentro de "pendientes": monto desc. Dentro de "saldadas": más
    // recientes primero (no importa mucho el orden acá, pero es estable).
    if (aPending) return b.balance - a.balance
    return b.createdAt.localeCompare(a.createdAt)
  })
}

function sortMovementsDesc(list: DebtMovementWithDebt[]): DebtMovementWithDebt[] {
  return [...list].sort((a, b) => {
    if (a.movement_date !== b.movement_date) {
      return a.movement_date < b.movement_date ? 1 : -1
    }
    return a.created_at < b.created_at ? 1 : -1
  })
}

/**
 * Impacto en el saldo de la cuenta vinculada (sección 5.3/7.3): si el hilo es
 * `lent` (yo presté), un movimiento que *sube* la deuda (`amount > 0`, "presto
 * más") es plata que sale de la cuenta (saldo baja) y uno que la baja
 * (`amount < 0`, "me devuelven") es plata que entra (saldo sube) — de ahí el
 * signo invertido. Si el hilo es `borrowed` (me prestan), es al revés: un
 * movimiento que sube la deuda es plata que entra a la cuenta, uno que la
 * baja es plata que sale — mismo signo que `amount`. No documentado como
 * fórmula explícita en debts-ux.md (que solo pide "ajustamos el saldo
 * automáticamente por la plata real que sale o entra"), pero es la única
 * interpretación consistente con esa frase y con cómo `account_balances` ya
 * quedó extendida server-side (sección backend del encargo).
 */
function accountDeltaFor(direction: DebtDirection, amount: number): number {
  return direction === 'lent' ? -amount : amount
}

/**
 * Store de deudas/préstamos (debts-ux.md, sección completa). Tres perfiles de
 * mutación distintos conviven acá a propósito (sección 5.2/7.2/6.5 del doc):
 * alta de hilo nuevo vía RPC atómico (NO optimista), alta/edición/borrado de
 * movimiento sobre un hilo existente (100% optimista, "delta seguro" sobre un
 * balance ya confirmado), borrado de hilo completo (optimista, sin guard de
 * conteo). El saldo de un hilo SIEMPRE sale de `debt_balances` (sección 1.2),
 * nunca de sumar `debt_movements` en cliente — salvo el delta optimista ya
 * mencionado, que es aritmética sobre un valor ya de confianza, no una
 * re-suma desde cero (sección 7.2).
 */
export const useDebtsStore = defineStore('debts', () => {
  const cardPeopleStore = useCardPeopleStore()

  const debts = ref<Debt[]>([])
  /** Saldo por hilo (`debt_id`), poblado desde `debt_balances` — único lugar
   * de la app que representa "el saldo de un hilo" (sección 7.2). */
  const balances = ref<Record<string, number>>({})

  const debtSummaries = computed<DebtSummary[]>(() =>
    debts.value.map(debt => ({
      id: debt.id,
      direction: debt.direction as DebtDirection,
      personId: debt.person_id,
      personName: cardPeopleStore.personById(debt.person_id)?.name ?? 'Persona',
      description: debt.description,
      balance: balances.value[debt.id] ?? 0,
      createdAt: debt.created_at,
    })),
  )

  const lentDebts = computed(() => sortDebtsDesc(debtSummaries.value.filter(d => d.direction === 'lent')))
  const borrowedDebts = computed(() => sortDebtsDesc(debtSummaries.value.filter(d => d.direction === 'borrowed')))

  // Sección 1.2: agregado seguro en cliente porque es una lista chica de
  // hilos (una fila por contraparte+dirección), no de movimientos.
  const totalLentBalance = computed(() => lentDebts.value.reduce((sum, d) => sum + d.balance, 0))
  const totalBorrowedBalance = computed(() => borrowedDebts.value.reduce((sum, d) => sum + d.balance, 0))
  const netBalance = computed(() => totalLentBalance.value - totalBorrowedBalance.value)

  function debtById(id: string): Debt | undefined {
    return debts.value.find(debt => debt.id === id)
  }

  function summaryById(id: string): DebtSummary | undefined {
    return debtSummaries.value.find(summary => summary.id === id)
  }

  function replaceDebtById(id: string, next: Debt) {
    const idx = debts.value.findIndex(debt => debt.id === id)
    if (idx === -1) return
    const nextList = [...debts.value]
    nextList.splice(idx, 1, next)
    debts.value = nextList
  }

  function replaceInTargets(targets: Ref<DebtMovementWithDebt[]>[], id: string, next: DebtMovementWithDebt) {
    for (const target of targets) {
      const idx = target.value.findIndex(movement => movement.id === id)
      if (idx === -1) continue
      const list = [...target.value]
      list.splice(idx, 1, next)
      target.value = sortMovementsDesc(list)
    }
  }

  /** Todos los hilos de deuda del usuario (sección 1.2). */
  async function fetchDebts(): Promise<boolean> {
    const { data, error: fetchError } = await supabase.from('debts').select('*')

    if (fetchError) {
      console.error('[debts] No se pudieron cargar las deudas', fetchError)
      return false
    }

    debts.value = data ?? []
    return true
  }

  /** Todas las filas de `debt_balances` del usuario (sección 1.2): una sola
   * query, sin paginar ni acotar por fecha — seguro por la cardinalidad
   * chica de "hilos", no de "movimientos". */
  async function fetchBalances(): Promise<boolean> {
    const authStore = useAuthStore()
    const userId = authStore.user?.id
    if (!userId) {
      balances.value = {}
      return true
    }

    const { data, error: fetchError } = await supabase
      .from('debt_balances')
      .select('*')
      .eq('user_id', userId)

    if (fetchError) {
      console.error('[debts] No se pudo cargar el saldo de las deudas', fetchError)
      return false
    }

    const next: Record<string, number> = {}
    for (const row of data ?? []) {
      if (row.debt_id) next[row.debt_id] = row.balance ?? 0
    }
    balances.value = next
    return true
  }

  /** Ledger completo de un hilo (sección 1.3/6.2): única lista de movimientos
   * sin filtro de fecha, con `.limit(500)` defensivo (volumen esperado de un
   * solo hilo, chico de sobra). */
  async function fetchMovementsForDebt(debtId: string): Promise<DebtMovementWithDebt[] | null> {
    const { data, error: fetchError } = await supabase
      .from('debt_movements')
      .select(MOVEMENT_SELECT)
      .eq('debt_id', debtId)
      .order('movement_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(LEDGER_SAFETY_LIMIT)

    if (fetchError) {
      console.error('[debts] No se pudieron cargar los movimientos de la deuda', fetchError)
      return null
    }

    return (data ?? []) as unknown as DebtMovementWithDebt[]
  }

  /** "Historial" del dashboard (sección 3.6): últimos N movimientos de ambas
   * direcciones, sin filtro de mes. */
  async function fetchRecentMovements(limit = RECENT_MOVEMENTS_LIMIT): Promise<DebtMovementWithDebt[] | null> {
    const { data, error: fetchError } = await supabase
      .from('debt_movements')
      .select(MOVEMENT_SELECT)
      .order('movement_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit)

    if (fetchError) {
      console.error('[debts] No se pudieron cargar los movimientos recientes', fetchError)
      return null
    }

    return (data ?? []) as unknown as DebtMovementWithDebt[]
  }

  /** Movimientos acotados por rango de fecha (sección 1.3), reusados tanto
   * para "Resumen rápido" del mes en curso como para la ventana de 12 meses
   * de "Evolución de saldos" (sección 1.4) — el mes en curso siempre está
   * contenido en esa ventana, así que un único fetch alcanza para ambos. */
  async function fetchMovementsInRange(from: string, to: string): Promise<DebtMovementWithDebt[] | null> {
    const { data, error: fetchError } = await supabase
      .from('debt_movements')
      .select(MOVEMENT_SELECT)
      .gte('movement_date', from)
      .lt('movement_date', to)
      .limit(RANGE_SAFETY_LIMIT)

    if (fetchError) {
      console.error('[debts] No se pudieron cargar los movimientos del rango', fetchError)
      return null
    }

    return (data ?? []) as unknown as DebtMovementWithDebt[]
  }

  /**
   * Alta de deuda nueva (sección 5.2): NO optimista, vía el RPC atómico
   * `create_debt` (cabecera + primer movimiento en una sola transacción). El
   * Sheet permanece abierto en estado "Guardando…" hasta la confirmación —
   * acá no hay ninguna inserción local que revertir.
   */
  async function createDebt(payload: CreateDebtPayload): Promise<{ debtId: string } | { error: true }> {
    const authStore = useAuthStore()
    const userId = authStore.user?.id
    if (!userId) return { error: true }

    const { data, error: rpcError } = await supabase.rpc('create_debt', {
      p_person_id: payload.personId,
      p_direction: payload.direction,
      p_amount: payload.amount,
      p_account_id: payload.accountId ?? undefined,
      p_movement_date: payload.movementDate,
      p_description: payload.description ?? undefined,
    })

    if (rpcError || !data) {
      console.error('[debts] No se pudo crear la deuda', rpcError)
      return { error: true }
    }

    // Refresco puntual (no optimista, sección 5.2): trae la cabecera y el
    // saldo recién confirmados. Si se vinculó una cuenta, `account_balances`
    // ya quedó ajustada server-side (sección backend del encargo) — alcanza
    // con releer el saldo, no hace falta ningún ajuste manual de delta.
    await Promise.all([fetchDebts(), fetchBalances()])
    if (payload.accountId) {
      await useAccountsStore().fetchBalances()
    }

    return { debtId: data }
  }

  /** Edición de la cabecera (Contraparte + Descripción, sección 6.5): 100%
   * optimista, mismo patrón que `updateCard`/`updatePerson` — no hay ningún
   * índice único conocido sobre estos campos. Dirección nunca se edita acá
   * (bloqueada en el Sheet, sección 6.5). */
  function updateDebt(id: string, payload: UpdateDebtPayload): void {
    const previous = debtById(id)
    if (!previous) return

    const optimistic: Debt = { ...previous, person_id: payload.personId, description: payload.description }
    replaceDebtById(id, optimistic)

    const persist = async (): Promise<void> => {
      const { data, error: updateError } = await supabase
        .from('debts')
        .update({ person_id: payload.personId, description: payload.description })
        .eq('id', id)
        .select('*')
        .single()

      if (updateError || !data) {
        replaceDebtById(id, previous)
        toast.error('No se pudieron guardar los cambios', {
          description: 'Revisá tu conexión e intentá de nuevo.',
          action: {
            label: 'Reintentar',
            onClick: () => {
              replaceDebtById(id, optimistic)
              void persist()
            },
          },
        })
        return
      }

      replaceDebtById(id, data)
      toast.success('Cambios guardados')
    }

    void persist()
  }

  /**
   * Borrado de un hilo completo (sección 6.5): optimista, SIN guard de
   * conteo (a diferencia de categorías/cuentas/tarjetas/personas — un hilo de
   * deuda no es referenciado por ningún otro recurso, ver justificación
   * completa en el doc). `movements` es el ledger ya cargado por
   * `DebtDetailView` (sección 1.3: acotado a un solo hilo, chico de sobra) —
   * se usa para revertir el impacto de caja de cada movimiento vinculado a
   * una cuenta, mismo signo que `addMovement`/`deleteMovement`.
   */
  function deleteDebt(id: string, movements: Pick<DebtMovement, 'amount' | 'account_id'>[] = []): void {
    const removed = debtById(id)
    if (!removed) return

    const removedBalance = balances.value[id]
    const direction = removed.direction as DebtDirection

    debts.value = debts.value.filter(debt => debt.id !== id)
    const { [id]: _removedBalance, ...restBalances } = balances.value
    balances.value = restBalances

    const accountsStore = useAccountsStore()
    for (const movement of movements) {
      if (!movement.account_id) continue
      accountsStore.adjustBalance(movement.account_id, -accountDeltaFor(direction, movement.amount))
    }

    const persist = async (): Promise<void> => {
      const { error: deleteError } = await supabase.from('debts').delete().eq('id', id)

      if (deleteError) {
        debts.value = [...debts.value, removed]
        if (removedBalance !== undefined) balances.value = { ...balances.value, [id]: removedBalance }
        for (const movement of movements) {
          if (!movement.account_id) continue
          accountsStore.adjustBalance(movement.account_id, accountDeltaFor(direction, movement.amount))
        }
        toast.error('No se pudo eliminar la deuda', {
          description: 'Revisá tu conexión e intentá de nuevo.',
        })
        return
      }

      toast.success('Deuda eliminada')
    }

    void persist()
  }

  /**
   * Alta de movimiento sobre un hilo existente (sección 7.2): 100%
   * optimista. El "delta seguro" ajusta `balances[debtId]` sumando
   * directamente el monto del movimiento nuevo sobre un balance ya
   * confirmado — nunca se vuelve a sumar la lista completa de movimientos.
   */
  function addMovement(payload: DebtMovementPayload, targets: Ref<DebtMovementWithDebt[]>[] = []): void {
    const authStore = useAuthStore()
    const userId = authStore.user?.id
    const debt = debtById(payload.debtId)

    if (!userId || !debt) {
      toast.error('No se pudo guardar el movimiento', {
        description: 'Revisá tu conexión e intentá de nuevo.',
      })
      return
    }

    const direction = debt.direction as DebtDirection
    const tempId = `temp-${crypto.randomUUID()}`
    const nowIso = new Date().toISOString()
    const optimistic: DebtMovementWithDebt = {
      id: tempId,
      user_id: userId,
      debt_id: payload.debtId,
      account_id: payload.accountId,
      amount: payload.amount,
      movement_date: payload.movementDate,
      description: payload.description,
      created_at: nowIso,
      updated_at: nowIso,
      debt,
      _pending: true,
    }

    for (const target of targets) target.value = sortMovementsDesc([optimistic, ...target.value])

    const previousBalance = balances.value[payload.debtId] ?? 0
    balances.value = { ...balances.value, [payload.debtId]: previousBalance + payload.amount }

    const accountsStore = useAccountsStore()
    if (payload.accountId) {
      accountsStore.adjustBalance(payload.accountId, accountDeltaFor(direction, payload.amount))
    }

    const persist = async (): Promise<void> => {
      const { data, error: insertError } = await supabase
        .from('debt_movements')
        .insert({
          debt_id: payload.debtId,
          account_id: payload.accountId,
          amount: payload.amount,
          movement_date: payload.movementDate,
          description: payload.description,
          user_id: userId,
        })
        .select(MOVEMENT_SELECT)
        .single()

      if (insertError || !data) {
        for (const target of targets) target.value = target.value.filter(movement => movement.id !== tempId)
        balances.value = { ...balances.value, [payload.debtId]: previousBalance }
        if (payload.accountId) {
          accountsStore.adjustBalance(payload.accountId, -accountDeltaFor(direction, payload.amount))
        }
        toast.error('No se pudo guardar el movimiento', {
          description: 'Revisá tu conexión e intentá de nuevo.',
          action: {
            label: 'Reintentar',
            onClick: () => {
              for (const target of targets) target.value = sortMovementsDesc([optimistic, ...target.value])
              balances.value = { ...balances.value, [payload.debtId]: (balances.value[payload.debtId] ?? 0) + payload.amount }
              if (payload.accountId) {
                accountsStore.adjustBalance(payload.accountId, accountDeltaFor(direction, payload.amount))
              }
              void persist()
            },
          },
        })
        return
      }

      const confirmed = data as unknown as DebtMovementWithDebt
      replaceInTargets(targets, tempId, confirmed)
      toast.success('Movimiento guardado')
    }

    void persist()
  }

  /** Edición de movimiento (sección 7.2): mismo "delta seguro", pero por la
   * *diferencia* entre el monto viejo y el nuevo — y revirtiendo/aplicando el
   * impacto de cuenta de la cuenta vieja/nueva (pueden ser distintas). */
  function updateMovement(id: string, payload: DebtMovementPayload, targets: Ref<DebtMovementWithDebt[]>[] = []): void {
    const debt = debtById(payload.debtId)
    if (!debt) return

    let previous: DebtMovementWithDebt | undefined
    for (const target of targets) {
      previous = target.value.find(movement => movement.id === id)
      if (previous) break
    }
    if (!previous) return

    const direction = debt.direction as DebtDirection
    const optimistic: DebtMovementWithDebt = {
      ...previous,
      account_id: payload.accountId,
      amount: payload.amount,
      movement_date: payload.movementDate,
      description: payload.description,
      debt,
      _pending: true,
    }

    replaceInTargets(targets, id, optimistic)

    const balanceDelta = payload.amount - previous.amount
    const previousBalance = balances.value[payload.debtId] ?? 0
    if (balanceDelta !== 0) {
      balances.value = { ...balances.value, [payload.debtId]: previousBalance + balanceDelta }
    }

    const accountsStore = useAccountsStore()
    if (previous.account_id) {
      accountsStore.adjustBalance(previous.account_id, -accountDeltaFor(direction, previous.amount))
    }
    if (payload.accountId) {
      accountsStore.adjustBalance(payload.accountId, accountDeltaFor(direction, payload.amount))
    }

    const persist = async (): Promise<void> => {
      const { data, error: updateError } = await supabase
        .from('debt_movements')
        .update({
          account_id: payload.accountId,
          amount: payload.amount,
          movement_date: payload.movementDate,
          description: payload.description,
        })
        .eq('id', id)
        .select(MOVEMENT_SELECT)
        .single()

      if (updateError || !data) {
        replaceInTargets(targets, id, previous!)
        balances.value = { ...balances.value, [payload.debtId]: previousBalance }
        if (payload.accountId) {
          accountsStore.adjustBalance(payload.accountId, -accountDeltaFor(direction, payload.amount))
        }
        if (previous!.account_id) {
          accountsStore.adjustBalance(previous!.account_id, accountDeltaFor(direction, previous!.amount))
        }
        toast.error('No se pudieron guardar los cambios', {
          description: 'Revisá tu conexión e intentá de nuevo.',
          action: {
            label: 'Reintentar',
            onClick: () => {
              replaceInTargets(targets, id, optimistic)
              void persist()
            },
          },
        })
        return
      }

      const confirmed = data as unknown as DebtMovementWithDebt
      replaceInTargets(targets, id, confirmed)
      toast.success('Cambios guardados')
    }

    void persist()
  }

  /** Borrado de movimiento (sección 6.4): optimista, con el mismo "delta
   * seguro" restando el monto borrado — el guard de "último movimiento del
   * hilo" ya se resuelve de antemano en `DebtDetailView` (deshabilitando la
   * opción, mismo criterio que el resto del proyecto). */
  function deleteMovement(debtId: string, id: string, targets: Ref<DebtMovementWithDebt[]>[] = []): void {
    const debt = debtById(debtId)
    if (!debt) return

    let removed: DebtMovementWithDebt | undefined
    for (const target of targets) {
      removed = target.value.find(movement => movement.id === id)
      if (removed) break
    }
    if (!removed) return

    const direction = debt.direction as DebtDirection

    for (const target of targets) target.value = target.value.filter(movement => movement.id !== id)

    const previousBalance = balances.value[debtId] ?? 0
    balances.value = { ...balances.value, [debtId]: previousBalance - removed.amount }

    const accountsStore = useAccountsStore()
    if (removed.account_id) {
      accountsStore.adjustBalance(removed.account_id, -accountDeltaFor(direction, removed.amount))
    }

    const persist = async (): Promise<void> => {
      const { error: deleteError } = await supabase.from('debt_movements').delete().eq('id', id)

      if (deleteError) {
        for (const target of targets) target.value = sortMovementsDesc([...target.value, removed!])
        balances.value = { ...balances.value, [debtId]: previousBalance }
        if (removed!.account_id) {
          accountsStore.adjustBalance(removed!.account_id, accountDeltaFor(direction, removed!.amount))
        }
        toast.error('No se pudo eliminar el movimiento', {
          description: 'Revisá tu conexión e intentá de nuevo.',
          action: {
            label: 'Reintentar',
            onClick: () => {
              for (const target of targets) target.value = target.value.filter(movement => movement.id !== id)
              balances.value = { ...balances.value, [debtId]: (balances.value[debtId] ?? 0) - removed!.amount }
              if (removed!.account_id) {
                accountsStore.adjustBalance(removed!.account_id, -accountDeltaFor(direction, removed!.amount))
              }
              void persist()
            },
          },
        })
        return
      }

      toast.success('Movimiento eliminado')
    }

    void persist()
  }

  return {
    debts,
    balances,
    lentDebts,
    borrowedDebts,
    totalLentBalance,
    totalBorrowedBalance,
    netBalance,
    debtById,
    summaryById,
    fetchDebts,
    fetchBalances,
    fetchMovementsForDebt,
    fetchRecentMovements,
    fetchMovementsInRange,
    createDebt,
    updateDebt,
    deleteDebt,
    addMovement,
    updateMovement,
    deleteMovement,
  }
})
