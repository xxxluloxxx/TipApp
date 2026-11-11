import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAccountsStore } from '@/stores/accounts'
import { useAccountTransfersStore } from '@/stores/accountTransfers'
import type { Tables } from '@/types/database.types'

export type SavingsPlan = Tables<'savings_plans'>
export type SavingsInstallment = Tables<'savings_plan_installments'>
export type SavingsProgress = Tables<'savings_plan_progress'>

export interface CreateSavingsPlanPayload {
  name: string
  fromAccountId: string
  toAccountId: string
  amount: number
  dayOfMonth: number
  termMonths: number
  /** `YYYY-MM-DD`: el mes de la primera cuota. */
  startDate: string
}

/**
 * Ahorro programado: N cuotas mensuales que mueven un monto fijo de una cuenta
 * a otra. Cada cuota se confirma a mano y genera una transferencia real. Las
 * mutaciones son NO optimistas (RPC atómico que crea plan+cuotas / la
 * transferencia); el avance sale de la vista `savings_plan_progress`.
 */
export const useSavingsPlansStore = defineStore('savingsPlans', () => {
  const plans = ref<SavingsPlan[]>([])
  const progress = ref<Record<string, SavingsProgress>>({})
  const installments = ref<Record<string, SavingsInstallment[]>>({})

  async function fetchAll(): Promise<boolean> {
    const [plansRes, progressRes] = await Promise.all([
      supabase.from('savings_plans').select('*').order('created_at', { ascending: false }),
      supabase.from('savings_plan_progress').select('*'),
    ])
    if (plansRes.error || progressRes.error) {
      console.error('[savingsPlans] No se pudieron cargar los ahorros', plansRes.error ?? progressRes.error)
      return false
    }
    plans.value = plansRes.data ?? []
    progress.value = Object.fromEntries((progressRes.data ?? []).map(row => [row.plan_id as string, row]))
    return true
  }

  async function fetchInstallments(planId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('savings_plan_installments')
      .select('*')
      .eq('plan_id', planId)
      .order('installment_number')
    if (error) {
      console.error('[savingsPlans] No se pudieron cargar las cuotas', error)
      return false
    }
    installments.value = { ...installments.value, [planId]: data ?? [] }
    return true
  }

  async function createPlan(payload: CreateSavingsPlanPayload): Promise<{ id: string } | { error: true }> {
    const { data, error } = await supabase.rpc('create_savings_plan', {
      p_name: payload.name,
      p_from_account_id: payload.fromAccountId,
      p_to_account_id: payload.toAccountId,
      p_amount: payload.amount,
      p_day_of_month: payload.dayOfMonth,
      p_term_months: payload.termMonths,
      p_start_date: payload.startDate,
    })
    if (error || !data) {
      console.error('[savingsPlans] No se pudo crear el ahorro', error)
      return { error: true }
    }
    await fetchAll()
    return { id: data }
  }

  /** Confirma una cuota: crea la transferencia real entre las dos cuentas. */
  async function payInstallment(
    installment: SavingsInstallment,
    transferDate: string,
    transferTime: string | null,
  ): Promise<boolean> {
    const { error } = await supabase.rpc('pay_savings_installment', {
      p_installment_id: installment.id,
      p_transfer_date: transferDate,
      p_transfer_time: transferTime ?? undefined,
    })
    if (error) {
      console.error('[savingsPlans] No se pudo registrar la cuota', error)
      return false
    }
    await Promise.all([
      fetchInstallments(installment.plan_id),
      fetchAll(),
      useAccountsStore().fetchBalances(),
      useAccountTransfersStore().fetchAll(),
    ])
    return true
  }

  /** Marca una cuota como hecha SIN crear transferencia ni tocar saldos
   * (cuotas previas al uso de la app, cuyo descuento ya ocurrió). */
  async function markInstallmentDone(installment: SavingsInstallment): Promise<boolean> {
    const { error } = await supabase.rpc('mark_savings_installment_done', { p_installment_id: installment.id })
    if (error) {
      console.error('[savingsPlans] No se pudo marcar la cuota', error)
      return false
    }
    await Promise.all([fetchInstallments(installment.plan_id), fetchAll()])
    return true
  }

  /** Borra el plan y sus cuotas. Las transferencias ya hechas se conservan. */
  async function deletePlan(planId: string): Promise<boolean> {
    const { error } = await supabase.from('savings_plans').delete().eq('id', planId)
    if (error) {
      console.error('[savingsPlans] No se pudo eliminar el ahorro', error)
      return false
    }
    plans.value = plans.value.filter(plan => plan.id !== planId)
    return true
  }

  return { plans, progress, installments, fetchAll, fetchInstallments, createPlan, payInstallment, markInstallmentDone, deletePlan }
})
