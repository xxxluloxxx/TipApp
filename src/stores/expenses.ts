import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { formatAmount } from '@/lib/currency'
import { supabase } from '@/lib/supabase'
import { useAccountsStore } from '@/stores/accounts'
import { useAuthStore } from '@/stores/auth'
import { useCategoriesStore } from '@/stores/categories'
import type { Category } from '@/stores/categories'
import type { Tables } from '@/types/database.types'

export type { Category } from '@/stores/categories'

export type ExpenseWithCategory = Tables<'expenses'> & {
  category: Category
  /** Marca local "insertado/editado optimistamente, esperando confirmación
   * del servidor" (sección 3.8). No existe como columna real. */
  _pending?: boolean
}

export interface ExpensePayload {
  amount: number
  categoryId: string
  /** accounts-income-ux.md sección 8: todo gasto pertenece a una cuenta
   * (`expenses.account_id NOT NULL`) — campo nuevo, tan obligatorio como
   * `categoryId`. */
  accountId: string
  description: string | null
  expenseDate: string
}

// Límite defensivo (sección 2.3 de expenses-mvp-ux.md): sin paginación en
// esta iteración.
export const MAX_EXPENSES = 200

/** expense_date desc, created_at desc (sección 2.3). */
function sortExpenses(list: ExpenseWithCategory[]): ExpenseWithCategory[] {
  return [...list].sort((a, b) => {
    if (a.expense_date !== b.expense_date) {
      return a.expense_date < b.expense_date ? 1 : -1
    }
    return a.created_at < b.created_at ? 1 : -1
  })
}

