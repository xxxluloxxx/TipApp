import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { supabase } from '@/lib/supabase'
import { useAccountsStore } from '@/stores/accounts'
import { useAuthStore } from '@/stores/auth'
import { useCategoriesStore } from '@/stores/categories'
import { formatDateOnly, startOfMonth } from '@/lib/date'
import type { Tables } from '@/types/database.types'

export type FixedExpense = Tables<'fixed_expenses'>
/** Fila de la vista `fixed_expense_instances_current` (una por plantilla
 * ACTIVA con instancia del período actual ya creada). */
export type FixedExpenseInstanceCurrent = Tables<'fixed_expense_instances_current'>
/** Fila única de la vista `fixed_expenses_summary` (siempre 1 por usuario). */
export type FixedExpensesSummary = Tables<'fixed_expenses_summary'>

/** Estado visual de una fila (sección 6): `paid`/`pending` llegan del backend,
 * `overdue` y `paused` son derivaciones 100% de cliente (secciones 6.1). */
export type FixedExpenseDisplayStatus = 'paid' | 'overdue' | 'pending' | 'paused' | 'skipped'

/**
 * Fila lista para renderizar en la lista/dashboard (sección 3.7): plantilla
 * (`fixed_expenses`) + su instancia del mes (`fixed_expense_instances_current`,
 * solo para las activas). Las plantillas pausadas no aparecen en la vista de
 * instancias, así que su categoría se resuelve contra `categoriesStore`
 * (sección "lista completa de plantillas" del encargo).
 */
export interface FixedExpenseRow {
  templateId: string
  /** `null` cuando la plantilla está pausada (no tiene instancia en la vista
   * del período actual) — sin instancia no se puede pagar. */
  instanceId: string | null
  name: string
  /** Monto a mostrar: el real pagado si la instancia ya se pagó, el de la
   * plantilla en cualquier otro caso (mismo criterio que `total_amount`). */
  amount: number
  categoryId: string
  categoryName: string
  categoryColor: string | null
  categoryIcon: string | null
  paymentDay: number
  notes: string | null
  isActive: boolean
  /** Estado crudo de la instancia (`null` si pausada / sin instancia). */
  status: 'pending' | 'paid' | 'skipped' | null
  displayStatus: FixedExpenseDisplayStatus
}

/**
 * Fila de una instancia de un período arbitrario (fixed-expenses-ux.md sección
 * 13.4), para la pantalla de Comparación mensual. A diferencia de
 * `FixedExpenseRow` (que parte de la plantilla y su instancia del mes actual),
 * esta parte de la instancia de CUALQUIER mes — incluye plantillas hoy pausadas
 * que tuvieron instancia ese mes, y excluye plantillas creadas después.
 */
export interface FixedExpenseHistoryRow {
  instanceId: string
  name: string
  /** Monto real pagado si `paid`, la proyección de la plantilla si `pending`. */
  amount: number
  /** `true` si la instancia nunca se marcó como pagada (monto = proyección). */
  isPending: boolean
  /** Categoría de la plantilla (campo aditivo, sección 13.11): resuelve el
   * color del dot de la fila vía `categoriesStore.categoryById`. */
  categoryId: string | null
}

export interface FixedExpensePayload {
  name: string
  amount: number
  categoryId: string
  paymentDay: number
  notes: string | null
}

export interface PayInstancePayload {
  instanceId: string
  accountId: string
  /** Monto confirmado en el Sheet (siempre prefilled, nunca `null` acá). */
  amount: number
  expenseDate: string
  description: string | null
}

// Red de seguridad defensiva (mismo criterio que el resto de stores): las
// queries que la usan ya están acotadas por período, no es el mecanismo real.
const RANGE_SAFETY_LIMIT = 1000

/** Último día del mes calendario de `reference` (para clampear `payment_day`
 * en meses cortos, ej. día 31 en febrero — sección 4.1/6.1). */
function lastDayOfMonth(reference: Date): number {
  return new Date(reference.getFullYear(), reference.getMonth() + 1, 0).getDate()
}

/** Día efectivo de vencimiento este mes (clampeado al último día disponible). */
function effectiveDueDay(paymentDay: number, reference: Date): number {
  return Math.min(paymentDay, lastDayOfMonth(reference))
}

