import type { ExpenseWithCategory } from '@/stores/expenses'
import type { IncomeWithAccount } from '@/stores/incomes'
import type { AccountTransfer } from '@/stores/accountTransfers'
import type { DebtMovementWithDebt } from '@/stores/debts'

/**
 * Ítem de la lista mezclada de "movimientos" que renderizan tanto
 * `TransactionsView.vue` (`/transacciones`) como "Transacciones recientes" de
 * `HomeView.vue`. Antes cada vista declaraba su propio union de 2 variantes
 * (`expense`/`income`); se extrajo acá para que las variantes (incluidas las 2
 * sintéticas de transferencia y la de deuda con cuenta vinculada) queden
 * garantizadamente en sync entre ambas vistas — account-transfers-ux.md
 * sección 6.4, debts-ux.md sección 13.
 *
 * `transfer-out`/`transfer-in` y `debt-linked` son ítems **puramente
 * visuales**: no son un recurso propio en ninguna tabla que se edite/borre
 * desde estas vistas (la edición de una transferencia vive en
 * `/transferencias`; la de un movimiento de deuda, en `/deudas/:id`) y
 * **nunca** participan de ningún total/agregado calculado en cliente
 * (`monthTotal`, deltas, dona) — esos siguen sumando exclusivamente
 * `expensesStore`/`incomesStore`.
 *
 * `debt-linked` (debts-ux.md sección 13.0/13.2): a diferencia de una
 * transferencia (que genera SIEMPRE 2 variantes, sus dos caras de origen/
 * destino), un `debt_movement` con cuenta vinculada involucra una sola cuenta
 * real del usuario (el otro lado es una persona, no una segunda cuenta), así
 * que genera **exactamente 1 ítem**, nunca 2. Por eso 1 solo `kind`
 * (`debt-linked`), no un par `debt-out`/`debt-in`: el signo lo resuelve
 * `data.amount` (sección 13.2), igual que `income`/`expense` no se subdividen
 * por signo.
 */
export type TransactionItem =
  | { kind: 'expense', id: string, date: string, data: ExpenseWithCategory }
  | { kind: 'income', id: string, date: string, data: IncomeWithAccount }
  | { kind: 'transfer-out', id: string, date: string, data: AccountTransfer }
  | { kind: 'transfer-in', id: string, date: string, data: AccountTransfer }
  | { kind: 'debt-linked', id: string, date: string, data: DebtMovementWithDebt }

/**
 * Mezcla gastos + ingresos + transferencias en una única lista ordenada por
 * fecha desc (empate resuelto por `created_at` desc). Cada transferencia genera
 * **siempre las 2** variantes sintéticas (`transfer-out` y `transfer-in`) —
 * salida y entrada son inseparables, es un único evento con dos caras
 * (sección 6.4). El `id` de ambas es `transfer.id`; el `kind` las distingue,
 * así que la `:key` combinada `${item.kind}-${item.id}` queda estable y única
 * entre sí y respecto de cualquier `expense.id`/`income.id` real.
 *
 * `debtLinkedMovements` (debts-ux.md sección 13.1/13.2): movimientos de deuda
 * con `account_id` no nulo, uno por cada hilo del usuario. Genera **1** ítem
 * por movimiento (`id = movement.id`, `date = movement.movement_date`), nunca
 * 2 (sección 13.0). La lista ya viene acotada por `fetchAccountLinkedMovements`
 * (`.limit(200)`); este helper solo la mezcla.
 */
export function buildTransactionItems(
  expenses: ExpenseWithCategory[],
  incomes: IncomeWithAccount[],
  transfers: AccountTransfer[],
  debtLinkedMovements: DebtMovementWithDebt[] = [],
): TransactionItem[] {
  const items: TransactionItem[] = []

  for (const expense of expenses) {
    items.push({ kind: 'expense', id: expense.id, date: expense.expense_date, data: expense })
  }
  for (const income of incomes) {
    items.push({ kind: 'income', id: income.id, date: income.income_date, data: income })
  }
  for (const transfer of transfers) {
    items.push({ kind: 'transfer-out', id: transfer.id, date: transfer.transfer_date, data: transfer })
    items.push({ kind: 'transfer-in', id: transfer.id, date: transfer.transfer_date, data: transfer })
  }
  for (const movement of debtLinkedMovements) {
    items.push({ kind: 'debt-linked', id: movement.id, date: movement.movement_date, data: movement })
  }

  return items.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    return b.data.created_at.localeCompare(a.data.created_at)
  })
}

/**
 * Igual que `buildTransactionItems`, pero acotado a los ítems donde
 * `accountId` participa de verdad — filtra las 2 variantes sintéticas de
 * transferencia a la que corresponde según de qué lado está esta cuenta
 * (nunca las 2 juntas: si esta cuenta es el origen, solo `transfer-out`; si
 * es el destino, solo `transfer-in`). Usado por `AccountDetailView.vue`
 * (docs/features/account-detail-ux.md sección 7.2) sobre listas YA acotadas
 * por cuenta (`fetchRecentForAccount` de cada store, sección 7.1), no sobre
 * las listas globales. `buildTransactionItems` no se modifica.
 */
export function buildAccountTransactionItems(
  expenses: ExpenseWithCategory[],
  incomes: IncomeWithAccount[],
  transfers: AccountTransfer[],
  accountId: string,
  debtLinkedMovements: DebtMovementWithDebt[] = [],
): TransactionItem[] {
  return buildTransactionItems(expenses, incomes, transfers, debtLinkedMovements).filter((item) => {
    if (item.kind === 'transfer-out') return item.data.from_account_id === accountId
    if (item.kind === 'transfer-in') return item.data.to_account_id === accountId
    // Sección 13.8: un movimiento de deuda tiene una única cuenta — filtro
    // directo, sin lógica de "lado" como en las transferencias.
    if (item.kind === 'debt-linked') return item.data.account_id === accountId
    return true
  })
}
