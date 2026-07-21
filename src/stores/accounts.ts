import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import type { Tables } from '@/types/database.types'

export type Account = Tables<'accounts'>

export interface AccountPayload {
  name: string
  color: string
  icon: string
  initialBalance: number
  /** account-transfers-ux.md sección 5.1: comisión sugerida al transferir
   * DESDE esta cuenta. `>= 0`, default 0. Puramente informativa (prefill del
   * Sheet de transferencia), no aplica ninguna lógica de saldo por sí sola. */
  transferCommission: number
}

/**
 * Store de cuentas (accounts-income-ux.md, secciones 1.4, 6.2/6.3). Sigue el
 * mismo patrón 100% optimista que `creditCards.ts` (no hay ningún índice
 * único conocido sobre `accounts.name`, sección 6.3 del doc) — a diferencia
 * de `categories.ts`, que sí es no-optimista por su restricción real.
 *
 * Regla dura del doc (sección 1, la más importante de todo el documento):
 * el saldo de una cuenta NUNCA se deriva sumando `expensesStore.expenses`/
 * `incomesStore.incomes` (listas capadas en cliente) — siempre se lee de la
 * vista agregada `account_balances`, resuelta en el servidor.
 */
export const useAccountsStore = defineStore('accounts', () => {
  const accounts = ref<Account[]>([])
  /** Conteo combinado `expenses(count) + incomes(count)` por cuenta, all-time
   * (sección 1.4) — usado para el primer guard de borrado (sección 6.4). */
  const usageCounts = ref<Record<string, number>>({})
  /** Saldo por cuenta, leído de `account_balances` (sección 1.2) — nunca
   * calculado sumando listas de gastos/ingresos en el cliente. */
  const balances = ref<Record<string, number>>({})

  // Sección 13.3.6: orden manual por `sort_order` (el usuario lo reordena a
  // mano vía los botones ↑/↓ del modo "Ordenar"), con `created_at` como
  // desempate estable si dos filas comparten `sort_order` (no debería pasar
  // en operación normal — el backfill/trigger de la migración lo garantiza —,
  // pero es un desempate barato de dejar puesto). Reemplaza el orden por
  // `created_at` de la Fase 1 (sección 6.2). A diferencia del grid de Inicio,
  // que ordena por saldo desc (sección 2.3).
  const sortedAccounts = computed(() =>
    [...accounts.value].sort(
      (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at),
    ),
  )

  /** True mientras hay un swap de `sort_order` en vuelo hacia el servidor
   * (sección 13.3.3/13.3.4): la vista deshabilita TODOS los botones ↑/↓
   * mientras dura, para que dos taps rápidos no disparen swaps superpuestos
   * que podrían pisarse si la segunda respuesta llega antes que la primera. */
  const isReordering = ref(false)

  const totalBalance = computed(() =>
    accounts.value.reduce((sum, account) => sum + (balances.value[account.id] ?? 0), 0),
  )

  function accountById(id: string): Account | undefined {
    return accounts.value.find(account => account.id === id)
  }

  /** Conteo de uso combinado de una cuenta (0 si todavía no se cargó o no
   * tiene movimientos), sección 1.4/6.4. */
  function countFor(id: string): number {
    return usageCounts.value[id] ?? 0
  }

  /** Saldo de una cuenta (0 si todavía no se cargó `account_balances` — una
   * cuenta recién creada sin movimientos también da 0, mismo valor por
   * defecto, no hay forma de distinguir "no cargado" de "cero real" acá,
   * pero no importa: `fetchBalances` siempre se llama junto con
   * `fetchAccounts`). */
  function balanceFor(id: string): number {
    return balances.value[id] ?? 0
  }

  /**
   * Ajuste optimista puntual del saldo ya cargado de `account_balances`
   * (sección 1: el saldo real sigue viniendo siempre del servidor, esto
   * solo suma/resta `delta` al número que ya se cargó, para que un alta/
   * edición/borrado optimista de gasto o ingreso — `expenses.ts`/
   * `incomes.ts` — se sienta "vivo" en el grid de cuentas de Inicio sin
   * esperar un refetch). Expuesto como método (en vez de que otro store
   * mute `balances` directamente) para mantener a `accounts.ts` como dueño
   * único de cómo se actualiza su propio estado.
   */
  function adjustBalance(id: string, delta: number): void {
    if (delta === 0) return
    balances.value = { ...balances.value, [id]: (balances.value[id] ?? 0) + delta }
  }

  async function fetchAccounts(): Promise<boolean> {
    // Sección 13.3.6: orden explícito por `sort_order` (orden manual del
    // usuario) con `created_at` como desempate — mismo criterio que
    // `sortedAccounts` re-aplica en cliente, pero se pide ya ordenado al
    // servidor en vez de traer sin `.order()` (que antes dejaba el orden a
    // criterio de Postgres).
    const { data, error: fetchError } = await supabase
      .from('accounts')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (fetchError) {
      console.error('[accounts] No se pudieron cargar las cuentas', fetchError)
      return false
    }

    accounts.value = data ?? []
    return true
  }

  /**
   * Saldo all-time por cuenta (sección 1.2): una única query a la vista de
   * Postgres `account_balances` (`balance = initial_balance + Σincomes -
   * Σexpenses`, ya resuelta en el servidor). La vista tiene
   * `security_invoker = true`, así que ya respeta la RLS del usuario que
   * consulta — no hace falta (pero no está de más) filtrar por `user_id`.
   */
  async function fetchBalances(): Promise<boolean> {
    const authStore = useAuthStore()
    const userId = authStore.user?.id
    if (!userId) {
      balances.value = {}
      return true
    }

    const { data, error: fetchError } = await supabase
      .from('account_balances')
      .select('*')
      .eq('user_id', userId)

    if (fetchError) {
      console.error('[accounts] No se pudo cargar el saldo de las cuentas', fetchError)
      return false
    }

    const next: Record<string, number> = {}
    for (const row of data ?? []) {
      if (row.account_id) next[row.account_id] = row.balance ?? 0
    }
    balances.value = next
    return true
  }

  /**
   * Conteo dedicado para el guard de borrado (sección 1.4): un único query
   * agregado embebido de PostgREST (`expenses(count) + incomes(count)`),
   * all-time, mismo mecanismo ya usado por `categories.ts`/`creditCards.ts`
   * — nunca se cuenta trayendo filas al cliente.
   *
   * Limitación conocida (igual que en los otros dos stores): PostgREST
   * devuelve cada agregado como `expenses: [{ count: number }]` (array de un
   * elemento), forma que `database.types.ts` no modela — de ahí el cast
   * puntual, mismo criterio que `categories.ts`/`creditCards.ts`.
   */
  async function fetchUsageCounts(): Promise<boolean> {
    const authStore = useAuthStore()
    const userId = authStore.user?.id
    if (!userId) {
      usageCounts.value = {}
      return true
    }

    const { data, error: fetchError } = await supabase
      .from('accounts')
      .select('id, expenses(count), incomes(count)')
      .eq('user_id', userId)

    if (fetchError) {
      console.error('[accounts] No se pudieron cargar los conteos de uso', fetchError)
      return false
    }

    const counts: Record<string, number> = {}
    for (const row of (data ?? []) as unknown as Array<{
      id: string
      expenses: Array<{ count: number }>
      incomes: Array<{ count: number }>
    }>) {
      const expenseCount = row.expenses[0]?.count ?? 0
      const incomeCount = row.incomes[0]?.count ?? 0
      counts[row.id] = expenseCount + incomeCount
    }
    usageCounts.value = counts
    return true
  }

  function replaceById(id: string, next: Account) {
    const idx = accounts.value.findIndex(account => account.id === id)
    if (idx === -1) return
    const nextList = [...accounts.value]
    nextList.splice(idx, 1, next)
    accounts.value = nextList
  }

  /** Alta optimista (sección 6.3): cierre inmediato del Sheet + inserción
   * local + confirmación/rollback con toast "Reintentar", mismo patrón que
   * `creditCards.ts`. La cuenta recién creada arranca en `balances` con su
   * propio `initial_balance` (todavía sin movimientos), para que
   * `totalBalance`/el grid de Inicio la reflejen antes de la confirmación
   * del servidor. */
  function addAccount(payload: AccountPayload): void {
    const authStore = useAuthStore()
    const userId = authStore.user?.id
    if (!userId) {
      toast.error('No se pudo guardar la cuenta', {
        description: 'Revisá tu conexión e intentá de nuevo.',
      })
      return
    }

    const tempId = `temp-${crypto.randomUUID()}`
    const nowIso = new Date().toISOString()
    // Sección 13.3.5: la cuenta nueva va SIEMPRE al final del orden manual.
    // Este valor optimista es solo un espejo del que asigna el trigger
    // `accounts_set_sort_order` server-side (max(sort_order) + 1) — no se
    // manda en el insert (el trigger lo recalcula), pero se necesita para que
    // `sortedAccounts` la ubique al final antes de la confirmación del server.
    const nextSortOrder = accounts.value.reduce((max, a) => Math.max(max, a.sort_order), -1) + 1
    const optimistic: Account = {
      id: tempId,
      user_id: userId,
      name: payload.name,
      color: payload.color,
      icon: payload.icon,
      initial_balance: payload.initialBalance,
      transfer_commission: payload.transferCommission,
      sort_order: nextSortOrder,
      created_at: nowIso,
      updated_at: nowIso,
    }

    accounts.value = [...accounts.value, optimistic]
    balances.value = { ...balances.value, [tempId]: payload.initialBalance }

    const persist = async (): Promise<void> => {
      const { data, error: insertError } = await supabase
        .from('accounts')
        .insert({
          name: payload.name,
          color: payload.color,
          icon: payload.icon,
          initial_balance: payload.initialBalance,
          transfer_commission: payload.transferCommission,
          user_id: userId,
        })
        .select('*')
        .single()

      if (insertError || !data) {
        accounts.value = accounts.value.filter(account => account.id !== tempId)
        const { [tempId]: _removed, ...restBalances } = balances.value
        balances.value = restBalances
        toast.error('No se pudo guardar la cuenta', {
          description: 'Revisá tu conexión e intentá de nuevo.',
          action: {
            label: 'Reintentar',
            onClick: () => {
              accounts.value = [...accounts.value, optimistic]
              balances.value = { ...balances.value, [tempId]: payload.initialBalance }
              void persist()
            },
          },
        })
        return
      }

      replaceById(tempId, data)
      const { [tempId]: tempBalance, ...restBalances } = balances.value
      balances.value = { ...restBalances, [data.id]: tempBalance ?? payload.initialBalance }
      toast.success('Cuenta creada')
    }

    void persist()
  }

  /** Edición optimista (sección 6.3), mismo patrón que `updateCard`. Si
   * cambia `initialBalance`, el saldo local se ajusta por la misma
   * diferencia (mismo razonamiento que la vista agregada: el saldo es un
   * simple sumando de `initial_balance`) para que el número se sienta
   * "vivo" antes de la confirmación — `fetchBalances` puede corregirlo si
   * hiciera falta en la próxima carga de pantalla. */
  function updateAccount(id: string, payload: AccountPayload): void {
    const previous = accountById(id)
    if (!previous) return

    const optimistic: Account = {
      ...previous,
      name: payload.name,
      color: payload.color,
      icon: payload.icon,
      initial_balance: payload.initialBalance,
      transfer_commission: payload.transferCommission,
    }

    const balanceDelta = payload.initialBalance - previous.initial_balance
    const previousBalance = balances.value[id]

    replaceById(id, optimistic)
    if (balanceDelta !== 0) {
      balances.value = { ...balances.value, [id]: (previousBalance ?? 0) + balanceDelta }
    }

    const persist = async (): Promise<void> => {
      const { data, error: updateError } = await supabase
        .from('accounts')
        .update({
          name: payload.name,
          color: payload.color,
          icon: payload.icon,
          initial_balance: payload.initialBalance,
          transfer_commission: payload.transferCommission,
        })
        .eq('id', id)
        .select('*')
        .single()

      if (updateError || !data) {
        replaceById(id, previous)
        if (previousBalance !== undefined) balances.value = { ...balances.value, [id]: previousBalance }
        toast.error('No se pudieron guardar los cambios', {
          description: 'Revisá tu conexión e intentá de nuevo.',
          action: {
            label: 'Reintentar',
            onClick: () => {
              replaceById(id, optimistic)
              void persist()
            },
          },
        })
        return
      }

      replaceById(id, data)
      toast.success('Cambios guardados')
    }

    void persist()
  }

  /** Borrado optimista (sección 6.4): los dos guards ("nunca la última
   * cuenta", "sin movimientos asociados") ya se resuelven de antemano en la
   * UI (`AccountsView.vue`, `canDelete`) — acá no se vuelve a validar,
   * mismo criterio que `categories.ts`/`creditCards.ts` (el backstop de la
   * carrera rara lo cubre la restricción `on delete restrict` de la BD). */
  function deleteAccount(id: string): void {
    const removed = accountById(id)
    if (!removed) return

    accounts.value = accounts.value.filter(account => account.id !== id)

    const persist = async (): Promise<void> => {
      const { error: deleteError } = await supabase.from('accounts').delete().eq('id', id)

      if (deleteError) {
        accounts.value = [...accounts.value, removed]
        toast.error('No se pudo eliminar la cuenta', {
          description: 'Revisá tu conexión o si tiene movimientos asociados.',
        })
        return
      }

      toast.success('Cuenta eliminada')
    }

    void persist()
  }

  /**
   * Reordenamiento manual optimista (sección 13.3.4): mueve la cuenta en la
   * posición `index` (del orden actual `sortedAccounts`) una posición hacia
   * arriba (`direction = -1`) o abajo (`direction = 1`), intercambiando su
   * `sort_order` con el de la cuenta adyacente. Mismo patrón optimista con
   * rollback + toast "Reintentar" que `addAccount`/`updateAccount`/
   * `deleteAccount`. Swap de a pares (no reescribir todos los `sort_order` de
   * la lista): mover una posición solo requiere intercambiar con el vecino,
   * el payload de red es O(1), no O(N).
   */
  function moveAccount(index: number, direction: -1 | 1): void {
    const list = sortedAccounts.value
    const otherIndex = index + direction
    if (otherIndex < 0 || otherIndex >= list.length) return

    const a = list[index]!
    const b = list[otherIndex]!
    const previousOrderA = a.sort_order
    const previousOrderB = b.sort_order

    // Optimista: swap de `sort_order` en el estado local — `sortedAccounts`
    // ya refleja el nuevo orden en el próximo render, sin esperar al servidor.
    replaceById(a.id, { ...a, sort_order: previousOrderB })
    replaceById(b.id, { ...b, sort_order: previousOrderA })

    isReordering.value = true
    const persist = async (): Promise<void> => {
      const [resA, resB] = await Promise.all([
        supabase.from('accounts').update({ sort_order: previousOrderB }).eq('id', a.id),
        supabase.from('accounts').update({ sort_order: previousOrderA }).eq('id', b.id),
      ])

      isReordering.value = false

      if (resA.error || resB.error) {
        // Rollback: ambas filas vuelven a su `sort_order` previo a la vez, no
        // se quedan "a mitad de camino" mostrando un orden no confirmado.
        replaceById(a.id, { ...a, sort_order: previousOrderA })
        replaceById(b.id, { ...b, sort_order: previousOrderB })
        toast.error('No se pudo guardar el nuevo orden', {
          description: 'Revisá tu conexión e intentá de nuevo.',
          action: { label: 'Reintentar', onClick: () => moveAccount(index, direction) },
        })
      }
      // Sin toast de éxito: el usuario ya ve el resultado (la fila se movió),
      // un toast por cada tap de ↑/↓ sería ruido (sección 13.3.4).
    }

    void persist()
  }

  return {
    accounts: sortedAccounts,
    usageCounts,
    balances,
    totalBalance,
    isReordering,
    accountById,
    countFor,
    balanceFor,
    adjustBalance,
    fetchAccounts,
    fetchBalances,
    fetchUsageCounts,
    addAccount,
    updateAccount,
    deleteAccount,
    moveAccount,
  }
})