/** Sección 6.1: "Vencido" = pendiente + hoy ya pasó el día de pago de este
 * mes. Derivación trivial de cliente, no un valor de backend. */
function isOverdue(paymentDay: number, reference: Date = new Date()): boolean {
  return reference.getDate() > effectiveDueDay(paymentDay, reference)
}

function rowRank(row: FixedExpenseRow): number {
  // Sección 3.7: activas primero (pendientes/vencidas antes que pagadas),
  // pausadas al final.
  if (!row.isActive) return 2
  if (row.status === 'paid' || row.status === 'skipped') return 1
  return 0
}

/**
 * Store de Gastos fijos / recurrentes (fixed-expenses-ux.md). Principio
 * "tonto", igual que `accounts`/`debts`/`betSlips`: el estado agregado del mes
 * (total, X de Y pagados, promedio) NUNCA se recalcula en cliente — llega
 * resuelto de `fixed_expenses_summary`. Lo único que se agrega/deriva en
 * cliente es lo que ninguna vista cubre (el estado visual `overdue`, sección
 * 6.1) y el merge de plantillas pausadas con las instancias activas (la vista
 * de instancias solo trae plantillas activas).
 *
 * Tres perfiles de mutación (secciones 4.2/5.2/7): alta/edición de plantilla
 * 100% optimista, toggle pausar/reanudar y borrado optimistas (sin guard de
 * conteo, sección 1.3), y marcar como pagado NO optimista vía RPC atómico
 * `pay_fixed_expense_instance` (sección 5.2, mismo motivo que `create_debt`).
 */
