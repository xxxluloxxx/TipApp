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
 */
function parseDateOnly(value: string): Date {
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

/** Valor por defecto del campo `<input type="date">` (hoy, en horario local). */
export function todayDateInputValue(reference: Date = new Date()): string {
  const year = reference.getFullYear()
  const month = String(reference.getMonth() + 1).padStart(2, '0')
  const day = String(reference.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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
