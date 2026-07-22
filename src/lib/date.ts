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

/** Valor por defecto del campo `<input type="time">` (hora actual del
 * dispositivo, `"HH:MM"` en 24h, horario local) — mismo criterio que
 * `todayDateInputValue()`. Usado por `resetForm()` de `TransactionFormSheet`
 * en modo alta (transaction-time-ux.md sección 3). */
export function nowTimeInputValue(reference: Date = new Date()): string {
  const hours = String(reference.getHours()).padStart(2, '0')
  const minutes = String(reference.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/** Formatea una hora cruda de Postgres (`"HH:MM:SS"`) a `"HH:MM"` (24h) para
 * los listados (transaction-time-ux.md sección 5). Slice directo a 5
 * caracteres, sin pasar por `Date`/locale: el dato ya es un string sin
 * componente de zona horaria. Mismo criterio defensivo que usa el resto del
 * proyecto al consumir columnas `time`/`date` crudas. */
export function formatTimeShort(value: string): string {
  return value.slice(0, 5)
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

/** Etiqueta corta de la píldora de fecha del alta tipo "calculadora"
 * (accounts-income-ux.md sección 14.4.2): "Hoy"/"Ayer" igual que
 * `formatExpenseDateHeading`, pero para el resto usa el formato corto sin año
 * ("12 jul", mes abreviado a 3 letras) en vez de "12 de julio" — el espacio de
 * la píldora es acotado. Se agrega como función nueva a propósito (decisión
 * del Product Owner, riesgo 14.14.3) en vez de reusar `formatExpenseDateHeading`. */
export function formatDateChip(value: string, reference: Date = new Date()): string {
  const date = parseDateOnly(value)
  const today = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (isSameCalendarDay(date, today)) return 'Hoy'
  if (isSameCalendarDay(date, yesterday)) return 'Ayer'

  const day = date.getDate()
  const month = MONTHS_ES[date.getMonth()]?.slice(0, 3) ?? ''
  return `${day} ${month}`
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

/** Último día del mes calendario de `reference` (para clampear un día de mes
 * en meses cortos, ej. día 31 en febrero). Mismo criterio ya usado por
 * `lastDayOfMonth`/`effectiveDueDay` de `src/stores/fixedExpenses.ts` —
 * **duplicada acá a propósito, no importada desde ese store**: `date.ts` es
 * una capa compartida sin dependencias de Pinia, y esas dos funciones son
 * privadas del módulo `fixedExpenses.ts` (no exportadas), así que no hay nada
 * que importar sin tocar ese store ya shippeado (credit-cards-ux.md sección
 * 12.1). */
export function lastDayOfMonth(reference: Date): number {
  return new Date(reference.getFullYear(), reference.getMonth() + 1, 0).getDate()
}

/**
 * Próxima ocurrencia real de un "día del mes" (1-31) a partir de `reference`
 * — **siempre hoy o en el futuro, nunca una fecha pasada** (credit-cards-ux.md
 * sección 12.1).
 *
 * Casos borde:
 * - **El día ya pasó este mes** (ej. hoy 20, día pedido 15): devuelve el 15
 *   del **mes siguiente**.
 * - **El día es HOY**: devuelve HOY, no salta al mes que viene — a propósito,
 *   para poder mostrar "Hoy" en vez de saltarse de largo un vencimiento real
 *   de hoy mismo (sección 12.4, el caso más urgente posible).
 * - **Mes más corto que el día pedido** (ej. día 31 en un febrero de 28/29
 *   días): se clampea a `lastDayOfMonth` tanto para decidir si "ya pasó" en el
 *   mes actual como para el resultado del mes siguiente.
 */
export function nextMonthlyOccurrence(day: number, reference: Date = new Date()): Date {
  const today = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate())
  const thisMonthDay = Math.min(day, lastDayOfMonth(today))
  const thisMonthOccurrence = new Date(today.getFullYear(), today.getMonth(), thisMonthDay)
  if (thisMonthOccurrence.getTime() >= today.getTime()) return thisMonthOccurrence

  const nextMonthRef = new Date(today.getFullYear(), today.getMonth() + 1, 1)
  const nextMonthDay = Math.min(day, lastDayOfMonth(nextMonthRef))
  return new Date(nextMonthRef.getFullYear(), nextMonthRef.getMonth(), nextMonthDay)
}

/** Días de diferencia (siempre `>= 0` cuando `date` viene de
 * `nextMonthlyOccurrence`), ambos normalizados a medianoche local
 * (credit-cards-ux.md sección 12.1). */
export function daysUntil(date: Date, reference: Date = new Date()): number {
  const today = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate())
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const MS_PER_DAY = 24 * 60 * 60 * 1000
  return Math.round((target.getTime() - today.getTime()) / MS_PER_DAY)
}

/** Etiqueta corta de "cuánto falta": `0` → `"Hoy"`, `1` → `"Mañana"`, resto →
 * `"En N días"`. Asume `days >= 0` (siempre cierto viniendo de
 * `nextMonthlyOccurrence` + `daysUntil`, nunca se le pasa un negativo)
 * (credit-cards-ux.md sección 12.1). */
export function formatDaysUntilLabel(days: number): string {
  if (days === 0) return 'Hoy'
  if (days === 1) return 'Mañana'
  return `En ${days} días`
}

/** Fecha corta con mes abreviado, sin año (ej. `"15 ago"`). **No reusa**
 * `formatDateChip` (que ya existe en este archivo) porque esa función recibe
 * un `date` crudo de Postgres (`string` `"YYYY-MM-DD"`), mientras que acá el
 * insumo ya es un `Date` calculado por `nextMonthlyOccurrence` — mismo array
 * `MONTHS_ES` reusado, sin duplicar la lista de meses (credit-cards-ux.md
 * sección 12.1). */
export function formatShortDate(date: Date): string {
  return `${date.getDate()} ${MONTHS_ES[date.getMonth()]?.slice(0, 3) ?? ''}`
}
