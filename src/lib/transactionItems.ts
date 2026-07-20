import type { ExpenseWithCategory } from '@/stores/expenses'
import type { IncomeWithAccount } from '@/stores/incomes'
import type { AccountTransfer } from '@/stores/accountTransfers'

/**
 * Ítem de la lista mezclada de "movimientos" que renderizan tanto
 * `TransactionsView.vue` (`/transacciones`) como "Transacciones recientes" de
 * `HomeView.vue`. Antes cada vista declaraba su propio union de 2 variantes
 * (`expense`/`income`); se extrajo acá para que las 4 variantes (incluidas las
 * 2 sintéticas de transferencia) queden garantizadamente en sync entre ambas
 * vistas — account-transfers-ux.md sección 6.4.
 *
 * `transfer-out`/`transfer-in` son ítems **puramente visuales**: no son un
 * recurso propio en ninguna tabla, no se editan/borran desde estas vistas (su
 * edición vive en `/transferencias`) y **nunca** participan de ningún total/
 * agregado calculado en cliente (`monthTotal`, deltas, dona) — esos siguen
 * sumando exclusivamente `expensesStore`/`incomesStore`.
 */
export type TransactionItem =
  | { kind: 'expense', id: string, date: string, data: ExpenseWithCategory }
  | { kind: 'income', id: string, date: string, data: IncomeWithAccount }
  | { kind: 'transfer-out', id: string, date: string, data: AccountTransfer }
  | { kind: 'transfer-in', id: string, date: string, data: AccountTransfer }

/**
 * Mezcla gastos + ingresos + transferencias en una única lista ordenada por
 * fecha desc (empate resuelto por `created_at` desc). Cada transferencia genera
 * **siempre las 2** variantes sintéticas (`transfer-out` y `transfer-in`) —
 * salida y entrada son inseparables, es un único evento con dos caras
 * (sección 6.4). El `id` de ambas es `transfer.id`; el `kind` las distingue,
 * así que la `:key` combinada `${item.kind}-${item.id}` queda estable y única
 * entre sí y respecto de cualquier `expense.id`/`income.id` real.
 */
export function buildTransactionItems(
  expenses: ExpenseWithCategory[],
  incomes: IncomeWithAccount[],
  transfers: AccountTransfer[],
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

  return items.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    return b.data.created_at.localeCompare(a.data.created_at)
  })
}
