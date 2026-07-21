const MONTHS_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]

/**
 * Convierte un `date` de Postgres (`YYYY-MM-DD`, sin hora/zona) en un `Date`
 * local a medianoche. Evita el corrimiento de un día que produce
 * `new Date('YYYY-MM-DD')` al interpretarlo como UTC en vez de hora local.
 *
 * Exportada (antes privada) porque `src/lib/charts.ts` (dashboard-redesign)
 * la necesita para agrupar gastos por día/mes sin duplicar el parseo.
 */
export function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1)
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
  )
}

/** `YYYY-MM-DD` de cualquier `Date` en horario local (sin corrimiento de
 * zona horaria). Extraída de `todayDateInputValue` (antes hacía este cálculo
 * inline) porque `credit-cards-ux.md` sección 1.2 necesita formatear límites
 * `gte`/`lt` de mes arbitrarios (no solo "hoy") para los queries de
 * `card_expenses`. */
export function formatDateOnly(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Valor por defecto del campo `<input type="date">` (hoy, en horario local). */
export function todayDateInputValue(reference: Date = new Date()): string {
  return formatDateOnly(reference)
}

/** Sección 3.4 de expenses-mvp-ux.md: valida que la fecha no sea futura. */
export function isFutureDate(value: string, reference: Date = new Date()): boolean {
  const date = parseDateOnly(value)
  const today = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate())
  return date.getTime() > today.getTime()
}

/** Encabezado de grupo de la lista de gastos (sección 2.3 de expenses-mvp-ux.md). */
export function formatExpenseDateHeading(value: string, reference: Date = new Date()): string {
  const date = parseDateOnly(value)
  const today = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (isSameCalendarDay(date, today)) return 'Hoy'
  if (isSameCalendarDay(date, yesterday)) return 'Ayer'

  const day = date.getDate()
  const month = MONTHS_ES[date.getMonth()]

  if (date.getFullYear() === today.getFullYear()) {
    return `${day} de ${month}`
  }

  return `${day} de ${month} de ${date.getFullYear()}`
}

/** Label del hero de "Total del mes" (sección 2.2): p. ej. "julio 2026". */
export function currentMonthLabel(reference: Date = new Date()): string {
  return `${MONTHS_ES[reference.getMonth()]} ${reference.getFullYear()}`
}

/** Nombre del mes en minúscula, sin año (p. ej. "junio") — usado por el copy
 * "vs. {mes}" del hero de "Saldo total" de `/cuentas` (accounts-income-ux.md
 * sección 13.1.3, que no lleva año a diferencia de `currentMonthLabel`). */
export function monthNameOnly(date: Date): string {
  return MONTHS_ES[date.getMonth()] ?? ''
}

/** Primer día del mes calendario de `date` (a medianoche local). Usado por la
 * pantalla de Comparación mensual (fixed-expenses-ux.md sección 13.1/13.10)
 * para normalizar el pivote y los `period` que se pasan al `.eq()` de las
 * queries (la columna `period` en BD es `date`, siempre el día 1 del mes). */
export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

/** Desplaza `date` `delta` meses (negativo hacia atrás, positivo hacia
 * adelante), preservando el día. Puro, sin dependencias — `new Date` ya
 * normaliza el overflow de mes. En la Comparación mensual siempre se aplica
 * sobre fechas ya normalizadas al día 1 (fixed-expenses-ux.md sección 13.10). */
export function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, date.getDate())
}
