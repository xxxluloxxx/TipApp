import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Ref } from 'vue'
import { toast } from 'vue-sonner'
import { formatAmount } from '@/lib/currency'
import { supabase } from '@/lib/supabase'
import { useAccountsStore } from '@/stores/accounts'
import type { Account } from '@/stores/accounts'
import { useAuthStore } from '@/stores/auth'
import type { DateAccountFilter } from '@/stores/expenses'
import type { Tables } from '@/types/database.types'

export type IncomeWithAccount = Tables<'incomes'> & {
  account: Account
  /** Marca local "insertado/editado optimistamente, esperando confirmación
   * del servidor" — mismo criterio que `ExpenseWithCategory._pending`. */
  _pending?: boolean
}

export interface IncomePayload {
  amount: number
  accountId: string
  description: string | null
  incomeDate: string
}

// Mismo límite defensivo que `expenses.ts` (sección 7.4 de
// accounts-income-ux.md: "sin monthTotal ni ningún cómputo de mes... solo la
// lista + CRUD"). Importante: este store NUNCA se usa para calcular un saldo
// (eso viene de `account_balances` en `accounts.ts`, sección 1) — el límite
// acá es solo para no traer un historial ilimitado a memoria para el listado
// de "Transacciones"/"recientes", igual que `expenses.ts`.
export const MAX_INCOMES = 200

/** income_date desc, created_at desc — mismo criterio que `sortExpenses`. */
function sortIncomes(list: IncomeWithAccount[]): IncomeWithAccount[] {
  return [...list].sort((a, b) => {
    if (a.income_date !== b.income_date) {
      return a.income_date < b.income_date ? 1 : -1
    }
    return a.created_at < b.created_at ? 1 : -1
  })
}

/**
 * Store de ingresos (accounts-income-ux.md sección 7.4): mismo patrón CRUD
 * optimista que `expenses.ts`, pero sin `monthTotal` — el hero de Inicio
 * ("Total del mes") sigue siendo exclusivamente gasto mensual (sección 2.1
 * del doc, no se toca), así que este store no necesita ningún cómputo de mes.
 */
