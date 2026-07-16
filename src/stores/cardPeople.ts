import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import type { Tables } from '@/types/database.types'

export type CardPerson = Tables<'card_people'>

export interface CardPersonPayload {
  name: string
  /** `null` = "Sin color" (sección 6.3): opción explícita, no un campo a
   * medio completar. */
  color: string | null
}

/**
 * Store de personas de tarjeta (credit-cards-ux.md sección 6.3): mismo
 * patrón exacto que `creditCards.ts` (alta/edición/borrado 100% optimistas,
 * conteo dedicado all-time para el guard de borrado). Sin campo de foto/
 * avatar (decisión ya tomada por el Product Owner, fuera de alcance).
 */
export const useCardPeopleStore = defineStore('cardPeople', () => {
  const people = ref<CardPerson[]>([])
  const expenseCounts = ref<Record<string, number>>({})

  const sortedPeople = computed(() => [...people.value].sort((a, b) => a.name.localeCompare(b.name, 'es')))

  function personById(id: string): CardPerson | undefined {
    return people.value.find(person => person.id === id)
  }

  function countFor(id: string): number {
    return expenseCounts.value[id] ?? 0
  }

  async function fetchPeople(): Promise<boolean> {
    const { data, error: fetchError } = await supabase.from('card_people').select('*')

    if (fetchError) {
      console.error('[cardPeople] No se pudieron cargar las personas', fetchError)
      return false
    }

    people.value = data ?? []
    return true
  }

  async function fetchExpenseCounts(): Promise<boolean> {
    const authStore = useAuthStore()
    const userId = authStore.user?.id
    if (!userId) {
      expenseCounts.value = {}
      return true
    }

    const { data, error: fetchError } = await supabase
      .from('card_people')
      .select('id, card_expenses(count)')
      .eq('user_id', userId)

    if (fetchError) {
      console.error('[cardPeople] No se pudieron cargar los conteos de uso', fetchError)
      return false
    }

    const counts: Record<string, number> = {}
    for (const row of (data ?? []) as unknown as Array<{ id: string, card_expenses: Array<{ count: number }> }>) {
      counts[row.id] = row.card_expenses[0]?.count ?? 0
    }
    expenseCounts.value = counts
    return true
  }

  function replaceById(id: string, next: CardPerson) {
    const idx = people.value.findIndex(person => person.id === id)
    if (idx === -1) return
    const nextList = [...people.value]
    nextList.splice(idx, 1, next)
    people.value = nextList
  }

  function addPerson(payload: CardPersonPayload): void {
    const authStore = useAuthStore()
    const userId = authStore.user?.id
    if (!userId) {
      toast.error('No se pudo guardar la persona', {
        description: 'Revisá tu conexión e intentá de nuevo.',
      })
      return
    }

    const tempId = `temp-${crypto.randomUUID()}`
    const nowIso = new Date().toISOString()
    const optimistic: CardPerson = {
      id: tempId,
      user_id: userId,
      name: payload.name,
      color: payload.color,
      created_at: nowIso,
      updated_at: nowIso,
    }

    people.value = [...people.value, optimistic]

    const persist = async (): Promise<void> => {
      const { data, error: insertError } = await supabase
        .from('card_people')
        .insert({ name: payload.name, color: payload.color, user_id: userId })
        .select('*')
        .single()

      if (insertError || !data) {
        people.value = people.value.filter(person => person.id !== tempId)
        toast.error('No se pudo guardar la persona', {
          description: 'Revisá tu conexión e intentá de nuevo.',
          action: {
            label: 'Reintentar',
            onClick: () => {
              people.value = [...people.value, optimistic]
              void persist()
            },
          },
        })
        return
      }

      replaceById(tempId, data)
      toast.success('Persona creada')
    }

    void persist()
  }

  function updatePerson(id: string, payload: CardPersonPayload): void {
    const previous = personById(id)
    if (!previous) return

    const optimistic: CardPerson = { ...previous, name: payload.name, color: payload.color }
    replaceById(id, optimistic)

    const persist = async (): Promise<void> => {
      const { data, error: updateError } = await supabase
        .from('card_people')
        .update({ name: payload.name, color: payload.color })
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

  function deletePerson(id: string): void {
    const removed = personById(id)
    if (!removed) return

    people.value = people.value.filter(person => person.id !== id)

    const persist = async (): Promise<void> => {
      const { error: deleteError } = await supabase.from('card_people').delete().eq('id', id)

      if (deleteError) {
        people.value = [...people.value, removed]
        toast.error('No se pudo eliminar la persona', {
          description: 'Revisá tu conexión o si tiene gastos asociados.',
        })
        return
      }

      toast.success('Persona eliminada')
    }

    void persist()
  }

  return {
    people: sortedPeople,
    expenseCounts,
    personById,
    countFor,
    fetchPeople,
    fetchExpenseCounts,
    addPerson,
    updatePerson,
    deletePerson,
  }
})
