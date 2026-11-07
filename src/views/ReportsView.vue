<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CalendarSync,
  Download,
  ChevronRight,
  FileText,
  GitCompareArrows,
  Landmark,
  Loader2,
  Layers,
  LayoutDashboard,
  Plus,
  RotateCcw,
  Wallet,
} from '@lucide/vue'
import AppHeader from '@/components/AppHeader.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatAmount } from '@/lib/currency'
import { addMonths, currentMonthLabel, formatDateOnly, monthNameOnly, parseDateOnly, startOfMonth, todayDateInputValue } from '@/lib/date'
import { exportReportPdf, type ReportPdfMovement } from '@/lib/reportPdf'
import { supabase } from '@/lib/supabase'
import { toast } from 'vue-sonner'

interface CategoryTotal {
  id: string
  name: string
  color: string | null
  amount: number
  previousAmount: number
}

interface AccountMovement {
  id: string
  name: string
  incomes: number
  expenses: number
  transferIn: number
  transferOut: number
  debtImpact: number
}

interface Insight {
  label: string
  value: string
}

interface ExpenseRow {
  amount: number
  expense_date: string
  expense_time?: string | null
  created_at?: string
  account_id: string
  description?: string | null
  category: { id: string, name: string, color: string | null } | null
}

interface IncomeRow {
  amount: number
  income_date: string
  income_time?: string | null
  created_at?: string
  account_id: string
  description?: string | null
}

interface TransferRow {
  amount: number
  from_account_id: string
  to_account_id: string
  transfer_date?: string
  created_at?: string
  description?: string | null
}

interface DebtMovementRow {
  amount: number
  account_id: string | null
  movement_date?: string
  created_at?: string
  description?: string | null
  debt: { direction: string | null, person: { name: string } | null } | null
}

const router = useRouter()

const isInitialLoading = ref(true)
const loadError = ref(false)
// Periodo del reporte: un mes (`month:YYYY-MM`), un atajo (`preset:*`) o un
// rango libre (`custom`, con `customFrom`/`customTo` inclusivos).
const selectedPeriod = ref(`month:${monthKey(new Date())}`)
const customFrom = ref(todayDateInputValue())
const customTo = ref(todayDateInputValue())
const isExporting = ref(false)
// Saldo de cada cuenta al inicio del periodo (RPC `account_balances_before`):
// "con cuánto empieza" = suma de las cuentas que están en positivo.
const openingAccounts = ref<Array<{ name: string, balance: number }>>([])
const openingBalance = computed(() => openingAccounts.value.reduce((sum, a) => sum + a.balance, 0))
const movementRows = ref<ReportPdfMovement[]>([])
const accountColorById = ref(new Map<string, string>())
// Saldo (con signo) de TODAS las cuentas al inicio del periodo: base del saldo corrido del PDF.
const openingById = ref(new Map<string, number>())

const incomeTotal = ref(0)
const expenseTotal = ref(0)
const previousExpenseTotal = ref<number | null>(null)
const categories = ref<CategoryTotal[]>([])
const accounts = ref<AccountMovement[]>([])
const totalReceivable = ref(0)
const totalPayable = ref(0)
const loanPending = ref(0)
const pendingInstallments = ref(0)
const insights = ref<Insight[]>([])
const monthlyActivityCount = ref(0)

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthFromKey(value: string): Date {
  const [year, month] = value.split('-').map(Number)
  return new Date(year ?? new Date().getFullYear(), (month ?? 1) - 1, 1)
}

interface PeriodRange {
  startKey: string
  /** Primer día NO incluido (límite `lt` de las queries). */
  nextKey: string
  /** Último día incluido, para mostrar. */
  endKey: string
  label: string
  previousLabel: string
  previous: { startKey: string, nextKey: string }
  isCurrent: boolean
}

function dayStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta)
}

function rangeLabelText(start: Date, endInclusive: Date): string {
  const fmt = (d: Date) => `${d.getDate()} ${monthNameOnly(d).slice(0, 3)} ${d.getFullYear()}`
  return start.getTime() === endInclusive.getTime() ? fmt(start) : `${fmt(start)} – ${fmt(endInclusive)}`
}

