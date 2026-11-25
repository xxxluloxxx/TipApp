import { defineStore } from 'pinia'
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { supabase } from '@/lib/supabase'
import type { Tables } from '@/types/database.types'

export type CalcDraftSummary = Tables<'calc_draft_summary'>
export type CalcEntry = Tables<'calc_entries'>
export type CalcEntryKind = 'income' | 'expense'

const num = (v: number | null | undefined) => Number(v ?? 0)

/**
 * Calculadora de movimientos: borradores para hacer cuentas. Sin vínculo con
 * cuentas/gastos/ingresos reales. Totales derivados en servidor
 * (`calc_draft_summary`). Mutaciones simples (await + refetch): son filas
 * livianas y no hay ids dependientes que fabricar.
 */
export const useCalcDraftsStore = defineStore('calcDrafts', () => {
  const drafts = ref<CalcDraftSummary[]>([])
  const entries = ref<CalcEntry[]>([])

  async function fetchDrafts(): Promise<boolean> {
    const { data, error } = await supabase
      .from('calc_draft_summary')
      .select('*')
      .order('updated_at', { ascending: false })
    if (error) {
      console.error('[calcDrafts] No se pudieron cargar los borradores', error)
      return false
    }
    drafts.value = data ?? []
    return true
  }

  async function fetchEntries(draftId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('calc_entries')
      .select('*')
      .eq('draft_id', draftId)
      .order('created_at', { ascending: true })
    if (error) {
      console.error('[calcDrafts] No se pudieron cargar los movimientos', error)
      return false
    }
    entries.value = data ?? []
    return true
  }

  function summaryOf(id: string): CalcDraftSummary | undefined {
    return drafts.value.find(d => d.draft_id === id)
  }

  function fail(message: string, error: unknown) {
    console.error('[calcDrafts]', message, error)
    toast.error(message, { description: 'Revisá tu conexión e intentá de nuevo.' })
  }

  async function createDraft(name: string): Promise<string | null> {
    const { data, error } = await supabase
      .from('calc_drafts')
      .insert({ name })
      .select('id')
      .single()
    if (error || !data) {
      fail('No se pudo crear el borrador', error)
      return null
    }
    return data.id
  }

  async function renameDraft(id: string, name: string): Promise<boolean> {
    const { error } = await supabase.from('calc_drafts').update({ name }).eq('id', id)
    if (error) {
      fail('No se pudo renombrar el borrador', error)
      return false
    }
    await fetchDrafts()
    return true
  }

  async function deleteDraft(id: string): Promise<boolean> {
    const { error } = await supabase.from('calc_drafts').delete().eq('id', id)
    if (error) {
      fail('No se pudo eliminar el borrador', error)
      return false
    }
    drafts.value = drafts.value.filter(d => d.draft_id !== id)
    return true
  }

  async function addEntry(
    draftId: string,
    payload: { kind: CalcEntryKind, description: string, amount: number },
  ): Promise<boolean> {
    const { error } = await supabase.from('calc_entries').insert({ draft_id: draftId, ...payload })
    if (error) {
      fail('No se pudo agregar el movimiento', error)
      return false
    }
    await fetchEntries(draftId)
    return true
  }

  async function updateEntry(
    draftId: string,
    id: string,
    payload: { kind: CalcEntryKind, description: string, amount: number },
  ): Promise<boolean> {
    const { error } = await supabase.from('calc_entries').update(payload).eq('id', id)
    if (error) {
      fail('No se pudo guardar el movimiento', error)
      return false
    }
    await fetchEntries(draftId)
    return true
  }

  async function deleteEntry(draftId: string, id: string): Promise<boolean> {
    const { error } = await supabase.from('calc_entries').delete().eq('id', id)
    if (error) {
      fail('No se pudo eliminar el movimiento', error)
      return false
    }
    entries.value = entries.value.filter(e => e.id !== id)
    return true
  }

  return {
    drafts,
    entries,
    fetchDrafts,
    fetchEntries,
    summaryOf,
    createDraft,
    renameDraft,
    deleteDraft,
    addEntry,
    updateEntry,
    deleteEntry,
    num,
  }
})
