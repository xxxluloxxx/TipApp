/**
 * Helpers puros de Iron (docs/features/iron-ux.md sección 6.5). Mismo criterio
 * que `src/lib/charts.ts`/`src/lib/date.ts`: sin dependencias de store ni de
 * Supabase — reciben datos ya cargados y devuelven strings/estructuras listas
 * para los componentes.
 */
import { formatDateOnly, formatExpenseDateHeading, formatTimeShort, parseDateOnly } from '@/lib/date'
import { MONTHS_ES_SHORT, type TrendPoint } from '@/lib/charts'

export type IronGranularity = 'day' | 'week' | 'month'

/** Mapea la pestaña de Tendencias (sección 6.1) a la granularidad que esperan
 * las RPC `iron_cigarette_totals`/`iron_pack_totals` (`'day'|'week'|'month'`). */
export const GRANULARITY_BY_TAB: Record<'daily' | 'weekly' | 'monthly', IronGranularity> = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
}

// es-AR: coma decimal, mismo criterio de formato que `formatAmount`. Se acepta
// hasta 1 decimal (los conteos de Iron solo pueden terminar en `.0` o `.5`).
const countFormatter = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
})

/**
 * Etiqueta de una cantidad de cigarrillos (sección 4.5/6.5): singular/plural y
 * el caso especial `0.5` → "Medio cigarrillo" (más natural que "0,5
 * cigarrillos"). `1` → "1 cigarrillo"; el resto usa el formato es-AR
 * ("3,5 cigarrillos", "12 cigarrillos", "0 cigarrillos").
 */
export function formatCigaretteCount(count: number): string {
  if (count === 0.5) return 'Medio cigarrillo'
  if (count === 1) return '1 cigarrillo'
  return `${countFormatter.format(count)} cigarrillos`
}

/**
 * "Hace cuánto" empezó una mitad pendiente (secciones 4.3/5.3). Combina la
 * fecha relativa ya resuelta por `formatExpenseDateHeading` ("Hoy"/"Ayer"/
 * "12 de julio") con la hora exacta, en minúscula ("empezada hoy a las 14:32").
 */
export function pendingSinceLabel(date: string, time: string, reference: Date = new Date()): string {
  const heading = formatExpenseDateHeading(date, reference)
  const headingLower = heading.charAt(0).toLowerCase() + heading.slice(1)
  return `${headingLower} a las ${formatTimeShort(time)}`
}

/** Bucket sparse tal como lo devuelven las RPC de agregación (`period_start`,
 * `total`) — desacoplado del nombre exacto de la columna de total (que difiere
 * entre cigarrillos y gasto). */
export interface IronBucket {
  period_start: string
  total: number
}

/** Lunes (inicio de semana ISO) de `date`, a medianoche local — mismo criterio
 * que `date_trunc('week', ...)` de Postgres, para que las claves de bucket que
 * genera `buildIronTrendSeries` coincidan con las que devuelven las RPC. */
export function startOfISOWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const offset = (d.getDay() + 6) % 7 // domingo(0) -> 6, lunes(1) -> 0, ...
  d.setDate(d.getDate() - offset)
  return d
}

function advanceCursor(cursor: Date, granularity: IronGranularity): void {
  if (granularity === 'day') cursor.setDate(cursor.getDate() + 1)
  else if (granularity === 'week') cursor.setDate(cursor.getDate() + 7)
  else cursor.setMonth(cursor.getMonth() + 1)
}

function labelFor(cursor: Date, granularity: IronGranularity): string {
  if (granularity === 'day') return String(cursor.getDate())
  if (granularity === 'week') return `Sem ${cursor.getDate()}/${cursor.getMonth() + 1}`
  return MONTHS_ES_SHORT[cursor.getMonth()] ?? ''
}

/**
 * Rellena a `0` los buckets sin dato dentro de `[windowStart, windowEnd]`
 * (sección 6.5), mismo criterio que `buildDailySeries` de `charts.ts` — las
 * RPC devuelven filas sparse (solo buckets con datos), acá se completa la
 * grilla completa. `windowStart` debe venir ya alineado al inicio de bucket
 * (día / lunes ISO / día 1 del mes) para que las claves coincidan con las que
 * agrega Postgres. Cada punto trae su `label` ya resuelto según la granularidad
 * (día del mes / "Sem D/M" / mes abreviado, sección 6.4).
 */