const PRESET_LABELS: Record<string, string> = {
  today: 'Hoy',
  yesterday: 'Ayer',
  last7: 'Últimos 7 días',
  lastWeekend: 'Fin de semana anterior',
  last2months: 'Últimos 2 meses',
  custom: 'Rango personalizado',
}

function buildPeriodRange(): PeriodRange | null {
  const today = dayStart(new Date())
  const value = selectedPeriod.value
  let start: Date
  let endInclusive: Date
  let label: string

  if (value.startsWith('month:')) {
    start = monthFromKey(value.slice(6))
    endInclusive = addDays(addMonths(start, 1), -1)
    label = currentMonthLabel(start)
    const prevStart = addMonths(start, -1)
    return {
      startKey: formatDateOnly(start),
      nextKey: formatDateOnly(addDays(endInclusive, 1)),
      endKey: formatDateOnly(endInclusive),
      label,
      previousLabel: monthNameOnly(prevStart),
      previous: { startKey: formatDateOnly(prevStart), nextKey: formatDateOnly(start) },
      isCurrent: today.getTime() >= start.getTime() && today.getTime() <= endInclusive.getTime(),
    }
  }

  switch (value) {
    case 'preset:today':
      start = today
      endInclusive = today
      break
    case 'preset:yesterday':
      start = addDays(today, -1)
      endInclusive = start
      break
    case 'preset:last7':
      start = addDays(today, -6)
      endInclusive = today
      break
    case 'preset:lastWeekend': {
      // Último domingo ya terminado (estrictamente antes de hoy) y su sábado.
      const sunday = addDays(today, -(today.getDay() === 0 ? 7 : today.getDay()))
      endInclusive = sunday
      start = addDays(sunday, -1)
      break
    }
    case 'preset:last2months':
      start = addMonths(startOfMonth(today), -1)
      endInclusive = today
      break
    case 'custom': {
      if (!customFrom.value || !customTo.value) return null
      start = parseDateOnly(customFrom.value)
      endInclusive = parseDateOnly(customTo.value)
      if (endInclusive.getTime() < start.getTime()) return null
      break
    }
    default:
      return null
  }

  label = PRESET_LABELS[value.replace('preset:', '')] ?? PRESET_LABELS.custom!
  const lengthDays = Math.round((endInclusive.getTime() - start.getTime()) / 86_400_000) + 1
  const prevStart = addDays(start, -lengthDays)
  return {
    startKey: formatDateOnly(start),
    nextKey: formatDateOnly(addDays(endInclusive, 1)),
    endKey: formatDateOnly(endInclusive),
    label,
    previousLabel: 'el periodo anterior',
    previous: { startKey: formatDateOnly(prevStart), nextKey: formatDateOnly(start) },
    isCurrent: today.getTime() >= start.getTime() && today.getTime() <= endInclusive.getTime(),
  }
}

const range = computed(() => buildPeriodRange())
const customRangeInvalid = computed(() =>
  selectedPeriod.value === 'custom' && range.value === null,
)

const presetOptions = [
  { value: 'preset:today', label: PRESET_LABELS.today! },
  { value: 'preset:yesterday', label: PRESET_LABELS.yesterday! },
  { value: 'preset:last7', label: PRESET_LABELS.last7! },
  { value: 'preset:lastWeekend', label: PRESET_LABELS.lastWeekend! },
  { value: 'preset:last2months', label: PRESET_LABELS.last2months! },
  { value: 'custom', label: PRESET_LABELS.custom! },
]

function shortDateLabel(value: string): string {
  const date = parseDateOnly(value)
  return `${date.getDate()} ${monthNameOnly(date).slice(0, 3)}`
}

const monthOptions = computed(() => {
  const now = startOfMonth(new Date())
  return Array.from({ length: 12 }, (_, index) => {
    const date = addMonths(now, -index)
    const label = currentMonthLabel(date)
    const [month = label, year = ''] = label.split(' ')
    return {
      value: `month:${monthKey(date)}`,
      label,
      month,
      year,
      isCurrent: index === 0,
    }
  })
})