export const useExpensesStore = defineStore('expenses', () => {
  const expenses = ref<ExpenseWithCategory[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // Sección 2.2: total del mes calendario en curso, derivado de la misma
  // lista que ya se trae para el listado. Al ser `computed`, se actualiza
  // solo con cada insert/update/delete optimista (y su rollback) sin lógica
  // adicional (sección 3.8, punto 6).
  const monthTotal = computed(() => {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    return expenses.value.reduce((sum, expense) => {
      const [expenseYear, expenseMonth] = expense.expense_date.split('-').map(Number)
      return expenseYear === year && expenseMonth === month ? sum + expense.amount : sum
    }, 0)
  })

  async function fetchAll(): Promise<void> {
    isLoading.value = true
    error.value = null

    const { data, error: fetchError } = await supabase
      .from('expenses')
      .select('*, category:categories(*)')
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(MAX_EXPENSES)

    if (fetchError) {
      error.value = fetchError.message
      isLoading.value = false
      return
    }

    expenses.value = (data ?? []) as unknown as ExpenseWithCategory[]
    isLoading.value = false
  }

  /** Movimientos recientes de UNA cuenta (account-detail-ux.md sección 7.1):
   * fetch propio acotado por cuenta y ordenado por fecha desc, mismo patrón
   * que `cardExpensesStore.fetchRecentForCard`. NO toca la lista maestra
   * `expenses` — devuelve su propio resultado para que la vista lo guarde en
   * un `ref` local (la lista global está capada a `MAX_EXPENSES` del usuario
   * completo, filtrarla en cliente por cuenta podría subcontar). Devuelve
   * `null` si falló (el caller decide cómo mostrarlo), nunca lanza. */
  async function fetchRecentForAccount(accountId: string, limit = 10): Promise<ExpenseWithCategory[] | null> {
    const { data, error: fetchError } = await supabase
      .from('expenses')
      .select('*, category:categories(*)')
      .eq('account_id', accountId)
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit)

    if (fetchError) {
      console.error('[expenses] No se pudieron cargar los movimientos recientes de la cuenta', fetchError)
      return null
    }

    return (data ?? []) as unknown as ExpenseWithCategory[]
  }

  function replaceById(id: string, next: ExpenseWithCategory) {
    const idx = expenses.value.findIndex(expense => expense.id === id)
    if (idx === -1) return
    const nextList = [...expenses.value]
    nextList.splice(idx, 1, next)
    expenses.value = sortExpenses(nextList)
  }

  /** Alta optimista (sección 3.8). No es async a propósito: la mutación
   * local es síncrona, así el Sheet puede cerrarse inmediatamente después
   * de llamarla; la confirmación/rollback contra Supabase sigue en segundo
   * plano y se resuelve vía toast. */
  function addExpense(payload: ExpensePayload): void {
    const categoriesStore = useCategoriesStore()
    const accountsStore = useAccountsStore()
    const category = categoriesStore.categoryById(payload.categoryId)
    const authStore = useAuthStore()
    const userId = authStore.user?.id

    if (!category || !userId) {
      toast.error('No se pudo guardar el gasto', {
        description: 'Revisá tu conexión e intentá de nuevo.',
      })
      return
    }

    const tempId = `temp-${crypto.randomUUID()}`
    const nowIso = new Date().toISOString()
    const optimistic: ExpenseWithCategory = {
      id: tempId,
      amount: payload.amount,
      category_id: payload.categoryId,
      account_id: payload.accountId,
      description: payload.description,
      expense_date: payload.expenseDate,
      user_id: userId,
      created_at: nowIso,
      updated_at: nowIso,
      category,
      _pending: true,
    }

    expenses.value = sortExpenses([optimistic, ...expenses.value])
    // Sección 1 de accounts-income-ux.md: un gasto reduce el saldo de su
    // cuenta. El saldo real sigue viniendo de `account_balances`; esto solo
    // ajusta el número ya cargado para que "Mis cuentas" se sienta "vivo".
    accountsStore.adjustBalance(payload.accountId, -payload.amount)

    const persist = async (): Promise<void> => {
      const { data, error: insertError } = await supabase
        .from('expenses')
        .insert({
          amount: payload.amount,
          category_id: payload.categoryId,
          account_id: payload.accountId,
          description: payload.description,
          expense_date: payload.expenseDate,
          user_id: userId,
        })
        .select('*, category:categories(*)')
        .single()

      if (insertError || !data) {
        expenses.value = expenses.value.filter(expense => expense.id !== tempId)
        accountsStore.adjustBalance(payload.accountId, payload.amount)
        toast.error('No se pudo guardar el gasto', {
          description: 'Revisá tu conexión e intentá de nuevo.',
          action: {
            label: 'Reintentar',
            onClick: () => {
              expenses.value = sortExpenses([optimistic, ...expenses.value])
              accountsStore.adjustBalance(payload.accountId, -payload.amount)
              void persist()
            },
          },
        })
        return
      }

      replaceById(tempId, data as unknown as ExpenseWithCategory)
      toast.success('Gasto agregado', {
        description: `$${formatAmount(payload.amount)} en ${category.name}`,
      })
    }

    void persist()
  }

  /** Edición optimista (sección 3.9): mismo patrón que `addExpense`, con
   * rollback al valor previo si falla el `update()`. */
  function updateExpense(id: string, payload: ExpensePayload): void {
    const categoriesStore = useCategoriesStore()
    const accountsStore = useAccountsStore()
    const previous = expenses.value.find(expense => expense.id === id)
    const category = categoriesStore.categoryById(payload.categoryId)
    if (!previous || !category) return

    const optimistic: ExpenseWithCategory = {
      ...previous,
      amount: payload.amount,
      category_id: payload.categoryId,
      account_id: payload.accountId,
      description: payload.description,
      expense_date: payload.expenseDate,
      category,
      _pending: true,
    }

    replaceById(id, optimistic)
    // Revierte el impacto del monto/cuenta anteriores y aplica el nuevo
    // (posiblemente una cuenta distinta), mismo criterio que
    // `incomesStore.updateIncome`.
    accountsStore.adjustBalance(previous.account_id, previous.amount)
    accountsStore.adjustBalance(payload.accountId, -payload.amount)

    const persist = async (): Promise<void> => {
      const { data, error: updateError } = await supabase
        .from('expenses')
        .update({
          amount: payload.amount,
          category_id: payload.categoryId,
          account_id: payload.accountId,
          description: payload.description,
          expense_date: payload.expenseDate,
        })
        .eq('id', id)
        .select('*, category:categories(*)')
        .single()

      if (updateError || !data) {
        replaceById(id, previous)
        accountsStore.adjustBalance(payload.accountId, payload.amount)
        accountsStore.adjustBalance(previous.account_id, -previous.amount)
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

      replaceById(id, data as unknown as ExpenseWithCategory)
      toast.success('Cambios guardados')
    }

    void persist()
  }

  /** Eliminación optimista (referenciada en sección 3.9 como ya resuelta
   * por el design system: AlertDialog de confirmación + remover de la
   * lista local, con rollback si falla). */
  function deleteExpense(id: string): void {
    const accountsStore = useAccountsStore()
    const removed = expenses.value.find(expense => expense.id === id)
    if (!removed) return

    expenses.value = expenses.value.filter(expense => expense.id !== id)
    accountsStore.adjustBalance(removed.account_id, removed.amount)

    const persist = async (): Promise<void> => {
      const { error: deleteError } = await supabase.from('expenses').delete().eq('id', id)

      if (deleteError) {
        expenses.value = sortExpenses([...expenses.value, removed])
        accountsStore.adjustBalance(removed.account_id, -removed.amount)
        toast.error('No se pudo eliminar el gasto', {
          description: 'Revisá tu conexión e intentá de nuevo.',
          action: {
            label: 'Reintentar',
            onClick: () => {
              expenses.value = expenses.value.filter(expense => expense.id !== id)
              accountsStore.adjustBalance(removed.account_id, removed.amount)
              void persist()
            },
          },
        })
        return
      }

      toast.success('Gasto eliminado')
    }

    void persist()
  }

  return {
    expenses,
    monthTotal,
    isLoading,
    error,
    fetchAll,
    fetchRecentForAccount,
    addExpense,
    updateExpense,
    deleteExpense,
  }
})
