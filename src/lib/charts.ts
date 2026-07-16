/**
 * Helpers puros para los gráficos del dashboard (docs/features/
 * dashboard-redesign-ux.md, secciones 1.1, 2.2, 4.2, 5.2). Sin dependencias
 * de store/Supabase: reciben datos ya cargados y devuelven estructuras listas
 * para los componentes presentacionales de `src/components/charts/`.
 */
import { parseDateOnly } from '@/lib/date'
import type { ExpenseWithCategory } from '@/stores/expenses'

export interface TrendPoint {
  date: string
  amount: number
}

export interface CategoryTotal {
  id: string
  name: string
  color: string | null
  amount: number
}

export interface DonutSlice {
  id: string
  name: string
  color: string | null
  amount: number
  percentLabel: string
  /** Solo presente en el slice sintético "Otros": categorías plegadas ahí. */
  folded?: { id: string, name: string, amount: number }[]
}

/**
 * Sección 1.1: `expenses.ts` trae los 200 gastos más recientes (sin
 * paginación). Un mes calendario `monthStart` (primer día de ese mes) es
 * seguro de mostrar/comparar completo si y solo si el gasto más viejo
 * cargado (`oldestLoadedDate`) es anterior o igual a ese primer día — porque
 * el query trae "los N más recientes", así que nada por encima de
 * `oldestLoadedDate` pudo haberse descartado.
 */
export function isMonthSafeToShow(monthStart: Date, oldestLoadedDate: Date): boolean {
  return oldestLoadedDate.getTime() <= monthStart.getTime()
}

/** Total de gastos por día del mes de `reference`, indexado por día del mes
 * (1..N), hasta `reference.getDate()` inclusive. Privado: solo lo consumen
 * `buildCumulativeDailySeries`/`buildDailySeries` de este mismo módulo, para
 * no duplicar el filtro por mes + acumulación por día en cada una. */
function buildMonthDailyTotals(expenses: ExpenseWithCategory[], reference: Date): number[] {
  const year = reference.getFullYear()
  const month = reference.getMonth()
  const lastDay = reference.getDate()

  const dailyTotals = new Array<number>(lastDay).fill(0)
  for (const expense of expenses) {
    const date = parseDateOnly(expense.expense_date)
    if (date.getFullYear() !== year || date.getMonth() !== month) continue
    const day = date.getDate()
    if (day >= 1 && day <= lastDay) {
      dailyTotals[day - 1] = (dailyTotals[day - 1] ?? 0) + expense.amount
    }
  }
  return dailyTotals
}

function dayKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Serie **acumulada** (suma corrida) del gasto del mes en curso, día a día,
 * desde el día 1 hasta hoy inclusive (sección 2.2 — tarjeta hero de Inicio).
 * Orden ascendente, huecos (días sin gasto) rellenados a 0 — el último punto
 * siempre coincide exactamente con el total del mes.
 */
export function buildCumulativeDailySeries(
  expenses: ExpenseWithCategory[],
  reference: Date = new Date(),
): TrendPoint[] {
  const dailyTotals = buildMonthDailyTotals(expenses, reference)
  const year = reference.getFullYear()
  const month = reference.getMonth()

  let running = 0
  return dailyTotals.map((amount, idx) => {
    running += amount
    return { date: dayKey(year, month, idx + 1), amount: running }
  })
}

/**
 * Serie **discreta** (no acumulada) del gasto del mes en curso, día a día
 * (sección 4.2 — "Tendencia diaria" de Estadísticas): a diferencia de la
 * acumulada de Inicio, cada punto es el gasto de ese día puntual, para
 * notar en qué días se gastó más/menos.
 */
export function buildDailySeries(
  expenses: ExpenseWithCategory[],
  reference: Date = new Date(),
): TrendPoint[] {
  const dailyTotals = buildMonthDailyTotals(expenses, reference)
  const year = reference.getFullYear()
  const month = reference.getMonth()

  return dailyTotals.map((amount, idx) => ({ date: dayKey(year, month, idx + 1), amount }))
}

/**
 * Arma los slices de la dona de categorías (sección 5.2): ordena por monto
 * desc y, si hay más de `maxSlices` categorías con gasto > 0, pliega todo lo
 * que sobra en un slice sintético "Otros" (`id: 'others'`, `color: null`,
 * con `folded` = detalle de qué categorías quedaron ahí). Si ya existe una
 * categoría real llamada "Otros" entre las primeras `maxSlices`, el plegado
 * se suma a esa fila en vez de crear una segunda "Otros".
 *
 * `maxSlices` es la cantidad de categorías individuales mostradas antes de
 * plegar — con el default (5) el total de slices nunca supera 6 (5
 * individuales + "Otros"), que es el tope de arcos visualmente distinguibles
 * que exige la sección 4.1.
 */
export function buildDonutSlices(categoryTotals: CategoryTotal[], maxSlices = 5): DonutSlice[] {
  const sorted = [...categoryTotals]
    .filter(entry => entry.amount > 0)
    .sort((a, b) => b.amount - a.amount)

  const total = sorted.reduce((sum, entry) => sum + entry.amount, 0)
  if (total === 0) return []

  const percentLabel = (amount: number) => `${Math.round((amount / total) * 100)}%`

  const toSlice = (entry: CategoryTotal): DonutSlice => ({
    id: entry.id,
    name: entry.name,
    color: entry.color,
    amount: entry.amount,
    percentLabel: percentLabel(entry.amount),
  })

  if (sorted.length <= maxSlices) {
    return sorted.map(toSlice)
  }

  const head = sorted.slice(0, maxSlices)
  const tail = sorted.slice(maxSlices)
  const tailAmount = tail.reduce((sum, entry) => sum + entry.amount, 0)
  const folded = tail.map(entry => ({ id: entry.id, name: entry.name, amount: entry.amount }))

  const slices = head.map(toSlice)

  const existingOthers = slices.find(slice => slice.name === 'Otros')
  if (existingOthers) {
    existingOthers.amount += tailAmount
    existingOthers.percentLabel = percentLabel(existingOthers.amount)
    existingOthers.folded = [...(existingOthers.folded ?? []), ...folded]
  } else {
    slices.push({
      id: 'others',
      name: 'Otros',
      color: null,
      amount: tailAmount,
      percentLabel: percentLabel(tailAmount),
      folded,
    })
  }

  return slices
}
