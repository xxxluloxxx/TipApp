import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import type { Tables } from '@/types/database.types'

export type CreditCard = Tables<'credit_cards'>

export interface CreditCardPayload {
  name: string
  lastFourDigits: string
  color: string
  suggestedMonthlyLimit: number | null
}

/**
 * Store de tarjetas de crédito propias del usuario (credit-cards-ux.md,
 * secciones 1.3 y 6.2). A diferencia de `categories.ts`, acá alta/edición SÍ
 * son 100% optimistas: no hay ningún índice único conocido sobre
 * `credit_cards.name` (el doc no describe ningún conflicto server-only en el
 * camino feliz), así que se sigue el mismo patrón de `expenses.ts` en vez del
 * de `categories.ts`.
 */
export const useCreditCardsStore = defineStore('creditCards', () => {
  const cards = ref<CreditCard[]>([])
  /** Conteo all-time de `card_expenses` por tarjeta (sección 1.3), usado para
   * deshabilitar "Eliminar" de antemano en la gestión (sección 6.2). */
  const expenseCounts = ref<Record<string, number>>({})

  const sortedCards = computed(() => [...cards.value].sort((a, b) => a.name.localeCompare(b.name, 'es')))

  function cardById(id: string): CreditCard | undefined {
    return cards.value.find(card => card.id === id)
  }

  function countFor(id: string): number {
    return expenseCounts.value[id] ?? 0
  }

  async function fetchCards(): Promise<boolean> {
    const { data, error: fetchError } = await supabase.from('credit_cards').select('*')

    if (fetchError) {
      console.error('[creditCards] No se pudieron cargar las tarjetas', fetchError)
      return false
    }

    cards.value = data ?? []
    return true
  }

  /** Mismo mecanismo exacto que `categories.ts` (`fetchExpenseCounts`): un
   * único query agregado embebido de PostgREST, all-time (sección 1.3 de
   * credit-cards-ux.md: el borrado debe seguir bloqueado aunque el gasto
   * asociado sea viejo). */
  async function fetchExpenseCounts(): Promise<boolean> {
    const authStore = useAuthStore()
    const userId = authStore.user?.id
    if (!userId) {
      expenseCounts.value = {}
      return true
    }

    const { data, error: fetchError } = await supabase
      .from('credit_cards')
      .select('id, card_expenses(count)')
      .eq('user_id', userId)

    if (fetchError) {
      console.error('[creditCards] No se pudieron cargar los conteos de uso', fetchError)
      return false
    }

    const counts: Record<string, number> = {}
    for (const row of (data ?? []) as unknown as Array<{ id: string, card_expenses: Array<{ count: number }> }>) {
      counts[row.id] = row.card_expenses[0]?.count ?? 0
    }
    expenseCounts.value = counts
    return true
  }

  function replaceById(id: string, next: CreditCard) {
    const idx = cards.value.findIndex(card => card.id === id)
    if (idx === -1) return
    const nextList = [...cards.value]
    nextList.splice(idx, 1, next)
    cards.value = nextList
  }

  /** Alta optimista (sección 6.2): cierre inmediato del Sheet + inserción
   * local + confirmación/rollback con toast "Reintentar", mismo patrón que
   * `expenses.ts`. */
  function addCard(payload: CreditCardPayload): void {
    const authStore = useAuthStore()
    const userId = authStore.user?.id
    if (!userId) {
      toast.error('No se pudo guardar la tarjeta', {
        description: 'Revisá tu conexión e intentá de nuevo.',
      })
      return
    }

    const tempId = `temp-${crypto.randomUUID()}`
    const nowIso = new Date().toISOString()
    const optimistic: CreditCard = {
      id: tempId,
      user_id: userId,
      name: payload.name,
      last_four_digits: payload.lastFourDigits,
      color: payload.color,
      suggested_monthly_limit: payload.suggestedMonthlyLimit,
      created_at: nowIso,
      updated_at: nowIso,
    }

    cards.value = [...cards.value, optimistic]

    const persist = async (): Promise<void> => {
      const { data, error: insertError } = await supabase
        .from('credit_cards')
        .insert({
          name: payload.name,
          last_four_digits: payload.lastFourDigits,
          color: payload.color,
          suggested_monthly_limit: payload.suggestedMonthlyLimit,
          user_id: userId,
        })
        .select('*')
        .single()

      if (insertError || !data) {
        cards.value = cards.value.filter(card => card.id !== tempId)
        toast.error('No se pudo guardar la tarjeta', {
          description: 'Revisá tu conexión e intentá de nuevo.',
          action: {
            label: 'Reintentar',
            onClick: () => {
              cards.value = [...cards.value, optimistic]
              void persist()
            },
          },
        })
        return
      }

      replaceById(tempId, data)
      toast.success('Tarjeta creada')
    }

    void persist()
  }

  /** Edición optimista (sección 6.2), mismo patrón que `updateExpense`. */
  function updateCard(id: string, payload: CreditCardPayload): void {
    const previous = cardById(id)
    if (!previous) return

    const optimistic: CreditCard = {
      ...previous,
      name: payload.name,
      last_four_digits: payload.lastFourDigits,
      color: payload.color,
      suggested_monthly_limit: payload.suggestedMonthlyLimit,
    }

    replaceById(id, optimistic)

    const persist = async (): Promise<void> => {
      const { data, error: updateError } = await supabase
        .from('credit_cards')
        .update({
          name: payload.name,
          last_four_digits: payload.lastFourDigits,
          color: payload.color,
          suggested_monthly_limit: payload.suggestedMonthlyLimit,
        })
        .eq('id', id)
        .select('*')
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

      replaceById(id, data)
      toast.success('Cambios guardados')
    }

    void persist()
  }

  /** Borrado optimista (sección 1.3/6.2): el guard de "tiene gastos
   * asociados" ya se resuelve de antemano vía `countFor`, así que no hay
   * validación server-only esperada en el camino feliz. */
  function deleteCard(id: string): void {
    const removed = cardById(id)
    if (!removed) return

    cards.value = cards.value.filter(card => card.id !== id)

    const persist = async (): Promise<void> => {
      const { error: deleteError } = await supabase.from('credit_cards').delete().eq('id', id)

      if (deleteError) {
        cards.value = [...cards.value, removed]
        toast.error('No se pudo eliminar la tarjeta', {
          description: 'Revisá tu conexión o si tiene gastos asociados.',
        })
        return
      }

      toast.success('Tarjeta eliminada')
    }

    void persist()
  }

  return {
    cards: sortedCards,
    expenseCounts,
    cardById,
    countFor,
    fetchCards,
    fetchExpenseCounts,
    addCard,
    updateCard,
    deleteCard,
  }
})
