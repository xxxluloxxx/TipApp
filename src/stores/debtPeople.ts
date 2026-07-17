import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import type { Tables } from '@/types/database.types'

export type DebtPerson = Tables<'debt_people'>

export interface DebtPersonPayload {
  name: string
  /** `null` = "Sin color" (sección 4.2): opción explícita, no un campo a
   * medio completar. */
  color: string | null
}

/**
 * Store de personas de deuda (debts-ux.md sección 4): mismo patrón exacto que
 * `cardPeople.ts` (alta/edición/borrado 100% optimistas, conteo dedicado
 * all-time para el guard de borrado). Entidad conceptualmente distinta de
 * `card_people` (quién usa una tarjeta adicional no es necesariamente a quién
 * le prestás plata), por eso es un store aparte aunque el código se parezca
 * (decisión explícita del Product Owner). El guard de borrado es más simple
 * que el de `card_people`: un único conteo `debts(count)`, porque esta entidad
 * no tiene ningún otro consumidor (sección 4.3). Sin campo de foto/avatar
 * (fuera de alcance).
 */
export const useDebtPeopleStore = defineStore('debtPeople', () => {
  const people = ref<DebtPerson[]>([])
  const debtCounts = ref<Record<string, number>>({})

  const sortedPeople = computed(() => [...people.value].sort((a, b) => a.name.localeCompare(b.name, 'es')))

  function personById(id: string): DebtPerson | undefined {
    return people.value.find(person => person.id === id)
  }

  function countFor(id: string): number {
    return debtCounts.value[id] ?? 0
  }

  async function fetchPeople(): Promise<boolean> {
    const { data, error: fetchError } = await supabase.from('debt_people').select('*')

    if (fetchError) {
      console.error('[debtPeople] No se pudieron cargar las personas', fetchError)
      return false
    }

    people.value = data ?? []
    return true
  }

  /** Conteo `debts(count)` por persona (sección 4.3), único consumidor de esta
   * entidad — más simple que el de `card_people`, que sí necesita sumar el uso
   * de dos tablas distintas. */
  async function fetchDebtCounts(): Promise<boolean> {
    const authStore = useAuthStore()
    const userId = authStore.user?.id
    if (!userId) {
      debtCounts.value = {}
      return true
    }

    const { data, error: fetchError } = await supabase
      .from('debt_people')
      .select('id, debts(count)')
      .eq('user_id', userId)

    if (fetchError) {
      console.error('[debtPeople] No se pudieron cargar los conteos de uso', fetchError)
      return false
    }

    const counts: Record<string, number> = {}
    for (const row of (data ?? []) as unknown as Array<{
      id: string
      debts: Array<{ count: number }>
    }>) {
      counts[row.id] = row.debts[0]?.count ?? 0
    }
    debtCounts.value = counts
    return true
  }

  function replaceById(id: string, next: DebtPerson) {
    const idx = people.value.findIndex(person => person.id === id)
    if (idx === -1) return
    const nextList = [...people.value]
    nextList.splice(idx, 1, next)
    people.value = nextList
  }

  function addPerson(payload: DebtPersonPayload): void {
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
    const optimistic: DebtPerson = {
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
        .from('debt_people')
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

  function updatePerson(id: string, payload: DebtPersonPayload): void {
    const previous = personById(id)
    if (!previous) return

    const optimistic: DebtPerson = { ...previous, name: payload.name, color: payload.color }
    replaceById(id, optimistic)

    const persist = async (): Promise<void> => {
      const { data, error: updateError } = await supabase
        .from('debt_people')
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
      const { error: deleteError } = await supabase.from('debt_people').delete().eq('id', id)

      if (deleteError) {
        people.value = [...people.value, removed]
        toast.error('No se pudo eliminar la persona', {
          description: 'Revisá tu conexión o si tiene deudas asociadas.',
        })
        return
      }

      toast.success('Persona eliminada')
    }

    void persist()
  }

  return {
    people: sortedPeople,
    debtCounts,
    personById,
    countFor,
    fetchPeople,
    fetchDebtCounts,
    addPerson,
    updatePerson,
    deletePerson,
  }
})
