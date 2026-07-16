import { defineStore } from 'pinia'
import { toast } from 'vue-sonner'
import type { Ref } from 'vue'
import { formatAmount } from '@/lib/currency'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { useCreditCardsStore, type CreditCard } from '@/stores/creditCards'
import { useCardPeopleStore, type CardPerson } from '@/stores/cardPeople'
import type { Tables } from '@/types/database.types'

export type CardExpense = Tables<'card_expenses'>

export type CardExpenseWithRelations = CardExpense & {
  card: CreditCard
  person: CardPerson | null
  /** Marca local "insertado/editado optimistamente, esperando confirmación
   * del servidor" (mismo criterio que `ExpenseWithCategory._pending`). */
  _pending?: boolean
}

export interface CardExpensePayload {
  cardId: string
  personId: string | null
  description: string | null
  expenseDate: string
  amount: number
  installmentNumber: number | null
  installmentTotal: number | null
  notes: string | null
}

export interface CardExpenseDateFilter {
  /** `expense_date >= from` (inclusive, `YYYY-MM-DD`). */
  from: string
  /** `expense_date < to` (exclusivo, `YYYY-MM-DD`). */
  to: string
  cardId?: string
  /** `'none'` filtra explícitamente "sin persona asignada" (`person_id IS
   * NULL`), a diferencia de `undefined` que no filtra por persona. */
  personId?: string | 'none'
}

// Red de seguridad defensiva (sección 1.4 de credit-cards-ux.md): el filtro
// de fecha obligatorio ya acota correctamente cada query, este límite no es
// el mecanismo real de corrección — si algún día se golpea, es señal de
// revisar el supuesto de escala ("un mes de un usuario personal"), no una
// forma válida de truncar un mes en silencio.
const SAFETY_LIMIT = 1000

const RELATIONS_SELECT = '*, card:credit_cards(*), person:card_people(*)'

function sortDesc(list: CardExpenseWithRelations[]): CardExpenseWithRelations[] {
  return [...list].sort((a, b) => {
    if (a.expense_date !== b.expense_date) {
      return a.expense_date < b.expense_date ? 1 : -1
    }
    return a.created_at < b.created_at ? 1 : -1
  })
}

/**
 * Store de `card_expenses` (credit-cards-ux.md sección 1). A diferencia de
 * `expenses.ts`, **no mantiene una lista maestra completa en memoria**: cada
 * vista pide exactamente los datos que necesita (rango de fecha obligatorio
 * vía `gte`/`lt`, o una consulta chica con propósito explícito como "los
 * últimos 5") y guarda el resultado en su propio `ref` local. Las funciones
 * de mutación (alta/edición/borrado) son optimistas y reciben como parámetro
 * los `ref`s locales de la vista que deben mantenerse sincronizados
 * (`syncTargets`) — normalmente uno solo, o dos en el caso de
 * `CardDetailView` (el listado del mes + "movimientos recientes"), ya que
 * solo una vista de tarjetas está montada a la vez.
 */
