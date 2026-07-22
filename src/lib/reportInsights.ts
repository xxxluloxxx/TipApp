/**
 * reports-detail-ux.md sección 3.6: **duplicación intencional y documentada**
 * de `buildInsights`/`summarizeCategories`/`summarizeAccounts`/`shortDateLabel`
 * — funciones privadas de `src/views/ReportsView.vue`. La restricción dura del
 * Product Owner ("no tocar ReportsView.vue") impide extraerlas exportándolas
 * desde ese archivo; la única forma de reusar esa lógica en
 * `ReportsSummaryView.vue` sin violar la restricción es replicarla acá 1:1.
 *
 * Si en el futuro el PO habilita tocar `ReportsView.vue`, conviene unificar
 * ambos módulos en un solo helper — no se hace preventivamente. NO importar ni
 * exportar nada desde `ReportsView.vue`.
 *
 * Sin dependencias de store/Supabase: recibe datos ya cargados y devuelve
 * estructuras listas para la vista (mismo criterio que `src/lib/charts.ts`).
 */
import { monthNameOnly, parseDateOnly } from '@/lib/date'
import { formatAmount } from '@/lib/currency'

export interface CategoryTotal {
  id: string
  name: string
  color: string | null
  amount: number
  previousAmount: number
}

export interface AccountMovement {
  id: string
  name: string
  incomes: number
  expenses: number
  transferIn: number
  transferOut: number
  debtImpact: number
}

export interface Insight {
  label: string
  value: string
}

export interface ExpenseRow {
  amount: number
  expense_date: string
  account_id: string
  category: { id: string, name: string, color: string | null } | null
}

export interface IncomeRow {
  amount: number
  income_date: string
  account_id: string
}

export interface TransferRow {
  amount: number
  from_account_id: string
  to_account_id: string
}

export interface DebtMovementRow {
  amount: number
  account_id: string | null
  debt: { direction: string | null } | null
}

/** 1:1 con `shortDateLabel` de `ReportsView.vue`. */
export function shortDateLabel(value: string): string {
  const date = parseDateOnly(value)
  return `${date.getDate()} ${monthNameOnly(date).slice(0, 3)}`
}

/** 1:1 con `summarizeCategories` de `ReportsView.vue`. */
export function summarizeCategories(expenses: ExpenseRow[], previousExpenses: ExpenseRow[]): CategoryTotal[] {
  const totals = new Map<string, CategoryTotal>()

  for (const expense of expenses) {
    const category = expense.category
    if (!category) continue
    const existing = totals.get(category.id)
    if (existing) {
      existing.amount += expense.amount
    } else {
      totals.set(category.id, {
        id: category.id,
        name: category.name,
        color: category.color,
        amount: expense.amount,
        previousAmount: 0,
      })
    }
  }

  for (const expense of previousExpenses) {
    const category = expense.category
    if (!category) continue
    const existing = totals.get(category.id)
    if (existing) {
      existing.previousAmount += expense.amount
    } else {
      totals.set(category.id, {
        id: category.id,
        name: category.name,
        color: category.color,
        amount: 0,
        previousAmount: expense.amount,
      })
    }
  }

  return [...totals.values()]
}

/** 1:1 con `summarizeAccounts` de `ReportsView.vue`. */
export function summarizeAccounts(
  accountRows: Array<{ id: string, name: string }>,
  expenses: ExpenseRow[],
  incomes: IncomeRow[],
  transfers: TransferRow[],
  debtMovements: DebtMovementRow[],
): AccountMovement[] {
  const byId = new Map<string, AccountMovement>()
  for (const account of accountRows) {
    byId.set(account.id, {
      id: account.id,
      name: account.name,
      incomes: 0,
      expenses: 0,
      transferIn: 0,
      transferOut: 0,
      debtImpact: 0,
    })
  }

  const ensure = (id: string) => {
    let account = byId.get(id)
    if (!account) {
      account = { id, name: 'Cuenta', incomes: 0, expenses: 0, transferIn: 0, transferOut: 0, debtImpact: 0 }
      byId.set(id, account)
    }
    return account
  }

  for (const income of incomes) ensure(income.account_id).incomes += income.amount
  for (const expense of expenses) ensure(expense.account_id).expenses += expense.amount
  for (const transfer of transfers) {
    ensure(transfer.from_account_id).transferOut += transfer.amount
    ensure(transfer.to_account_id).transferIn += transfer.amount
  }
  for (const movement of debtMovements) {
    if (!movement.account_id) continue
    const direction = movement.debt?.direction
    const impact = direction === 'lent' ? -movement.amount : movement.amount
    ensure(movement.account_id).debtImpact += impact
  }

  return [...byId.values()]
}

/** 1:1 con `buildInsights` de `ReportsView.vue`. */
export function buildInsights(
  expenses: ExpenseRow[],
  categoryTotals: CategoryTotal[],
  accountTotals: AccountMovement[],
): Insight[] {
  const next: Insight[] = []
  const biggestCategory = categoryTotals
    .filter(category => category.amount > 0)
    .sort((a, b) => b.amount - a.amount)[0]

  if (biggestCategory) {
    next.push({ label: 'Mayor gasto', value: `${biggestCategory.name}, $${formatAmount(biggestCategory.amount)}` })
  }

  const byDay = new Map<string, number>()
  for (const expense of expenses) {
    byDay.set(expense.expense_date, (byDay.get(expense.expense_date) ?? 0) + expense.amount)
  }
  const biggestDay = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0]
  if (biggestDay) {
    next.push({ label: 'Día con más gasto', value: `${shortDateLabel(biggestDay[0])}, $${formatAmount(biggestDay[1])}` })
  }

  const mostUsedAccount = accountTotals
    .filter(account => account.incomes || account.expenses || account.transferIn || account.transferOut || account.debtImpact)
    .sort((a, b) => (
      b.incomes + b.expenses + b.transferIn + b.transferOut + Math.abs(b.debtImpact)
      - (a.incomes + a.expenses + a.transferIn + a.transferOut + Math.abs(a.debtImpact))
    ))[0]
  if (mostUsedAccount) {
    next.push({ label: 'Cuenta más usada', value: mostUsedAccount.name })
  }

  const biggestIncrease = categoryTotals
    .map(category => ({ ...category, delta: category.amount - category.previousAmount }))
    .filter(category => category.delta > 0)
    .sort((a, b) => b.delta - a.delta)[0]
  if (biggestIncrease) {
    next.push({ label: 'Categoría que más subió', value: `${biggestIncrease.name}, +$${formatAmount(biggestIncrease.delta)}` })
  }

  return next.slice(0, 4)
}