export const useIncomesStore = defineStore('incomes', () => {
  const incomes = ref<IncomeWithAccount[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  async function fetchAll(): Promise<void> {
    isLoading.value = true
    error.value = null

    const { data, error: fetchError } = await supabase
      .from('incomes')
      .select('*, account:accounts(*)')
      .order('income_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(MAX_INCOMES)

    if (fetchError) {
      error.value = fetchError.message
      isLoading.value = false
      return
    }

    incomes.value = (data ?? []) as unknown as IncomeWithAccount[]
    isLoading.value = false
  }

  /** Movimientos recientes de UNA cuenta (account-detail-ux.md sección 7.1),
   * mismo patrón que `expensesStore.fetchRecentForAccount`: fetch propio
   * acotado por cuenta, sin tocar la lista maestra `incomes` (capada a
   * `MAX_INCOMES` del usuario completo). Devuelve `null` si falló. */
  async function fetchRecentForAccount(accountId: string, limit = 10): Promise<IncomeWithAccount[] | null> {
    const { data, error: fetchError } = await supabase
      .from('incomes')
      .select('*, account:accounts(*)')
      .eq('account_id', accountId)
      .order('income_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit)

    if (fetchError) {
      console.error('[incomes] No se pudieron cargar los movimientos recientes de la cuenta', fetchError)
      return null
    }

    return (data ?? []) as unknown as IncomeWithAccount[]
  }

  /** Fetch acotado por Mes/Cuenta para `/transacciones`
   * (transactions-filters-ux.md sección 3.1), mismo patrón que
   * `expensesStore.fetchFiltered` pero sobre `income_date`. Método NUEVO, no
   * toca la lista maestra `incomes` (que sigue sirviendo a `HomeView`).
   * Devuelve `null` si falló. */
  async function fetchFiltered(filter: DateAccountFilter, limit = MAX_INCOMES): Promise<IncomeWithAccount[] | null> {
    let query = supabase
      .from('incomes')
      .select('*, account:accounts(*)')
      .order('income_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit)

    if (filter.from) query = query.gte('income_date', filter.from)
    if (filter.to) query = query.lt('income_date', filter.to)
    if (filter.accountId) query = query.eq('account_id', filter.accountId)

    const { data, error: fetchError } = await query
    if (fetchError) {
      console.error('[incomes] No se pudieron cargar los movimientos filtrados', fetchError)
      return null
    }
    return (data ?? []) as unknown as IncomeWithAccount[]
  }

  function replaceById(id: string, next: IncomeWithAccount) {
    const idx = incomes.value.findIndex(income => income.id === id)
    if (idx === -1) return
    const nextList = [...incomes.value]
    nextList.splice(idx, 1, next)
    incomes.value = sortIncomes(nextList)
  }

  /** transactions-filters-ux.md sección 3.5: sincroniza `ref`s locales que la
   * vista pasa como `targets`, además de la lista maestra `incomes` — mismo
   * mecanismo que `expensesStore.replaceInTargets`. `HomeView`/
   * `AccountDetailView` no pasan ninguno y siguen mutando solo la lista
   * maestra. */
  function replaceInTargets(targets: Ref<IncomeWithAccount[]>[], id: string, next: IncomeWithAccount) {
    for (const target of targets) {
      const idx = target.value.findIndex(income => income.id === id)
      if (idx === -1) continue
      const list = [...target.value]
      list.splice(idx, 1, next)
      target.value = sortIncomes(list)
    }
  }

  /** Alta optimista, mismo criterio que `expenses.ts` (`addExpense`): la
   * mutación local es síncrona para que el Sheet pueda cerrarse de
   * inmediato. */
  function addIncome(payload: IncomePayload, targets: Ref<IncomeWithAccount[]>[] = []): void {
    const accountsStore = useAccountsStore()
    const account = accountsStore.accountById(payload.accountId)
    const authStore = useAuthStore()
    const userId = authStore.user?.id

    if (!account || !userId) {
      toast.error('No se pudo guardar el ingreso', {
        description: 'Revisá tu conexión e intentá de nuevo.',
      })
      return
    }

    const tempId = `temp-${crypto.randomUUID()}`
    const nowIso = new Date().toISOString()
    const optimistic: IncomeWithAccount = {
      id: tempId,
      amount: payload.amount,
      account_id: payload.accountId,
      description: payload.description,
      income_date: payload.incomeDate,
      user_id: userId,
      created_at: nowIso,
      updated_at: nowIso,
      account,
      _pending: true,
    }

    incomes.value = sortIncomes([optimistic, ...incomes.value])
    for (const target of targets) target.value = sortIncomes([optimistic, ...target.value])
    // Sección 1: el saldo mostrado se actualiza de forma optimista sumando
    // el monto al saldo ya cargado de `account_balances` — sigue sin
    // derivarse nunca de esta lista capada, solo se ajusta el número que ya
    // vino del servidor para que el grid de cuentas se sienta "vivo".
    accountsStore.adjustBalance(payload.accountId, payload.amount)

    const persist = async (): Promise<void> => {
      const { data, error: insertError } = await supabase
        .from('incomes')
        .insert({
          amount: payload.amount,
          account_id: payload.accountId,
          description: payload.description,
          income_date: payload.incomeDate,
          user_id: userId,
        })
        .select('*, account:accounts(*)')
        .single()

      if (insertError || !data) {
        incomes.value = incomes.value.filter(income => income.id !== tempId)
        for (const target of targets) target.value = target.value.filter(income => income.id !== tempId)
        accountsStore.adjustBalance(payload.accountId, -payload.amount)
        toast.error('No se pudo guardar el ingreso', {
          description: 'Revisá tu conexión e intentá de nuevo.',
          action: {
            label: 'Reintentar',
            onClick: () => {
              incomes.value = sortIncomes([optimistic, ...incomes.value])
              for (const target of targets) target.value = sortIncomes([optimistic, ...target.value])
              accountsStore.adjustBalance(payload.accountId, payload.amount)
              void persist()
            },
          },
        })
        return
      }

      replaceById(tempId, data as unknown as IncomeWithAccount)
      replaceInTargets(targets, tempId, data as unknown as IncomeWithAccount)
      toast.success('Ingreso agregado', {
        description: `$${formatAmount(payload.amount)} en ${account.name}`,
      })
    }

    void persist()
  }

  /** Edición optimista, mismo patrón que `updateExpense`. */
  function updateIncome(id: string, payload: IncomePayload, targets: Ref<IncomeWithAccount[]>[] = []): void {
    const accountsStore = useAccountsStore()
    const previous = incomes.value.find(income => income.id === id)
      ?? targets.map(t => t.value.find(income => income.id === id)).find(Boolean)
    const account = accountsStore.accountById(payload.accountId)
    if (!previous || !account) return

    const optimistic: IncomeWithAccount = {
      ...previous,
      amount: payload.amount,
      account_id: payload.accountId,
      description: payload.description,
      income_date: payload.incomeDate,
      account,
      _pending: true,
    }

    replaceById(id, optimistic)
    replaceInTargets(targets, id, optimistic)
    // Ajuste optimista del saldo: revierte el monto anterior de la cuenta
    // vieja y aplica el nuevo a la cuenta (posiblemente distinta) elegida —
    // mismo criterio de "no derivar, solo ajustar el número ya cargado del
    // servidor" que en `addIncome`.
    accountsStore.adjustBalance(previous.account_id, -previous.amount)
    accountsStore.adjustBalance(payload.accountId, payload.amount)

    const persist = async (): Promise<void> => {
      const { data, error: updateError } = await supabase
        .from('incomes')
        .update({
          amount: payload.amount,
          account_id: payload.accountId,
          description: payload.description,
          income_date: payload.incomeDate,
        })
        .eq('id', id)
        .select('*, account:accounts(*)')
        .single()

      if (updateError || !data) {
        replaceById(id, previous)
        replaceInTargets(targets, id, previous)
        accountsStore.adjustBalance(payload.accountId, -payload.amount)
        accountsStore.adjustBalance(previous.account_id, previous.amount)
        toast.error('No se pudieron guardar los cambios', {
          description: 'Revisá tu conexión e intentá de nuevo.',
          action: {
            label: 'Reintentar',
            onClick: () => {
              replaceById(id, optimistic)
              replaceInTargets(targets, id, optimistic)
              void persist()
            },
          },
        })
        return
      }

      replaceById(id, data as unknown as IncomeWithAccount)
      replaceInTargets(targets, id, data as unknown as IncomeWithAccount)
      toast.success('Cambios guardados')
    }

    void persist()
  }

  /** Eliminación optimista, mismo patrón que `deleteExpense`. */
  function deleteIncome(id: string, targets: Ref<IncomeWithAccount[]>[] = []): void {
    const accountsStore = useAccountsStore()
    const removed = incomes.value.find(income => income.id === id)
      ?? targets.map(t => t.value.find(income => income.id === id)).find(Boolean)
    if (!removed) return

    incomes.value = incomes.value.filter(income => income.id !== id)
    for (const target of targets) target.value = target.value.filter(income => income.id !== id)
    accountsStore.adjustBalance(removed.account_id, -removed.amount)

    const persist = async (): Promise<void> => {
      const { error: deleteError } = await supabase.from('incomes').delete().eq('id', id)

      if (deleteError) {
        incomes.value = sortIncomes([...incomes.value, removed])
        for (const target of targets) target.value = sortIncomes([...target.value, removed])
        accountsStore.adjustBalance(removed.account_id, removed.amount)
        toast.error('No se pudo eliminar el ingreso', {
          description: 'Revisá tu conexión e intentá de nuevo.',
          action: {
            label: 'Reintentar',
            onClick: () => {
              incomes.value = incomes.value.filter(income => income.id !== id)
              for (const target of targets) target.value = target.value.filter(income => income.id !== id)
              accountsStore.adjustBalance(removed.account_id, -removed.amount)
              void persist()
            },
          },
        })
        return
      }

      toast.success('Ingreso eliminado')
    }

    void persist()
  }

  return {
    incomes,
    isLoading,
    error,
    fetchAll,
    fetchRecentForAccount,
    fetchFiltered,
    addIncome,
    updateIncome,
    deleteIncome,
  }
})