const periodLabel = computed(() => range.value?.label ?? PRESET_LABELS.custom!)
const rangeText = computed(() => {
  const r = range.value
  if (!r) return ''
  return rangeLabelText(parseDateOnly(r.startKey), parseDateOnly(r.endKey))
})

const isCurrentPeriod = computed(() => range.value?.isCurrent ?? false)

const netTotal = computed(() => incomeTotal.value - expenseTotal.value)

const savingsRate = computed(() => {
  if (incomeTotal.value <= 0) return null
  return (netTotal.value / incomeTotal.value) * 100
})

const expenseDelta = computed(() => {
  const previous = previousExpenseTotal.value
  if (previous === null || previous === 0 || expenseTotal.value === previous) return null
  const delta = ((expenseTotal.value - previous) / previous) * 100
  return {
    direction: delta > 0 ? 'up' : 'down',
    percent: Math.abs(delta),
    label: delta > 0 ? 'más' : 'menos',
    previousMonth: range.value?.previousLabel ?? '',
  }
})

const visibleCategories = computed(() =>
  [...categories.value]
    .filter(category => category.amount > 0)
    .sort((a, b) => b.amount - a.amount),
)

const visibleAccounts = computed(() =>
  [...accounts.value]
    .filter(account => account.incomes || account.expenses || account.transferIn || account.transferOut || account.debtImpact)
    .sort((a, b) => Math.abs(accountNet(b)) - Math.abs(accountNet(a))),
)

const hasMonthlyActivity = computed(() => monthlyActivityCount.value > 0)

function accountNet(account: AccountMovement): number {
  return account.incomes - account.expenses + account.transferIn - account.transferOut + account.debtImpact
}

function categoryPercent(amount: number): string {
  if (expenseTotal.value <= 0) return '0%'
  return `${((amount / expenseTotal.value) * 100).toFixed(0)}%`
}

