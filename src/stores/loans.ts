import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { useDebtPeopleStore } from '@/stores/debtPeople'
import type { Tables } from '@/types/database.types'

export type Loan = Tables<'loans'>
export type LoanInstallment = Tables<'loan_installments'>
export type LoanDebtor = Tables<'loan_debtors'>
// Vistas (loans-ux.md sección 1.2): estado/saldo SIEMPRE derivado server-side,
// nunca resumido en cliente. Sus filas llegan con todas las columnas nullable
// (así las tipa el generador de Supabase), se coercen a un valor concreto al
// construir los view-models.
export type LoanProgress = Tables<'loan_progress'>
export type LoanDebtorBalance = Tables<'loan_debtor_balances'>
export type LoansSummary = Tables<'loans_summary'>

/** Estado de un préstamo completo (sección 2.2/9.1). Derivado en cliente a
 * partir de los booleanos ya resueltos server-side (`has_overdue`/
 * `is_completed`) — `overdue` tiene precedencia sobre `completed`. */
export type LoanBadgeStatus = 'current' | 'overdue' | 'completed'

/** Estado visual de una cuota individual (sección 5.3/9.2). `overdue` es una
 * derivación trivial de cliente (`due_date < hoy` sobre una cuota pendiente),
 * mismo criterio que el "Vencido" por cuota de Gastos fijos. */
export type LoanInstallmentDisplayStatus = 'pending' | 'overdue' | 'paid'

/** Fila de persona deudora lista para renderizar (secciones 5.2/5.4): combina
 * `loan_debtor_balances` (saldo ya derivado) con el nombre/color resuelto
 * contra `debtPeopleStore` (misma reutilización de identidad que Deudas). */
export interface LoanDebtorItem {
  loanDebtorId: string
  loanId: string
  debtPersonId: string
  person: { name: string, color: string | null }
  amountAssigned: number
  amountReceived: number
  balanceRemaining: number
  lastPaymentDate: string | null
  /** `true` si esta persona ya tiene al menos un pago recibido — se deriva de
   * `last_payment_date != null` (no hace falta un conteo dedicado aparte: la
   * vista `loan_debtor_balances` ya expone la fecha del último pago, que es
   * `null` exactamente cuando no hay ninguno). Alimenta el guard de "Quitar
   * del préstamo" (sección 5.4). */
  hasPayments: boolean
}

/** Préstamo listo para renderizar (lista + detalle): `loan_progress` +
 * `estimated_end_date` (ya en la vista) + el porcentaje/estado derivados +
 * el mini-resumen de sus personas deudoras (sección 4.4). */
export interface LoanItem {
  loanId: string
  name: string
  description: string | null
  totalAmount: number
  monthlyPayment: number
  startDate: string
  estimatedEndDate: string | null
  termMonths: number
  paidCount: number
  totalCount: number
  paidAmount: number
  remainingAmount: number
  percentComplete: number
  hasOverdue: boolean
  isCompleted: boolean
  badgeStatus: LoanBadgeStatus
  nextInstallmentNumber: number | null
  nextInstallmentAmount: number | null
  nextInstallmentDueDate: string | null
  debtorsCount: number
  debtorsReceived: number
  debtorsTotal: number
  debtors: LoanDebtorItem[]
  debtorsPreview: LoanDebtorItem[]
}

export interface CreateLoanPayload {
  name: string
  totalAmount: number
  monthlyInstallmentAmount: number
  startDate: string
  termMonths: number
  description: string | null
}

export interface UpdateLoanPayload {
  name: string
  description: string | null
  monthlyInstallmentAmount: number
}

export interface AddDebtorPayload {
  loanId: string
  debtPersonId: string
  amountOwed: number
}

export interface RegisterPaymentPayload {
  loanDebtorId: string
  amount: number
  paymentDate: string
}

function num(value: number | null | undefined): number {
  return value ?? 0
}

