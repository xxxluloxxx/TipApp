import type { DebtMovementWithDebt } from '@/stores/debts'

/**
 * Verbo explícito de un movimiento de deuda según la dirección del hilo + el
 * signo del monto (debts-ux.md sección 6.2/13.3). Se extrajo acá desde
 * `DebtDetailView.vue` para reusarlo como título de la fila sintética
 * `debt-linked` en `/transacciones`, Inicio y el detalle de cuenta, sin
 * depender de un import cruzado vista↔vista y manteniendo el mismo significado
 * en las dos pantallas donde el usuario puede ver el mismo movimiento.
 *
 * A diferencia de la versión original de `DebtDetailView` (que leía la
 * dirección del hilo actual, todos los movimientos comparten dirección), acá
 * cada movimiento puede venir de un hilo distinto — la dirección se lee del
 * propio `movement.debt.direction` embebido (`DebtMovementWithDebt`).
 */
export function movementVerb(movement: DebtMovementWithDebt): string {
  const isLent = movement.debt.direction === 'lent'
  if (isLent) return movement.amount > 0 ? 'Prestaste más' : 'Te devolvieron'
  return movement.amount > 0 ? 'Te prestaron más' : 'Pagaste'
}
