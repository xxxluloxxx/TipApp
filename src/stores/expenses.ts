import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { formatAmount } from '@/lib/currency'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import type { Tables } from '@/types/database.types'

export type Category = Tables<'categories'>

export type ExpenseWithCategory = Tables<'expenses'> & {
  category: Category
  /** Marca local "insertado/editado optimistamente, esperando confirmación
   * del servidor" (sección 3.8). No existe como columna real. */
  _pending?: boolean
}

export interface ExpensePayload {
  amount: number
  categoryId: string
  description: string | null
  expenseDate: string
}

// Límite defensivo (sección 2.3 de expenses-mvp-ux.md): sin paginación en
// esta iteración.
const MAX_EXPENSES = 200

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
  const categories = ref<Category[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // Orden fijo de "Categorías" default: no hay columna sort_order en el
  // schema, así que se asume que el seed las insertó en el orden de la
  // sección 1 del design system (Comida, Transporte, ...) y se preserva ese
  // orden ordenando por created_at asc. Es una asunción del frontend, no
  // algo resuelto por el backend; si el orden de seed cambia, esto habría
  // que revisarlo junto al supabase-backend-expert.
  const defaultCategories = computed(() =>
    [...categories.value]
      .filter(category => category.user_id === null)
      .sort((a, b) => a.created_at.localeCompare(b.created_at)),
  )

  const customCategories = computed(() =>
    [...categories.value]
      .filter(category => category.user_id !== null)
      .sort((a, b) => a.name.localeCompare(b.name, 'es')),
  )

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

  async function fetchCategories(): Promise<void> {
    const { data, error: fetchError } = await supabase
      .from('categories')
      .select('*')

    if (fetchError) {
      console.error('[expenses] No se pudieron cargar las categorías', fetchError)
      return
    }

    categories.value = data ?? []
  }

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

  function categoryById(categoryId: string): Category | undefined {
    return categories.value.find(category => category.id === categoryId)
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
    const category = categoryById(payload.categoryId)
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
      description: payload.description,
      expense_date: payload.expenseDate,
      user_id: userId,
      created_at: nowIso,
      updated_at: nowIso,
      category,
      _pending: true,
    }

    expenses.value = sortExpenses([optimistic, ...expenses.value])

    const persist = async (): Promise<void> => {
      const { data, error: insertError } = await supabase
        .from('expenses')
        .insert({
          amount: payload.amount,
          category_id: payload.categoryId,
          description: payload.description,
          expense_date: payload.expenseDate,
          user_id: userId,
        })
        .select('*, category:categories(*)')
        .single()

      if (insertError || !data) {
        expenses.value = expenses.value.filter(expense => expense.id !== tempId)
        toast.error('No se pudo guardar el gasto', {
          description: 'Revisá tu conexión e intentá de nuevo.',
          action: {
            label: 'Reintentar',
            onClick: () => {
              expenses.value = sortExpenses([optimistic, ...expenses.value])
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
    const previous = expenses.value.find(expense => expense.id === id)
    const category = categoryById(payload.categoryId)
    if (!previous || !category) return

    const optimistic: ExpenseWithCategory = {
      ...previous,
      amount: payload.amount,
      category_id: payload.categoryId,
      description: payload.description,
      expense_date: payload.expenseDate,
      category,
      _pending: true,
    }

    replaceById(id, optimistic)

    const persist = async (): Promise<void> => {
      const { data, error: updateError } = await supabase
        .from('expenses')
        .update({
          amount: payload.amount,
          category_id: payload.categoryId,
          description: payload.description,
          expense_date: payload.expenseDate,
        })
        .eq('id', id)
        .select('*, category:categories(*)')
        .single()

      if (updateError || !data) {
        replaceById(id, previous)
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
    const removed = expenses.value.find(expense => expense.id === id)
    if (!removed) return

    expenses.value = expenses.value.filter(expense => expense.id !== id)

    const persist = async (): Promise<void> => {
      const { error: deleteError } = await supabase.from('expenses').delete().eq('id', id)

      if (deleteError) {
        expenses.value = sortExpenses([...expenses.value, removed])
        toast.error('No se pudo eliminar el gasto', {
          description: 'Revisá tu conexión e intentá de nuevo.',
          action: {
            label: 'Reintentar',
            onClick: () => {
              expenses.value = expenses.value.filter(expense => expense.id !== id)
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
    categories,
    defaultCategories,
    customCategories,
    monthTotal,
    isLoading,
    error,
    fetchAll,
    fetchCategories,
    addExpense,
    updateExpense,
    deleteExpense,
  }
})