export const useLoansStore = defineStore('loans', () => {
  const debtPeopleStore = useDebtPeopleStore()

  /** Una fila por préstamo (`loan_progress`). */
  const progress = ref<LoanProgress[]>([])
  /** Fila única de agregados globales del usuario (`loans_summary`). */
  const summary = ref<LoansSummary | null>(null)
  /** Todas las filas de `loan_debtor_balances` del usuario (sección 1.2:
   * cardinalidad chica, seguro traerlas completas). Fuente única para el
   * mini-resumen por préstamo de la lista, el tab Personas del detalle y las
   * mutaciones optimistas de pago/alta/baja de persona. */
  const debtorBalances = ref<LoanDebtorBalance[]>([])
  /** Cuotas del préstamo actualmente abierto en el detalle (sección 1.3:
   * cardinalidad acotada por `term_months`, se trae completa sin paginar). */
  const installments = ref<LoanInstallment[]>([])

  function buildDebtorItem(row: LoanDebtorBalance): LoanDebtorItem {
    const person = row.debt_person_id ? debtPeopleStore.personById(row.debt_person_id) : undefined
    return {
      loanDebtorId: String(row.loan_debtor_id),
      loanId: String(row.loan_id),
      debtPersonId: String(row.debt_person_id),
      person: { name: person?.name ?? 'Persona', color: person?.color ?? null },
      amountAssigned: num(row.amount_owed),
      amountReceived: num(row.amount_received),
      balanceRemaining: num(row.balance_remaining),
      lastPaymentDate: row.last_payment_date,
      hasPayments: row.last_payment_date != null,
    }
  }

  function badgeStatusFor(p: LoanProgress): LoanBadgeStatus {
    // Sección 2.2: `overdue` tiene precedencia; `completed` solo si no está
    // atrasado; `current` en cualquier otro caso.
    if (p.has_overdue) return 'overdue'
    if (p.is_completed) return 'completed'
    return 'current'
  }

  function buildLoanItem(p: LoanProgress): LoanItem {
    const loanId = String(p.loan_id)
    const totalCount = num(p.total_count)
    const paidCount = num(p.paid_count)
    // Sección 1.2: `paid_count/total_count`, no por monto — el mockup mide el
    // avance en cuotas y la última cuota absorbe el resto de redondeo.
    const percentComplete = totalCount > 0 ? (paidCount / totalCount) * 100 : 0

    const loanDebtors = debtorBalances.value
      .filter(row => row.loan_id === loanId)
      .map(buildDebtorItem)

    return {
      loanId,
      name: p.name ?? 'Préstamo',
      description: p.description,
      totalAmount: num(p.total_amount),
      monthlyPayment: num(p.monthly_installment_amount),
      startDate: p.start_date ?? '',
      estimatedEndDate: p.estimated_end_date,
      termMonths: num(p.term_months),
      paidCount,
      totalCount,
      paidAmount: num(p.paid_amount),
      remainingAmount: num(p.remaining_amount),
      percentComplete,
      hasOverdue: !!p.has_overdue,
      isCompleted: !!p.is_completed,
      badgeStatus: badgeStatusFor(p),
      nextInstallmentNumber: p.next_installment_number,
      nextInstallmentAmount: p.next_installment_amount,
      nextInstallmentDueDate: p.next_installment_due_date,
      debtorsCount: loanDebtors.length,
      debtorsReceived: loanDebtors.reduce((sum, d) => sum + d.amountReceived, 0),
      debtorsTotal: loanDebtors.reduce((sum, d) => sum + d.amountAssigned, 0),
      debtors: loanDebtors,
      debtorsPreview: loanDebtors.slice(0, 3),
    }
  }

  const loanItems = computed<LoanItem[]>(() =>
    progress.value.filter(p => p.loan_id).map(buildLoanItem),
  )

  function sortLoans(list: LoanItem[]): LoanItem[] {
    // Sección 4.4: atrasados primero, luego por fecha de inicio desc.
    return [...list].sort((a, b) => {
      if (a.hasOverdue !== b.hasOverdue) return a.hasOverdue ? -1 : 1
      return b.startDate.localeCompare(a.startDate)
    })
  }

  const activeLoans = computed(() => sortLoans(loanItems.value.filter(l => !l.isCompleted)))
  const historyLoans = computed(() => sortLoans(loanItems.value.filter(l => l.isCompleted)))

  // Sección 2.1/4.2: "Total que debo recibir" es un agregado GLOBAL (todos los
  // préstamos, activos + Historial) — ya resuelto server-side por
  // `loans_summary`, no se re-suma en cliente.
  const totalReceivableRemaining = computed(() => num(summary.value?.total_receivable_remaining))
  const totalReceived = computed(() => num(summary.value?.total_received))

  function loanItemById(id: string): LoanItem | undefined {
    const p = progress.value.find(row => row.loan_id === id)
    return p ? buildLoanItem(p) : undefined
  }

  const sortedInstallments = computed(() =>
    [...installments.value].sort((a, b) => a.installment_number - b.installment_number),
  )

  // --- Fetch ---

  async function fetchProgress(): Promise<boolean> {
    const { data, error } = await supabase.from('loan_progress').select('*')
    if (error) {
      console.error('[loans] No se pudieron cargar los préstamos', error)
      return false
    }
    progress.value = data ?? []
    return true
  }

  async function fetchSummary(): Promise<boolean> {
    const authStore = useAuthStore()
    const userId = authStore.user?.id
    if (!userId) {
      summary.value = null
      return true
    }
    const { data, error } = await supabase
      .from('loans_summary')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) {
      console.error('[loans] No se pudo cargar el resumen global', error)
      return false
    }
    summary.value = data
    return true
  }

  async function fetchDebtorBalances(): Promise<boolean> {
    const { data, error } = await supabase.from('loan_debtor_balances').select('*')
    if (error) {
      console.error('[loans] No se pudieron cargar los saldos de personas', error)
      return false
    }
    debtorBalances.value = data ?? []
    return true
  }

  /** Cuotas de un préstamo puntual (sección 1.3): sin filtro de fecha, la
   * cardinalidad ya está acotada por `term_months`. */
  async function fetchInstallments(loanId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('loan_installments')
      .select('*')
      .eq('loan_id', loanId)
      .order('installment_number', { ascending: true })
    if (error) {
      console.error('[loans] No se pudieron cargar las cuotas', error)
      return false
    }
    installments.value = data ?? []
    return true
  }

  // --- Mutaciones ---

  /**
   * Alta de préstamo (sección 1.5): NO optimista, vía el RPC atómico
   * `create_loan` (inserta `loans` + genera todas las `loan_installments` en
   * una transacción). El cliente no puede fabricar de antemano los ids/
   * due_dates reales de N cuotas. Tras la confirmación, refresca progreso +
   * resumen.
   */
  async function createLoan(payload: CreateLoanPayload): Promise<{ loanId: string } | { error: true }> {
    const { data, error } = await supabase.rpc('create_loan', {
      p_name: payload.name,
      p_total_amount: payload.totalAmount,
      p_monthly_installment_amount: payload.monthlyInstallmentAmount,
      p_start_date: payload.startDate,
      p_term_months: payload.termMonths,
      p_description: payload.description ?? undefined,
    })

    if (error || !data) {
      console.error('[loans] No se pudo crear el préstamo', error)
      return { error: true }
    }

    await Promise.all([fetchProgress(), fetchSummary()])
    return { loanId: data }
  }

  /** Edición de los campos descriptivos (sección 8.1): 100% optimista sobre la
   * fila de `loan_progress` cacheada — `total_amount`/`start_date`/
   * `term_months` no se editan (ya generaron el cronograma). */
  function updateLoan(id: string, payload: UpdateLoanPayload): void {
    const idx = progress.value.findIndex(p => p.loan_id === id)
    if (idx === -1) return
    const previous = progress.value[idx]!

    const optimistic: LoanProgress = {
      ...previous,
      name: payload.name,
      description: payload.description,
      monthly_installment_amount: payload.monthlyInstallmentAmount,
    }
    const applyRow = (row: LoanProgress) => {
      const next = [...progress.value]
      const at = next.findIndex(p => p.loan_id === id)
      if (at !== -1) next.splice(at, 1, row)
      progress.value = next
    }
    applyRow(optimistic)

    const persist = async (): Promise<void> => {
      const { error } = await supabase
        .from('loans')
        .update({
          name: payload.name,
          description: payload.description,
          monthly_installment_amount: payload.monthlyInstallmentAmount,
        })
        .eq('id', id)

      if (error) {
        applyRow(previous)
        toast.error('No se pudieron guardar los cambios', {
          description: 'Revisá tu conexión e intentá de nuevo.',
          action: {
            label: 'Reintentar',
            onClick: () => {
              applyRow(optimistic)
              void persist()
            },
          },
        })
        return
      }
      toast.success('Cambios guardados')
    }

    void persist()
  }

  /** Borrado de un préstamo completo (sección 5): optimista, sin guard de
   * conteo (su cronograma/personas/pagos son hijos en cascada). Quita también
   * sus filas de `debtorBalances` del cache. La navegación de vuelta la hace
   * la vista. */
  function deleteLoan(id: string): void {
    const removedProgress = progress.value.filter(p => p.loan_id === id)
    const removedDebtors = debtorBalances.value.filter(d => d.loan_id === id)
    if (removedProgress.length === 0) return

    progress.value = progress.value.filter(p => p.loan_id !== id)
    debtorBalances.value = debtorBalances.value.filter(d => d.loan_id !== id)

    const persist = async (): Promise<void> => {
      const { error } = await supabase.from('loans').delete().eq('id', id)
      if (error) {
        progress.value = [...progress.value, ...removedProgress]
        debtorBalances.value = [...debtorBalances.value, ...removedDebtors]
        toast.error('No se pudo eliminar el préstamo', {
          description: 'Revisá tu conexión e intentá de nuevo.',
        })
        return
      }
      toast.success('Préstamo eliminado')
    }

    void persist()
  }

  /**
   * Marcar una cuota pagada/pendiente (sección 1.6): optimista — flip inmediato
   * del `status`/`paid_at` en la lista de cuotas (feedback instantáneo al tap),
   * persistencia en background. Es una única escritura sin dependencia atómica
   * (a diferencia de `pay_fixed_expense_instance`). Tras confirmar, refresca
   * `loan_progress` para que los agregados del tab Resumen (progreso, próxima
   * cuota, estado) queden exactos.
   */
  function toggleInstallment(installment: LoanInstallment): void {
    const idx = installments.value.findIndex(i => i.id === installment.id)
    if (idx === -1) return
    const previous = installments.value[idx]!

    const willBePaid = previous.status !== 'paid'
    const optimistic: LoanInstallment = {
      ...previous,
      status: willBePaid ? 'paid' : 'pending',
      paid_at: willBePaid ? new Date().toISOString() : null,
    }
    const applyRow = (row: LoanInstallment) => {
      const next = [...installments.value]
      const at = next.findIndex(i => i.id === row.id)
      if (at !== -1) next.splice(at, 1, row)
      installments.value = next
    }
    applyRow(optimistic)

    const persist = async (): Promise<void> => {
      const { error } = await supabase
        .from('loan_installments')
        .update({ status: optimistic.status, paid_at: optimistic.paid_at })
        .eq('id', installment.id)

      if (error) {
        applyRow(previous)
        toast.error('No se pudo actualizar la cuota', {
          description: 'Revisá tu conexión e intentá de nuevo.',
          action: {
            label: 'Reintentar',
            onClick: () => {
              applyRow(optimistic)
              void persist()
            },
          },
        })
        return
      }
      // Agregados derivados server-side: se releen para reflejar el nuevo
      // progreso/estado/próxima cuota sin recalcularlos a mano en cliente.
      await fetchProgress()
    }

    void persist()
  }

  /**
   * Agregar una persona deudora a un préstamo (sección 1.7/8.2): optimista,
   * insert de una sola tabla. El `unique(loan_id, debt_person_id)` server-side
   * es el backstop real; si salta (código 23505) se muestra un mensaje legible
   * en vez del error crudo.
   */
  function addDebtor(payload: AddDebtorPayload): void {
    const authStore = useAuthStore()
    const userId = authStore.user?.id
    if (!userId) {
      toast.error('No se pudo agregar la persona', {
        description: 'Revisá tu conexión e intentá de nuevo.',
      })
      return
    }

    const tempId = `temp-${crypto.randomUUID()}`
    const optimistic: LoanDebtorBalance = {
      loan_debtor_id: tempId,
      loan_id: payload.loanId,
      debt_person_id: payload.debtPersonId,
      amount_owed: payload.amountOwed,
      amount_received: 0,
      balance_remaining: payload.amountOwed,
      last_payment_date: null,
      last_payment_amount: null,
      user_id: userId,
    }
    debtorBalances.value = [...debtorBalances.value, optimistic]

    const persist = async (): Promise<void> => {
      const { data, error } = await supabase
        .from('loan_debtors')
        .insert({
          loan_id: payload.loanId,
          debt_person_id: payload.debtPersonId,
          amount_owed: payload.amountOwed,
          user_id: userId,
        })
        .select('id')
        .single()

      if (error || !data) {
        debtorBalances.value = debtorBalances.value.filter(d => d.loan_debtor_id !== tempId)
        // 23505 = unique_violation: la persona ya está en este préstamo.
        if (error?.code === '23505') {
          toast.error('Esa persona ya está en este préstamo')
          return
        }
        toast.error('No se pudo agregar la persona', {
          description: 'Revisá tu conexión e intentá de nuevo.',
          action: {
            label: 'Reintentar',
            onClick: () => {
              debtorBalances.value = [...debtorBalances.value, optimistic]
              void persist()
            },
          },
        })
        return
      }

      // Reemplaza el id temporal por el real, conservando el saldo optimista.
      const at = debtorBalances.value.findIndex(d => d.loan_debtor_id === tempId)
      if (at !== -1) {
        const next = [...debtorBalances.value]
        next.splice(at, 1, { ...optimistic, loan_debtor_id: data.id })
        debtorBalances.value = next
      }
      toast.success('Persona agregada')
    }

    void persist()
  }

  /** Quitar una persona de un préstamo (sección 5.4): optimista. El guard de
   * "tiene pagos" se resuelve de antemano en la vista (deshabilita la opción),
   * acá solo se ejecuta el borrado. */
  function removeDebtor(loanDebtorId: string): void {
    const idx = debtorBalances.value.findIndex(d => d.loan_debtor_id === loanDebtorId)
    if (idx === -1) return
    const removed = debtorBalances.value[idx]!

    debtorBalances.value = debtorBalances.value.filter(d => d.loan_debtor_id !== loanDebtorId)

    const persist = async (): Promise<void> => {
      const { error } = await supabase.from('loan_debtors').delete().eq('id', loanDebtorId)
      if (error) {
        debtorBalances.value = [...debtorBalances.value, removed]
        toast.error('No se pudo quitar la persona', {
          description: 'Revisá tu conexión e intentá de nuevo.',
        })
        return
      }
      toast.success('Persona quitada del préstamo')
    }

    void persist()
  }

  /**
   * Registrar un pago recibido de una persona (sección 1.7/8.3): optimista con
   * "delta seguro" — suma el monto sobre el saldo ya confirmado por el
   * servidor (`loan_debtor_balances`), nunca re-suma el ledger completo.
   */
  function registerPayment(payload: RegisterPaymentPayload): void {
    const authStore = useAuthStore()
    const userId = authStore.user?.id
    const idx = debtorBalances.value.findIndex(d => d.loan_debtor_id === payload.loanDebtorId)
    if (!userId || idx === -1) {
      toast.error('No se pudo registrar el pago', {
        description: 'Revisá tu conexión e intentá de nuevo.',
      })
      return
    }
    const previous = debtorBalances.value[idx]!

    const previousLast = previous.last_payment_date
    const nextLast = previousLast && previousLast > payload.paymentDate ? previousLast : payload.paymentDate
    const optimistic: LoanDebtorBalance = {
      ...previous,
      amount_received: num(previous.amount_received) + payload.amount,
      balance_remaining: num(previous.balance_remaining) - payload.amount,
      last_payment_date: nextLast,
      last_payment_amount: payload.amount,
    }
    const applyRow = (row: LoanDebtorBalance) => {
      const next = [...debtorBalances.value]
      const at = next.findIndex(d => d.loan_debtor_id === payload.loanDebtorId)
      if (at !== -1) next.splice(at, 1, row)
      debtorBalances.value = next
    }
    applyRow(optimistic)

    const persist = async (): Promise<void> => {
      const { error } = await supabase.from('loan_debtor_payments').insert({
        loan_debtor_id: payload.loanDebtorId,
        amount: payload.amount,
        payment_date: payload.paymentDate,
        user_id: userId,
      })

      if (error) {
        applyRow(previous)
        toast.error('No se pudo registrar el pago', {
          description: 'Revisá tu conexión e intentá de nuevo.',
          action: {
            label: 'Reintentar',
            onClick: () => {
              applyRow(optimistic)
              void persist()
            },
          },
        })
        return
      }
      toast.success('Pago registrado')
    }

    void persist()
  }

  return {
    progress,
    summary,
    debtorBalances,
    installments: sortedInstallments,
    loanItems,
    activeLoans,
    historyLoans,
    totalReceivableRemaining,
    totalReceived,
    loanItemById,
    fetchProgress,
    fetchSummary,
    fetchDebtorBalances,
    fetchInstallments,
    createLoan,
    updateLoan,
    deleteLoan,
    toggleInstallment,
    addDebtor,
    removeDebtor,
    registerPayment,
  }
})