export const useCardExpensesStore = defineStore('cardExpenses', () => {
  const creditCardsStore = useCreditCardsStore()
  const cardPeopleStore = useCardPeopleStore()

  /** Query acotada por rango de fecha (+ tarjeta/persona opcionales),
   * sección 1.2/3.1. Usada por el dashboard (mes vigente y mes anterior, dos
   * llamadas independientes) y por "Transacciones por tarjeta". Devuelve
   * `null` si falló (el caller decide cómo mostrarlo), nunca lanza. */
  async function fetchByDateRange(filter: CardExpenseDateFilter): Promise<CardExpenseWithRelations[] | null> {
    let query = supabase
      .from('card_expenses')
      .select(RELATIONS_SELECT)
      .gte('expense_date', filter.from)
      .lt('expense_date', filter.to)
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(SAFETY_LIMIT)

    if (filter.cardId) query = query.eq('card_id', filter.cardId)
    if (filter.personId === 'none') {
      query = query.is('person_id', null)
    } else if (filter.personId) {
      query = query.eq('person_id', filter.personId)
    }

    const { data, error: fetchError } = await query

    if (fetchError) {
      console.error('[cardExpenses] No se pudieron cargar los gastos de tarjeta', fetchError)
      return null
    }

    return (data ?? []) as unknown as CardExpenseWithRelations[]
  }

  /** "Movimientos recientes" de una tarjeta (sección 4.3): sin filtro de
   * mes a propósito (es una noción de actualidad, no de mes calendario). El
   * `limit(5)` acá es seguro porque el propósito es literalmente "los
   * últimos 5", no una lista que se pretenda completa. */
  async function fetchRecentForCard(cardId: string, limit = 5): Promise<CardExpenseWithRelations[] | null> {
    const { data, error: fetchError } = await supabase
      .from('card_expenses')
      .select(RELATIONS_SELECT)
      .eq('card_id', cardId)
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit)

    if (fetchError) {
      console.error('[cardExpenses] No se pudieron cargar los movimientos recientes', fetchError)
      return null
    }

    return (data ?? []) as unknown as CardExpenseWithRelations[]
  }

  function replaceInTargets(targets: Ref<CardExpenseWithRelations[]>[], id: string, next: CardExpenseWithRelations) {
    for (const target of targets) {
      const idx = target.value.findIndex(expense => expense.id === id)
      if (idx === -1) continue
      const list = [...target.value]
      list.splice(idx, 1, next)
      target.value = sortDesc(list)
    }
  }

  /** Alta optimista (sección 5.4): a diferencia de `CategoryFormSheet`, acá
   * no hay ninguna restricción server-only conocida (monto/tarjeta/cuotas se
   * validan 100% en cliente), así que se sigue el patrón de
   * `ExpenseFormSheet`/`expenses.ts`. */
  function addExpense(payload: CardExpensePayload, targets: Ref<CardExpenseWithRelations[]>[] = []): void {
    const authStore = useAuthStore()
    const userId = authStore.user?.id
    const card = creditCardsStore.cardById(payload.cardId)

    if (!userId || !card) {
      toast.error('No se pudo guardar el gasto', {
        description: 'Revisá tu conexión e intentá de nuevo.',
      })
      return
    }

    const person = payload.personId ? (cardPeopleStore.personById(payload.personId) ?? null) : null
    const tempId = `temp-${crypto.randomUUID()}`
    const nowIso = new Date().toISOString()
    const optimistic: CardExpenseWithRelations = {
      id: tempId,
      user_id: userId,
      card_id: payload.cardId,
      person_id: payload.personId,
      description: payload.description,
      expense_date: payload.expenseDate,
      amount: payload.amount,
      installment_number: payload.installmentNumber,
      installment_total: payload.installmentTotal,
      notes: payload.notes,
      created_at: nowIso,
      updated_at: nowIso,
      card,
      person,
      _pending: true,
    }

    for (const target of targets) target.value = sortDesc([optimistic, ...target.value])

    const persist = async (): Promise<void> => {
      const { data, error: insertError } = await supabase
        .from('card_expenses')
        .insert({
          card_id: payload.cardId,
          person_id: payload.personId,
          description: payload.description,
          expense_date: payload.expenseDate,
          amount: payload.amount,
          installment_number: payload.installmentNumber,
          installment_total: payload.installmentTotal,
          notes: payload.notes,
          user_id: userId,
        })
        .select(RELATIONS_SELECT)
        .single()

      if (insertError || !data) {
        for (const target of targets) target.value = target.value.filter(expense => expense.id !== tempId)
        toast.error('No se pudo guardar el gasto', {
          description: 'Revisá tu conexión e intentá de nuevo.',
          action: {
            label: 'Reintentar',
            onClick: () => {
              for (const target of targets) target.value = sortDesc([optimistic, ...target.value])
              void persist()
            },
          },
        })
        return
      }

      const confirmed = data as unknown as CardExpenseWithRelations
      replaceInTargets(targets, tempId, confirmed)
      toast.success('Gasto agregado', {
        description: `$${formatAmount(payload.amount)} en ${card.name}`,
      })
    }

    void persist()
  }

  /** Edición optimista (sección 5.4), mismo patrón que `addExpense`. */
  function updateExpense(id: string, payload: CardExpensePayload, targets: Ref<CardExpenseWithRelations[]>[] = []): void {
    const card = creditCardsStore.cardById(payload.cardId)
    if (!card) return

    let previous: CardExpenseWithRelations | undefined
    for (const target of targets) {
      previous = target.value.find(expense => expense.id === id)
      if (previous) break
    }
    if (!previous) return

    const person = payload.personId ? (cardPeopleStore.personById(payload.personId) ?? null) : null
    const optimistic: CardExpenseWithRelations = {
      ...previous,
      card_id: payload.cardId,
      person_id: payload.personId,
      description: payload.description,
      expense_date: payload.expenseDate,
      amount: payload.amount,
      installment_number: payload.installmentNumber,
      installment_total: payload.installmentTotal,
      notes: payload.notes,
      card,
      person,
      _pending: true,
    }

    replaceInTargets(targets, id, optimistic)

    const persist = async (): Promise<void> => {
      const { data, error: updateError } = await supabase
        .from('card_expenses')
        .update({
          card_id: payload.cardId,
          person_id: payload.personId,
          description: payload.description,
          expense_date: payload.expenseDate,
          amount: payload.amount,
          installment_number: payload.installmentNumber,
          installment_total: payload.installmentTotal,
          notes: payload.notes,
        })
        .eq('id', id)
        .select(RELATIONS_SELECT)
        .single()

      if (updateError || !data) {
        replaceInTargets(targets, id, previous!)
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

      const confirmed = data as unknown as CardExpenseWithRelations
      replaceInTargets(targets, id, confirmed)
      toast.success('Cambios guardados')
    }

    void persist()
  }

  /** Borrado optimista (sección 5.4/AlertDialog en las vistas). */
  function deleteExpense(id: string, targets: Ref<CardExpenseWithRelations[]>[] = []): void {
    let removed: CardExpenseWithRelations | undefined
    for (const target of targets) {
      removed = target.value.find(expense => expense.id === id)
      if (removed) break
    }
    if (!removed) return

    for (const target of targets) target.value = target.value.filter(expense => expense.id !== id)

    const persist = async (): Promise<void> => {
      const { error: deleteError } = await supabase.from('card_expenses').delete().eq('id', id)

      if (deleteError) {
        for (const target of targets) target.value = sortDesc([...target.value, removed!])
        toast.error('No se pudo eliminar el gasto', {
          description: 'Revisá tu conexión e intentá de nuevo.',
          action: {
            label: 'Reintentar',
            onClick: () => {
              for (const target of targets) target.value = target.value.filter(expense => expense.id !== id)
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
    fetchByDateRange,
    fetchRecentForCard,
    addExpense,
    updateExpense,
    deleteExpense,
  }
})