export function buildIronTrendSeries(
  buckets: IronBucket[],
  windowStart: Date,
  windowEnd: Date,
  granularity: IronGranularity,
): TrendPoint[] {
  const byKey = new Map(buckets.map(bucket => [bucket.period_start, bucket.total]))
  const points: TrendPoint[] = []
  const cursor = new Date(windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate())

  while (cursor.getTime() <= windowEnd.getTime()) {
    const key = formatDateOnly(cursor)
    points.push({
      date: key,
      amount: byKey.get(key) ?? 0,
      label: labelFor(cursor, granularity),
    })
    advanceCursor(cursor, granularity)
  }

  return points
}

/**
 * Ventana (inicio alineado a bucket + fin) por granularidad, para pasar a las
 * RPC de agregación y a `buildIronTrendSeries` (sección 6.3):
 * - día: últimos 30 días corridos (30 buckets).
 * - semana: últimas 12 semanas ISO, inicio = lunes de la 11ª semana atrás.
 * - mes: últimos 12 meses calendario, inicio = día 1 del 11º mes atrás.
 */
export function ironTrendWindow(granularity: IronGranularity, reference: Date = new Date()): { start: Date, end: Date } {
  const today = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate())
  if (granularity === 'day') {
    const start = new Date(today)
    start.setDate(start.getDate() - 29)
    return { start, end: today }
  }
  if (granularity === 'week') {
    const thisWeek = startOfISOWeek(today)
    const start = new Date(thisWeek)
    start.setDate(start.getDate() - 7 * 11)
    return { start, end: today }
  }
  const start = new Date(today.getFullYear(), today.getMonth() - 11, 1)
  return { start, end: today }
}

/** Texto fijo del subtítulo de cada pestaña de Tendencias (sección 6.3). */
export function windowLabelFor(granularity: IronGranularity): string {
  if (granularity === 'day') return 'Últimos 30 días'
  if (granularity === 'week') return 'Últimas 12 semanas'
  return 'Últimos 12 meses'
}

/** Valor por unidad de una fila de `iron_cigarettes` para conteo (sección 1.2):
 * un entero cuenta `1`, una mitad `0.5`, sin importar el `status`. */
export function cigaretteUnitValue(kind: string): number {
  return kind === 'entero' ? 1 : 0.5
}

/** Suma de cigarrillos consumidos de un conjunto de filas ya cargadas
 * (`SUM(entero=1, mitad=0.5)`, sección 1.2). Para el resumen "Hoy"/"del día". */
export function sumCigaretteUnits(rows: { kind: string }[]): number {
  return rows.reduce((sum, row) => sum + cigaretteUnitValue(row.kind), 0)
}

/** Primer día del mes calendario de `reference`, `'YYYY-MM-DD'` local. */
export function monthStartDate(reference: Date = new Date()): string {
  return formatDateOnly(new Date(reference.getFullYear(), reference.getMonth(), 1))
}

/** Primer día del mes siguiente al de `reference`, `'YYYY-MM-DD'` local (tope
 * `< end` de la query del mes en curso). */
export function nextMonthStartDate(reference: Date = new Date()): string {
  return formatDateOnly(new Date(reference.getFullYear(), reference.getMonth() + 1, 1))
}

/** ¿La fecha `'YYYY-MM-DD'` cae en el mes calendario en curso? Usado para el
 * ajuste optimista del gasto del mes ante alta/edición/borrado de una compra. */
export function isInCurrentMonth(dateStr: string, reference: Date = new Date()): boolean {
  return dateStr >= monthStartDate(reference) && dateStr < nextMonthStartDate(reference)
}

/** Etiqueta relativa de un día para el navegador de Historial (sección 5.2):
 * reusa `formatExpenseDateHeading` ("Hoy"/"Ayer"/"12 de julio"). Wrapper con
 * nombre propio para dejar explícito el punto de reuso desde la vista. */
export function dayNavigatorLabel(date: string, reference: Date = new Date()): string {
  return formatExpenseDateHeading(date, reference)
}

/** `parseDateOnly` re-exportado para las cuentas de días del navegador de
 * Historial, sin que la vista tenga que importar de dos módulos distintos. */
export { parseDateOnly }