export const useFixedExpensesStore = defineStore('fixedExpenses', () => {
  const categoriesStore = useCategoriesStore()

  /** Todas las plantillas del usuario (activas + pausadas), sección 1.2. */
  const templates = ref<FixedExpense[]>([])
  /** Instancias del período actual, una por plantilla ACTIVA (vista). */
  const currentInstances = ref<FixedExpenseInstanceCurrent[]>([])
  /** Fila única de resumen del mes (total/pagados/promedio), o `null` si
   * todavía no cargó / el usuario no tiene ninguna plantilla. */
  const summary = ref<FixedExpensesSummary | null>(null)
  /** Total proyectado del mes ANTERIOR (sección 3.2), para el delta del hero —
   * `null` si no hay instancias de ese mes (no se compara contra 0 inventado). */
  const previousMonthTotal = ref<number | null>(null)

  function instanceByTemplateId(templateId: string): FixedExpenseInstanceCurrent | undefined {
    return currentInstances.value.find(instance => instance.fixed_expense_id === templateId)
  }

  /** Merge plantilla + instancia + categoría, con el estado visual derivado
   * (sección 3.7/6.1). Ordenado: activas accionables → pagadas → pausadas. */
  const rows = computed<FixedExpenseRow[]>(() => {
    const now = new Date()
    const list = templates.value.map<FixedExpenseRow>((template) => {
      const instance = template.is_active ? instanceByTemplateId(template.id) : undefined
      const category = categoriesStore.categoryById(template.category_id)

      const status = (instance?.status as 'pending' | 'paid' | 'skipped' | undefined) ?? null
      const paidAmount = instance?.paid_amount ?? null
      const amount = status === 'paid' && paidAmount !== null ? paidAmount : template.amount

      let displayStatus: FixedExpenseDisplayStatus
      if (!template.is_active) {
        displayStatus = 'paused'
      } else if (status === 'paid') {
        displayStatus = 'paid'
      } else if (status === 'skipped') {
        // Sección 14.2: `skipped` se prioriza SOBRE `overdue` — una instancia
        // omitida cuyo día de pago ya pasó nunca debe mostrarse "Vencido".
        displayStatus = 'skipped'
      } else if (status === 'pending' && isOverdue(template.payment_day, now)) {
        displayStatus = 'overdue'
      } else {
        displayStatus = 'pending'
      }

      return {
        templateId: template.id,
        instanceId: instance?.instance_id ?? null,
        name: template.name,
        amount,
        categoryId: template.category_id,
        // La vista trae la categoría resuelta para las activas; para las
        // pausadas (fuera de la vista) se resuelve contra el store.
        categoryName: instance?.category_name ?? category?.name ?? 'Sin categoría',
        categoryColor: instance?.category_color ?? category?.color ?? null,
        categoryIcon: instance?.category_icon ?? category?.icon ?? null,
        paymentDay: template.payment_day,
        notes: template.notes,
        isActive: template.is_active,
        status,
        displayStatus,
      }
    })

    return list.sort((a, b) => {
      const rankDiff = rowRank(a) - rowRank(b)
      if (rankDiff !== 0) return rankDiff
      if (a.paymentDay !== b.paymentDay) return a.paymentDay - b.paymentDay
      return a.name.localeCompare(b.name, 'es')
    })
  })

  const hasAnyTemplate = computed(() => templates.value.length > 0)

  // Sección 3.2-3.4: los 3 números del dashboard salen DIRECTO de la vista
  // de resumen, nunca de re-sumar instancias en cliente.
  const monthTotal = computed(() => summary.value?.total_amount ?? 0)
  const paidCount = computed(() => summary.value?.paid_count ?? 0)
  const plannedCount = computed(() => summary.value?.planned_count ?? 0)
  // Sección 14.4: conteo de instancias `skipped` del mes, agregado server-side.
  const omittedCount = computed(() => summary.value?.omitted_count ?? 0)
  const monthlyAverage = computed(() => summary.value?.trailing_avg_monthly ?? null)

  /** Instancias pendientes del mes, ordenadas por día de pago (sección 3.5). */
  const upcomingInstances = computed(() =>
    currentInstances.value
      .filter(instance => instance.status === 'pending')
      .sort((a, b) => (a.payment_day ?? 0) - (b.payment_day ?? 0)),
  )

  /** RPC de generación perezosa (sección 1.1): siempre antes de leer las
   * instancias/vistas del período actual. */
  async function ensureCurrentInstances(): Promise<boolean> {
    const { error: rpcError } = await supabase.rpc('ensure_current_fixed_expense_instances')
    if (rpcError) {
      console.error('[fixedExpenses] No se pudieron generar las instancias del mes', rpcError)
      return false
    }
    return true
  }

  async function fetchTemplates(): Promise<boolean> {
    const { data, error: fetchError } = await supabase.from('fixed_expenses').select('*')
    if (fetchError) {
      console.error('[fixedExpenses] No se pudieron cargar las plantillas', fetchError)
      return false
    }
    templates.value = data ?? []
    return true
  }

  async function fetchCurrentInstances(): Promise<boolean> {
    const { data, error: fetchError } = await supabase
      .from('fixed_expense_instances_current')
      .select('*')
    if (fetchError) {
      console.error('[fixedExpenses] No se pudieron cargar las instancias del mes', fetchError)
      return false
    }
    currentInstances.value = data ?? []
    return true
  }

  async function fetchSummary(): Promise<boolean> {
    const authStore = useAuthStore()
    const userId = authStore.user?.id
    if (!userId) {
      summary.value = null
      return true
    }

    const { data, error: fetchError } = await supabase
      .from('fixed_expenses_summary')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (fetchError) {
      console.error('[fixedExpenses] No se pudo cargar el resumen del mes', fetchError)
      return false
    }
    summary.value = data ?? null
    return true
  }

  /**
   * Total proyectado del mes anterior (sección 3.2): query acotada por período
   * (seguro por rango, sección 1.2), replicando la fórmula de `total_amount`
   * (`coalesce(expense.amount, template.amount)`) para que el delta compare
   * peras con peras. Las instancias del mes anterior existen solo si el usuario
   * abrió la sección ese mes (generación perezosa) — es el dato real, no se
   * inventa.
   */
  async function fetchPreviousMonthTotal(reference: Date = new Date()): Promise<boolean> {
    const prevPeriod = formatDateOnly(new Date(reference.getFullYear(), reference.getMonth() - 1, 1))

    const { data, error: fetchError } = await supabase
      .from('fixed_expense_instances')
      .select('expense:expenses(amount), fixed_expense:fixed_expenses(amount)')
      .eq('period', prevPeriod)
      .limit(RANGE_SAFETY_LIMIT)

    if (fetchError) {
      console.error('[fixedExpenses] No se pudo cargar el total del mes anterior', fetchError)
      return false
    }

    const rowsData = (data ?? []) as unknown as Array<{
      expense: { amount: number } | null
      fixed_expense: { amount: number } | null
    }>

    if (rowsData.length === 0) {
      previousMonthTotal.value = null
      return true
    }

    previousMonthTotal.value = rowsData.reduce(
      (sum, row) => sum + (row.expense?.amount ?? row.fixed_expense?.amount ?? 0),
      0,
    )
    return true
  }

  /**
   * Instancias de un período arbitrario (fixed-expenses-ux.md sección 13.4),
   * para la pantalla de Comparación mensual. Lista las filas de
   * `fixed_expense_instances` de ESE mes (NUNCA plantillas filtradas): incluye
   * pausadas con instancia ese mes, excluye plantillas creadas después. Query
   * acotada por `period` (segura por rango, sección 1.2/13.3), mismo join que
   * `fetchPreviousMonthTotal` generalizado para traer también el nombre.
   *
   * Devuelve `null` SOLO ante error de red (la vista lo distingue de `[]` =
   * éxito con cero filas, mismo patrón discriminante que `searchMatches`).
   */
  async function fetchInstancesForPeriod(period: Date): Promise<FixedExpenseHistoryRow[] | null> {
    const periodValue = formatDateOnly(startOfMonth(period))

    const { data, error: fetchError } = await supabase
      .from('fixed_expense_instances')
      .select('id, status, expense:expenses(amount), fixed_expense:fixed_expenses(name, amount, category_id)')
      .eq('period', periodValue)
      .limit(RANGE_SAFETY_LIMIT)

    if (fetchError) {
      console.error('[fixedExpenses] No se pudieron cargar las instancias del período', fetchError)
      return null
    }

    const rowsData = (data ?? []) as unknown as Array<{
      id: string
      status: string
      expense: { amount: number } | null
      fixed_expense: { name: string, amount: number, category_id: string | null } | null
    }>

    return rowsData.map(row => ({
      instanceId: row.id,
      // `fixed_expense_id` es NOT NULL con `on delete cascade`: una instancia
      // nunca sobrevive sin su plantilla, el embed siempre viene resuelto
      // (sección 13.4). El `?? 0`/'Gasto fijo' son un backstop defensivo.
      name: row.fixed_expense?.name ?? 'Gasto fijo',
      amount: row.expense?.amount ?? row.fixed_expense?.amount ?? 0,
      isPending: row.status !== 'paid',
      categoryId: row.fixed_expense?.category_id ?? null,
    }))
  }

  function replaceTemplateById(id: string, next: FixedExpense) {
    const idx = templates.value.findIndex(template => template.id === id)
    if (idx === -1) return
    const list = [...templates.value]
    list.splice(idx, 1, next)
    templates.value = list
  }

  /** Alta optimista de una plantilla (sección 4.2), mismo patrón que
   * `addAccount`/`addCard` — sin índice único server-only conocido. */
  function addTemplate(payload: FixedExpensePayload): void {
    const authStore = useAuthStore()
    const userId = authStore.user?.id
    if (!userId) {
      toast.error('No se pudo guardar el gasto fijo', {
        description: 'Revisá tu conexión e intentá de nuevo.',
      })
      return
    }

    const tempId = `temp-${crypto.randomUUID()}`
    const nowIso = new Date().toISOString()
    const optimistic: FixedExpense = {
      id: tempId,
      user_id: userId,
      name: payload.name,
      amount: payload.amount,
      category_id: payload.categoryId,
      payment_day: payload.paymentDay,
      frequency: 'monthly',
      notes: payload.notes,
      is_active: true,
      created_at: nowIso,
      updated_at: nowIso,
    }

    templates.value = [...templates.value, optimistic]

    const persist = async (): Promise<void> => {
      const { data, error: insertError } = await supabase
        .from('fixed_expenses')
        .insert({
          name: payload.name,
          amount: payload.amount,
          category_id: payload.categoryId,
          payment_day: payload.paymentDay,
          notes: payload.notes,
          user_id: userId,
        })
        .select('*')
        .single()

      if (insertError || !data) {
        templates.value = templates.value.filter(template => template.id !== tempId)
        toast.error('No se pudo guardar el gasto fijo', {
          description: 'Revisá tu conexión e intentá de nuevo.',
          action: {
            label: 'Reintentar',
            onClick: () => {
              templates.value = [...templates.value, optimistic]
              void persist()
            },
          },
        })
        return
      }

      replaceTemplateById(tempId, data)
      toast.success('Gasto fijo creado', {
        description: 'Se va a generar su seguimiento este mes en unos segundos.',
      })
      // La instancia del mes se crea perezosamente (RPC) — refrescamos para
      // que la fila nueva aparezca como "Pendiente" con su botón "Pagar".
      await ensureCurrentInstances()
      await Promise.all([fetchCurrentInstances(), fetchSummary()])
    }

    void persist()
  }

  /** Edición optimista de una plantilla (sección 4.2). `is_active` nunca se
   * toca acá (solo desde `toggleActive`, sección 4.1/7). */
  function updateTemplate(id: string, payload: FixedExpensePayload): void {
    const previous = templates.value.find(template => template.id === id)
    if (!previous) return

    const optimistic: FixedExpense = {
      ...previous,
      name: payload.name,
      amount: payload.amount,
      category_id: payload.categoryId,
      payment_day: payload.paymentDay,
      notes: payload.notes,
    }

    replaceTemplateById(id, optimistic)

    const persist = async (): Promise<void> => {
      const { data, error: updateError } = await supabase
        .from('fixed_expenses')
        .update({
          name: payload.name,
          amount: payload.amount,
          category_id: payload.categoryId,
          payment_day: payload.paymentDay,
          notes: payload.notes,
        })
        .eq('id', id)
        .select('*')
        .single()

      if (updateError || !data) {
        replaceTemplateById(id, previous)
        toast.error('No se pudieron guardar los cambios', {
          description: 'Revisá tu conexión e intentá de nuevo.',
          action: {
            label: 'Reintentar',
            onClick: () => {
              replaceTemplateById(id, optimistic)
              void persist()
            },
          },
        })
        return
      }

      replaceTemplateById(id, data)
      toast.success('Cambios guardados')
    }

    void persist()
  }

  /** Toggle pausar/reanudar (sección 7): optimista simple, sin confirmación —
   * es reversible con un solo tap. Solo flipea `is_active`; el estado visual
   * de la fila lo deriva `rows` (una plantilla pausada nunca muestra "Pagar"). */
  function toggleActive(id: string): void {
    const previous = templates.value.find(template => template.id === id)
    if (!previous) return

    const nextActive = !previous.is_active
    replaceTemplateById(id, { ...previous, is_active: nextActive })

    const persist = async (): Promise<void> => {
      const { data, error: updateError } = await supabase
        .from('fixed_expenses')
        .update({ is_active: nextActive })
        .eq('id', id)
        .select('*')
        .single()

      if (updateError || !data) {
        replaceTemplateById(id, previous)
        toast.error('No se pudo actualizar el gasto fijo', {
          description: 'Revisá tu conexión e intentá de nuevo.',
        })
        return
      }

      replaceTemplateById(id, data)
      toast.success(nextActive ? 'Gasto fijo reanudado' : 'Gasto fijo pausado')
    }

    void persist()
  }

  /**
   * Toggle omitir/reactivar una instancia del mes (sección 14.3): optimista
   * simple, sin confirmación — reversible con un solo tap, mismo criterio que
   * `toggleActive`. A diferencia de "Marcar como pagado" (RPC atómico), acá es
   * un único `update` de `status` sobre una fila que ya existe. Solo alterna
   * entre `pending` ↔ `skipped`; el estado visual lo deriva `rows`.
   */
  function toggleSkipped(instanceId: string): void {
    const previous = currentInstances.value.find(instance => instance.instance_id === instanceId)
    if (!previous) return

    const previousStatus = previous.status
    const nextStatus = previousStatus === 'skipped' ? 'pending' : 'skipped'

    const applyStatus = (status: string) => {
      currentInstances.value = currentInstances.value.map(instance =>
        instance.instance_id === instanceId ? { ...instance, status } : instance,
      )
    }

    applyStatus(nextStatus)

    const persist = async (): Promise<void> => {
      const { error: updateError } = await supabase
        .from('fixed_expense_instances')
        .update({ status: nextStatus })
        .eq('id', instanceId)

      if (updateError) {
        applyStatus(previousStatus ?? 'pending')
        toast.error('No se pudo actualizar el gasto fijo', {
          description: 'Revisá tu conexión e intentá de nuevo.',
        })
        return
      }

      toast.success(nextStatus === 'skipped' ? 'Gasto fijo omitido este mes' : 'Gasto fijo reactivado')
      // `omitted_count`/`total_amount` cambiaron — se refresca en background.
      void fetchSummary()
    }

    void persist()
  }

  /** Borrado optimista de una plantilla (sección 1.3/7): SIN guard de conteo.
   * Borrar la plantilla no toca los `expenses` ya generados — solo se pierde
   * el seguimiento futuro (el copy del `AlertDialog` lo aclara). También quita
   * su instancia del mes en curso de `currentInstances` para que la fila y los
   * totales se actualicen al instante. */
  function deleteTemplate(id: string): void {
    const removed = templates.value.find(template => template.id === id)
    if (!removed) return

    const removedInstances = currentInstances.value.filter(instance => instance.fixed_expense_id === id)

    templates.value = templates.value.filter(template => template.id !== id)
    if (removedInstances.length > 0) {
      currentInstances.value = currentInstances.value.filter(instance => instance.fixed_expense_id !== id)
    }

    const persist = async (): Promise<void> => {
      const { error: deleteError } = await supabase.from('fixed_expenses').delete().eq('id', id)

      if (deleteError) {
        templates.value = [...templates.value, removed]
        if (removedInstances.length > 0) {
          currentInstances.value = [...currentInstances.value, ...removedInstances]
        }
        toast.error('No se pudo eliminar el gasto fijo', {
          description: 'Revisá tu conexión e intentá de nuevo.',
        })
        return
      }

      // El resumen del mes puede haber cambiado (una plantilla menos) — se
      // refresca en segundo plano, sin bloquear la UI ya actualizada.
      void fetchSummary()
      toast.success('Gasto fijo eliminado')
    }

    void persist()
  }

  /**
   * Marcar una instancia como pagada (sección 5.2): NO optimista, vía el RPC
   * atómico `pay_fixed_expense_instance` (crea el `expenses` real + marca la
   * instancia como pagada con su `expense_id` en una sola transacción). Recién
   * DESPUÉS de la confirmación del servidor se ajusta el saldo cacheado de la
   * cuenta (a diferencia del resto de mutaciones optimistas de cuentas) y se
   * refrescan las instancias/resumen del mes.
   */
  async function payInstance(payload: PayInstancePayload): Promise<{ expenseId: string } | { error: true }> {
    const { data, error: rpcError } = await supabase.rpc('pay_fixed_expense_instance', {
      p_instance_id: payload.instanceId,
      p_account_id: payload.accountId,
      p_amount: payload.amount,
      p_expense_date: payload.expenseDate,
      p_description: payload.description ?? undefined,
    })

    if (rpcError || !data) {
      console.error('[fixedExpenses] No se pudo registrar el pago', rpcError)
      return { error: true }
    }

    // El gasto real ya está confirmado: recién ahora se descuenta de la cuenta
    // (mismo signo que un gasto normal) y se refresca el estado del mes.
    useAccountsStore().adjustBalance(payload.accountId, -payload.amount)
    await Promise.all([fetchCurrentInstances(), fetchSummary()])

    return { expenseId: data }
  }

  return {
    templates,
    currentInstances,
    summary,
    previousMonthTotal,
    rows,
    hasAnyTemplate,
    monthTotal,
    paidCount,
    plannedCount,
    omittedCount,
    monthlyAverage,
    upcomingInstances,
    instanceByTemplateId,
    ensureCurrentInstances,
    fetchTemplates,
    fetchCurrentInstances,
    fetchSummary,
    fetchPreviousMonthTotal,
    fetchInstancesForPeriod,
    addTemplate,
    updateTemplate,
    toggleActive,
    toggleSkipped,
    deleteTemplate,
    payInstance,
  }
})