function signedMoney(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}$${formatAmount(Math.abs(value))}`
}

function netClass(value: number): string {
  if (value > 0) return 'text-success'
  if (value < 0) return 'text-destructive'
  return 'text-muted-foreground'
}

function summarizeCategories(expenses: ExpenseRow[], previousExpenses: ExpenseRow[]): CategoryTotal[] {
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

function summarizeAccounts(
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

function buildInsights(expenses: ExpenseRow[], categoryTotals: CategoryTotal[], accountTotals: AccountMovement[]): Insight[] {
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

async function loadReport() {
  loadError.value = false
  isInitialLoading.value = true

  const current = range.value
  if (!current) {
    isInitialLoading.value = false
    return
  }
  const previous = current.previous

  try {
    const [
      accountsRes,
      expensesRes,
      incomesRes,
      transfersRes,
      debtMovementsRes,
      previousExpensesRes,
      debtBalancesRes,
      loansSummaryRes,
      openingRes,
    ] = await Promise.all([
      supabase.from('accounts').select('id, name, color').order('sort_order', { ascending: true }),
      supabase
        .from('expenses')
        .select('amount, expense_date, expense_time, created_at, account_id, description, category:categories(id, name, color)')
        .gte('expense_date', current.startKey)
        .lt('expense_date', current.nextKey)
        .order('expense_date', { ascending: false })
        .limit(1000),
      supabase
        .from('incomes')
        .select('amount, income_date, income_time, created_at, account_id, description')
        .gte('income_date', current.startKey)
        .lt('income_date', current.nextKey)
        .limit(1000),
      supabase
        .from('account_transfers')
        .select('amount, from_account_id, to_account_id, transfer_date, created_at, description')
        .gte('transfer_date', current.startKey)
        .lt('transfer_date', current.nextKey)
        .limit(1000),
      supabase
        .from('debt_movements')
        .select('amount, account_id, movement_date, created_at, description, debt:debts(direction, person:debt_people(name))')
        .gte('movement_date', current.startKey)
        .lt('movement_date', current.nextKey)
        .limit(1000),
      supabase
        .from('expenses')
        .select('amount, expense_date, account_id, category:categories(id, name, color)')
        .gte('expense_date', previous.startKey)
        .lt('expense_date', previous.nextKey)
        .limit(1000),
      supabase.from('debt_balances').select('balance, direction'),
      supabase.from('loans_summary').select('total_pending, total_receivable_remaining, active_loans_count').maybeSingle(),
      supabase.rpc('account_balances_before', { p_date: current.startKey }),
    ])

    if (
      accountsRes.error
      || expensesRes.error
      || incomesRes.error
      || transfersRes.error
      || debtMovementsRes.error
      || previousExpensesRes.error
      || debtBalancesRes.error
      || loansSummaryRes.error
      || openingRes.error
    ) {
      loadError.value = true
      return
    }

    const expenseRows = (expensesRes.data ?? []) as unknown as ExpenseRow[]
    const incomeRows = (incomesRes.data ?? []) as unknown as IncomeRow[]
    const transferRows = (transfersRes.data ?? []) as unknown as TransferRow[]
    const debtMovementRows = (debtMovementsRes.data ?? []) as unknown as DebtMovementRow[]
    const previousExpenseRows = (previousExpensesRes.data ?? []) as unknown as ExpenseRow[]

    openingById.value = new Map((openingRes.data ?? []).map(a => [a.account_id, a.balance]))
    openingAccounts.value = (openingRes.data ?? [])
      .filter(account => account.balance > 0)
      .map(account => ({ name: account.name, balance: account.balance }))
      .sort((a, b) => b.balance - a.balance)

    incomeTotal.value = incomeRows.reduce((sum, income) => sum + income.amount, 0)
    expenseTotal.value = expenseRows.reduce((sum, expense) => sum + expense.amount, 0)
    previousExpenseTotal.value = previousExpenseRows.reduce((sum, expense) => sum + expense.amount, 0)

    categories.value = summarizeCategories(expenseRows, previousExpenseRows)
    accounts.value = summarizeAccounts(accountsRes.data ?? [], expenseRows, incomeRows, transferRows, debtMovementRows)
    insights.value = buildInsights(expenseRows, categories.value, accounts.value)
    accountColorById.value = new Map(
      (accountsRes.data ?? []).flatMap(a => (a.color ? [[a.id, a.color] as [string, string]] : [])),
    )
    const accountNameById = new Map((accountsRes.data ?? []).map(a => [a.id, a.name]))
    const accountName = (id: string) => accountNameById.get(id) ?? '-'
    movementRows.value = [
      ...expenseRows.map((e): ReportPdfMovement => ({
        date: e.expense_date,
        type: 'Gasto',
        time: e.expense_time ?? null,
        createdAt: e.created_at ?? '',
        category: e.category?.name ?? '-',
        accountId: e.account_id,
        account: accountName(e.account_id),
        description: e.description ?? '',
        amount: -e.amount,
      })),
      ...incomeRows.map((i): ReportPdfMovement => ({
        date: i.income_date,
        type: 'Ingreso',
        time: i.income_time ?? null,
        createdAt: i.created_at ?? '',
        category: '-',
        accountId: i.account_id,
        account: accountName(i.account_id),
        description: i.description ?? '',
        amount: i.amount,
      })),
      // Cada transferencia aparece en las dos cuentas (salida y entrada).
      ...transferRows.flatMap((t): ReportPdfMovement[] => [
        {
          date: t.transfer_date ?? '',
          type: 'Transf. enviada',
          time: null,
          createdAt: t.created_at ?? '',
          category: `A ${accountName(t.to_account_id)}`,
          accountId: t.from_account_id,
          account: accountName(t.from_account_id),
          description: t.description ?? '',
          amount: -t.amount,
        },
        {
          date: t.transfer_date ?? '',
          type: 'Transf. recibida',
          time: null,
          createdAt: t.created_at ?? '',
          category: `De ${accountName(t.from_account_id)}`,
          accountId: t.to_account_id,
          account: accountName(t.to_account_id),
          description: t.description ?? '',
          amount: t.amount,
        },
      ]),
      // Solo los que mueven plata de una cuenta (mismo criterio que Transacciones).
      ...debtMovementRows
        .filter(d => d.account_id)
        .map((d): ReportPdfMovement => ({
          date: d.movement_date ?? '',
          type: 'Deuda',
          time: null,
          createdAt: d.created_at ?? '',
          category: d.debt?.person?.name ?? '-',
          accountId: d.account_id!,
          account: accountName(d.account_id!),
          description: d.description ?? '',
          amount: d.debt?.direction === 'lent' ? -d.amount : d.amount,
        })),
    ].sort((a, b) => b.date.localeCompare(a.date))
    monthlyActivityCount.value = expenseRows.length + incomeRows.length + transferRows.length + debtMovementRows.length

    totalReceivable.value = 0
    totalPayable.value = 0
    for (const debt of debtBalancesRes.data ?? []) {
      const balance = debt.balance ?? 0
      if (balance <= 0) continue
      if (debt.direction === 'lent') {
        totalReceivable.value += balance
      } else if (debt.direction === 'borrowed') {
        totalPayable.value += balance
      }
    }

    loanPending.value = (loansSummaryRes.data?.total_pending ?? 0) + (loansSummaryRes.data?.total_receivable_remaining ?? 0)
    pendingInstallments.value = loansSummaryRes.data?.active_loans_count ?? 0
  } finally {
    isInitialLoading.value = false
  }
}

function goToNewTransaction() {
  void router.push({ name: 'transactions', query: { new: '1' } })
}

watch([selectedPeriod, customFrom, customTo], () => {
  if (customRangeInvalid.value) return
  void loadReport()
})

async function exportPdf() {
  if (isExporting.value || !range.value) return
  isExporting.value = true
  try {
    await exportReportPdf({
      periodLabel: periodLabel.value,
      rangeText: rangeText.value,
      openingBalance: openingBalance.value,
      openingAccounts: openingAccounts.value,
      accountColors: Object.fromEntries(accountColorById.value),
      openingByAccountId: Object.fromEntries(openingById.value),
      incomeTotal: incomeTotal.value,
      expenseTotal: expenseTotal.value,
      netTotal: netTotal.value,
      categories: visibleCategories.value.map(c => ({
        name: c.name,
        amount: c.amount,
        percent: categoryPercent(c.amount),
      })),
      accounts: visibleAccounts.value.map(a => ({
        name: a.name,
        incomes: a.incomes,
        expenses: a.expenses,
        net: accountNet(a),
      })),
      insights: insights.value,
      movements: movementRows.value,
    })
    toast.success('PDF generado')
  } catch (error) {
    console.error('[reports] No se pudo generar el PDF', error)
    toast.error('No pudimos generar el PDF', { description: 'Intentá de nuevo.' })
  } finally {
    isExporting.value = false
  }
}

onMounted(loadReport)

// reports-detail-ux.md sección 2: navegación hacia las 3 pantallas nuevas de
// Reportes. Único agregado permitido a este archivo (restricción del PO).
const moreReportsLinks = [
  { to: { name: 'reports-summary' }, icon: LayoutDashboard, label: 'Resumen ampliado', description: 'Tiles, tendencia de 6 meses y hallazgos' },
  { to: { name: 'reports-detail' }, icon: Layers, label: 'Detalle del mes', description: 'Por tarjeta, por persona y métodos de pago' },
  { to: { name: 'reports-comparison' }, icon: GitCompareArrows, label: 'Comparación mensual', description: 'Compará dos meses cualquiera' },
]
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <AppHeader title="Reportes" />

    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <section class="flex flex-col gap-3">
        <!-- Pedido del usuario (mismo cambio ya hecho en Tarjetas): el
             heading grande de arriba repetía el mismo mes que ya muestra el
             selector de abajo — se saca ese heading duplicado, el selector
             queda como única referencia al período, centrado en la card. El
             Badge "Mes en curso"/"Cerrado" que vivía al lado del heading se
             reubica debajo del selector para no perder esa señal. -->
        <div class="rounded-lg border border-border bg-card p-4 shadow-card">
          <div class="flex flex-col items-center gap-2 text-center">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <CalendarSync class="size-5" />
            </div>

            <div class="w-full max-w-64">
              <p id="reports-period-label" class="text-xs font-medium text-muted-foreground">
                Periodo del reporte
              </p>
              <Select v-model="selectedPeriod">
                <SelectTrigger
                  aria-describedby="reports-period-label"
                  class="mt-1 !h-10 !w-full !justify-center !gap-1.5 !rounded-md !bg-background !px-3 text-base font-semibold transition-colors hover:!bg-accent hover:!text-accent-foreground"
                >
                  <SelectValue class="truncate capitalize">
                    {{ periodLabel }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent class="min-w-64 p-1">
                  <SelectItem
                    v-for="option in presetOptions"
                    :key="option.value"
                    :value="option.value"
                    :text-value="option.label"
                    class="rounded-md py-2.5 pr-9 pl-3"
                  >
                    <span class="font-medium">{{ option.label }}</span>
                  </SelectItem>
                  <SelectItem
                    v-for="option in monthOptions"
                    :key="option.value"
                    :value="option.value"
                    :text-value="option.label"
                    class="rounded-md py-2.5 pr-9 pl-3"
                  >
                    <div class="flex w-full items-center justify-between gap-3">
                      <span class="flex min-w-0 flex-col">
                        <span class="truncate font-medium capitalize">{{ option.month }}</span>
                        <span class="text-xs tabular-nums text-muted-foreground">{{ option.year }}</span>
                      </span>
                      <span
                        v-if="option.isCurrent"
                        class="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                      >
                        Actual
                      </span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div v-if="selectedPeriod === 'custom'" class="grid w-full max-w-64 grid-cols-2 gap-2 text-left">
              <div class="flex flex-col gap-1">
                <Label for="reporte-desde" class="text-xs">Desde</Label>
                <Input id="reporte-desde" v-model="customFrom" type="date" :max="customTo" />
              </div>
              <div class="flex flex-col gap-1">
                <Label for="reporte-hasta" class="text-xs">Hasta</Label>
                <Input id="reporte-hasta" v-model="customTo" type="date" :min="customFrom" />
              </div>
            </div>
            <p v-if="customRangeInvalid" class="text-xs text-destructive">
              Elegí un rango válido (la fecha final no puede ser anterior a la inicial).
            </p>

            <p v-if="rangeText" class="text-xs tabular-nums text-muted-foreground">
              {{ rangeText }}
            </p>

            <Badge variant="secondary">
              {{ isCurrentPeriod ? 'En curso' : 'Cerrado' }}
            </Badge>

            <Button
              variant="outline"
              size="sm"
              :disabled="isExporting || isInitialLoading || loadError || !hasMonthlyActivity"
              @click="exportPdf"
            >
              <Loader2 v-if="isExporting" class="size-4 animate-spin" />
              <Download v-else class="size-4" />
              Exportar PDF
            </Button>
          </div>
        </div>
      </section>

      <!-- reports-detail-ux.md sección 2: navegación a las 3 pantallas nuevas
           de Reportes. Siempre visible, fuera del v-if/v-else de estado, para
           que no quede escondida detrás de un error o un mes vacío. -->
      <section class="flex flex-col gap-3">
        <Card>
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Más reportes
            </CardTitle>
          </CardHeader>
          <nav class="flex flex-col gap-1 px-3 pb-3">
            <RouterLink
              v-for="item in moreReportsLinks"
              :key="item.to.name"
              :to="item.to"
              class="flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <span class="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <component :is="item.icon" class="size-4.5" />
              </span>
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate font-medium">{{ item.label }}</span>
                <span class="truncate text-xs text-muted-foreground">{{ item.description }}</span>
              </span>
              <ChevronRight class="size-4 shrink-0 text-muted-foreground" />
            </RouterLink>
          </nav>
        </Card>
      </section>

      <template v-if="isInitialLoading">
        <Card>
          <CardHeader>
            <Skeleton class="h-4 w-36" />
            <Skeleton class="mt-2 h-9 w-44" />
          </CardHeader>
          <div class="grid grid-cols-2 gap-3 px-6 pb-6">
            <Skeleton v-for="i in 4" :key="i" class="h-16" />
          </div>
        </Card>
        <Card v-for="i in 3" :key="i">
          <CardHeader>
            <Skeleton class="h-4 w-40" />
          </CardHeader>
          <div class="flex flex-col gap-3 px-6 pb-6">
            <Skeleton v-for="j in 3" :key="j" class="h-5 w-full" />
          </div>
        </Card>
      </template>

      <template v-else-if="loadError">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <AlertCircle class="size-12 text-destructive" />
          <h2 class="text-lg font-semibold">
            No pudimos cargar el reporte
          </h2>
          <p class="text-sm text-muted-foreground">
            Revisá tu conexión e intentá de nuevo.
          </p>
          <Button variant="outline" @click="loadReport">
            <RotateCcw class="size-4" />
            Reintentar
          </Button>
        </div>
      </template>

      <template v-else-if="!hasMonthlyActivity">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <FileText class="size-12 text-muted-foreground" />
          <h2 class="text-lg font-semibold">
            Sin movimientos en {{ periodLabel }}
          </h2>
          <p class="max-w-xs text-sm text-muted-foreground">
            Cuando registres ingresos, gastos, transferencias o movimientos de deuda,
            este reporte se va a completar automáticamente.
          </p>
          <Button v-if="isCurrentPeriod" @click="goToNewTransaction">
            <Plus class="size-4" />
            Agregar transacción
          </Button>
        </div>
      </template>

      <template v-else>
        <Card>
          <CardHeader>
            <CardDescription>Saldo al inicio</CardDescription>
            <CardTitle class="mt-1 text-2xl font-bold tabular-nums">
              ${{ formatAmount(openingBalance) }}
            </CardTitle>
            <p class="mt-1 text-xs text-muted-foreground">
              Suma de las cuentas con saldo positivo al {{ range ? shortDateLabel(range.startKey) : '' }}.
            </p>
          </CardHeader>
          <ul v-if="openingAccounts.length > 0" class="flex flex-col gap-1 px-6 pb-4 text-sm">
            <li v-for="account in openingAccounts" :key="account.name" class="flex items-center justify-between gap-3">
              <span class="truncate text-muted-foreground">{{ account.name }}</span>
              <span class="shrink-0 font-medium tabular-nums">${{ formatAmount(account.balance) }}</span>
            </li>
          </ul>
        </Card>

        <Card>
          <CardHeader>
            <div class="flex items-start justify-between gap-3">
              <div>
                <CardDescription>Resultado del periodo</CardDescription>
                <CardTitle class="mt-1 text-3xl font-bold tabular-nums" :class="netClass(netTotal)">
                  {{ signedMoney(netTotal) }}
                </CardTitle>
              </div>

              <Badge
                v-if="expenseDelta"
                variant="secondary"
                :class="expenseDelta.direction === 'up' ? 'text-destructive' : 'text-success'"
              >
                <ArrowUp v-if="expenseDelta.direction === 'up'" class="size-3" />
                <ArrowDown v-else class="size-3" />
                {{ expenseDelta.percent.toFixed(0) }}% {{ expenseDelta.label }} vs. {{ expenseDelta.previousMonth }}
              </Badge>
            </div>
          </CardHeader>

          <div class="grid grid-cols-2 gap-3 px-6 pb-6">
            <div class="rounded-lg border border-border p-3">
              <p class="text-xs text-muted-foreground">Ingresos</p>
              <p class="mt-1 text-lg font-semibold tabular-nums text-success">${{ formatAmount(incomeTotal) }}</p>
            </div>
            <div class="rounded-lg border border-border p-3">
              <p class="text-xs text-muted-foreground">Gastos</p>
              <p class="mt-1 text-lg font-semibold tabular-nums text-destructive">${{ formatAmount(expenseTotal) }}</p>
            </div>
            <div class="rounded-lg border border-border p-3">
              <p class="text-xs text-muted-foreground">Balance</p>
              <p class="mt-1 text-lg font-semibold tabular-nums" :class="netClass(netTotal)">{{ signedMoney(netTotal) }}</p>
            </div>
            <div class="rounded-lg border border-border p-3">
              <p class="text-xs text-muted-foreground">Ahorro</p>
              <p class="mt-1 text-lg font-semibold tabular-nums" :class="savingsRate !== null ? netClass(netTotal) : 'text-muted-foreground'">
                {{ savingsRate === null ? '—' : `${savingsRate.toFixed(0)}%` }}
              </p>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Gastos por categoría
            </CardTitle>
          </CardHeader>

          <div class="px-6 pb-6">
            <div v-if="visibleCategories.length" class="flex flex-col gap-3">
              <div v-for="category in visibleCategories" :key="category.id" class="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-sm">
                <div class="flex min-w-0 items-center gap-2">
                  <span class="size-2.5 shrink-0 rounded-full" :style="{ background: category.color ?? 'hsl(var(--muted-foreground))' }" />
                  <span class="truncate font-medium">{{ category.name }}</span>
                </div>
                <span class="tabular-nums">${{ formatAmount(category.amount) }}</span>
                <span class="w-10 text-right text-xs text-muted-foreground">{{ categoryPercent(category.amount) }}</span>
              </div>
            </div>
            <p v-else class="text-sm text-muted-foreground">
              No registraste gastos en este mes.
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Movimiento por cuenta
            </CardTitle>
          </CardHeader>

          <div class="flex flex-col gap-3 px-6 pb-6">
            <div v-for="account in visibleAccounts" :key="account.id" class="rounded-lg border border-border p-3">
              <div class="flex items-center justify-between gap-3">
                <div class="flex min-w-0 items-center gap-2">
                  <Wallet class="size-4 shrink-0 text-muted-foreground" />
                  <span class="truncate font-medium">{{ account.name }}</span>
                </div>
                <span class="text-sm font-semibold tabular-nums" :class="netClass(accountNet(account))">
                  {{ signedMoney(accountNet(account)) }}
                </span>
              </div>
              <div class="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>Ingresos: <strong class="font-medium text-success">${{ formatAmount(account.incomes) }}</strong></span>
                <span>Gastos: <strong class="font-medium text-destructive">${{ formatAmount(account.expenses) }}</strong></span>
                <span>Transferencias: <strong class="font-medium text-foreground">{{ signedMoney(account.transferIn - account.transferOut) }}</strong></span>
                <span>Deudas: <strong class="font-medium text-foreground">{{ signedMoney(account.debtImpact) }}</strong></span>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Deudas y préstamos
            </CardTitle>
          </CardHeader>

          <div class="grid grid-cols-2 gap-3 px-6 pb-6">
            <div class="rounded-lg border border-border p-3">
              <p class="text-xs text-muted-foreground">Te deben</p>
              <p class="mt-1 text-lg font-semibold tabular-nums">${{ formatAmount(totalReceivable) }}</p>
            </div>
            <div class="rounded-lg border border-border p-3">
              <p class="text-xs text-muted-foreground">Debes</p>
              <p class="mt-1 text-lg font-semibold tabular-nums">${{ formatAmount(totalPayable) }}</p>
            </div>
            <div class="col-span-2 rounded-lg border border-border p-3">
              <div class="flex items-center justify-between gap-3">
                <div class="flex min-w-0 items-center gap-2">
                  <Landmark class="size-4 text-muted-foreground" />
                  <span class="text-sm font-medium">Préstamos activos</span>
                </div>
                <span class="text-sm font-semibold tabular-nums">${{ formatAmount(loanPending) }}</span>
              </div>
              <p class="mt-1 text-xs text-muted-foreground">
                {{ pendingInstallments }} {{ pendingInstallments === 1 ? 'préstamo activo' : 'préstamos activos' }}
              </p>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Hallazgos
            </CardTitle>
          </CardHeader>

          <div class="px-6 pb-6">
            <dl v-if="insights.length" class="flex flex-col gap-3">
              <div v-for="insight in insights" :key="insight.label" class="flex items-start justify-between gap-3 text-sm">
                <dt class="text-muted-foreground">{{ insight.label }}</dt>
                <dd class="text-right font-medium">{{ insight.value }}</dd>
              </div>
            </dl>
            <p v-else class="text-sm text-muted-foreground">
              Todavía no hay suficientes gastos para generar hallazgos del mes.
            </p>
          </div>
        </Card>
      </template>
    </main>
  </div>
</template>
