<script setup lang="ts">
// reports-detail-ux.md sección 3: "Resumen del mes" — dashboard más rico,
// standalone (no reemplaza /reportes). Selector de mes propio (3.1), 4 tiles
// con variación vs. mes anterior (3.2), gráfico de barras de 6 meses global
// (3.3), dona top 6 (3.4), top gastos (3.5) e insights (3.6). Toda la lógica
// de insights se reusa desde src/lib/reportInsights.ts (duplicación
// intencional documentada por la restricción de no tocar ReportsView.vue).
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CalendarSync,
  FileText,
  Plus,
  RotateCcw,
} from '@lucide/vue'
import AppHeader from '@/components/AppHeader.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import CategoryDonutChart from '@/components/charts/CategoryDonutChart.vue'
import MonthlyBarChart from '@/components/charts/MonthlyBarChart.vue'
import { formatAmount } from '@/lib/currency'
import { withAlpha } from '@/lib/colors'
import { addMonths, currentMonthLabel, formatDateOnly, startOfMonth } from '@/lib/date'
import { buildDonutSlices, buildMonthlyBarPoints, type MonthlyBarPoint } from '@/lib/charts'
import {
  buildInsights,
  shortDateLabel,
  summarizeAccounts,
  summarizeCategories,
  type ExpenseRow,
  type Insight,
} from '@/lib/reportInsights'
import { supabase } from '@/lib/supabase'

// Gasto individual del mes seleccionado — extiende `ExpenseRow` de
// reportInsights con `description`/`icon` para la lista "Top gastos" (3.5).
// Estructuralmente asignable a `ExpenseRow`, así que las mismas filas
// alimentan `summarizeCategories`/`buildInsights` sin conversión.
interface DetailedExpenseRow {
  amount: number
  expense_date: string
  account_id: string
  description: string | null
  category: { id: string, name: string, color: string | null, icon: string | null } | null
}

interface IncomeRowLocal {
  amount: number
  income_date: string
  account_id: string
}

interface TransferRowLocal {
  amount: number
  from_account_id: string
  to_account_id: string
}

interface DebtMovementRowLocal {
  amount: number
  account_id: string | null
  debt: { direction: string | null } | null
}

const router = useRouter()

const isInitialLoading = ref(true)
const loadError = ref(false)
const selectedMonth = ref(monthKey(new Date()))

const incomeTotal = ref(0)
const expenseTotal = ref(0)
const previousIncomeTotal = ref(0)
const previousExpenseTotal = ref(0)
const currentExpenses = ref<DetailedExpenseRow[]>([])
const categoryTotals = ref<ReturnType<typeof summarizeCategories>>([])
const insights = ref<Insight[]>([])
const monthlyActivityCount = ref(0)

// Tendencia global de 6 meses (3.3): consulta única al montar, NO depende de
// `selectedMonth`. Si falla, se oculta la card en vez de romper la pantalla.
const monthlyTotals = ref<MonthlyBarPoint[]>([])

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthFromKey(value: string): Date {
  const [year, month] = value.split('-').map(Number)
  return new Date(year ?? new Date().getFullYear(), (month ?? 1) - 1, 1)
}

function monthRange(value: string) {
  const start = monthFromKey(value)
  const next = addMonths(start, 1)
  return {
    startKey: formatDateOnly(start),
    nextKey: formatDateOnly(next),
    start,
  }
}

const monthOptions = computed(() => {
  const now = startOfMonth(new Date())
  return Array.from({ length: 12 }, (_, index) => {
    const date = addMonths(now, -index)
    const label = currentMonthLabel(date)
    const [month = label, year = ''] = label.split(' ')
    return {
      value: monthKey(date),
      label,
      month,
      year,
      isCurrent: index === 0,
    }
  })
})

const monthLabel = computed(() => currentMonthLabel(monthFromKey(selectedMonth.value)))
const isCurrentMonth = computed(() => selectedMonth.value === monthKey(new Date()))

const netTotal = computed(() => incomeTotal.value - expenseTotal.value)
const previousNetTotal = computed(() => previousIncomeTotal.value - previousExpenseTotal.value)

const savingsRate = computed(() => (incomeTotal.value <= 0 ? null : (netTotal.value / incomeTotal.value) * 100))
const previousSavingsRate = computed(() =>
  previousIncomeTotal.value <= 0 ? null : (previousNetTotal.value / previousIncomeTotal.value) * 100,
)

const hasMonthlyActivity = computed(() => monthlyActivityCount.value > 0)

function signedMoney(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}$${formatAmount(Math.abs(value))}`
}

function netClass(value: number): string {
  if (value > 0) return 'text-success'
  if (value < 0) return 'text-destructive'
  return 'text-muted-foreground'
}

interface TileDelta {
  direction: 'up' | 'down'
  label: string
  colorClass: string
}

// Variación de un tile de dinero (3.2): % cuando el mes anterior tiene base
// > 0, delta absoluto cuando no (base 0/negativa → un % sería engañoso), y se
// omite el badge por completo cuando no hay diferencia. `positiveIsGood`
// define la semántica de color por métrica (gastos: subir = malo; ingresos/
// balance: subir = bueno).
function buildMoneyDelta(current: number, previous: number, positiveIsGood: boolean): TileDelta | null {
  const delta = current - previous
  if (delta === 0) return null
  const direction: 'up' | 'down' = delta > 0 ? 'up' : 'down'
  const isGood = positiveIsGood ? direction === 'up' : direction === 'down'
  const colorClass = isGood ? 'text-success' : 'text-destructive'
  const label = previous > 0
    ? `${Math.round((Math.abs(delta) / previous) * 100)}% vs. mes anterior`
    : `${signedMoney(delta)} vs. mes anterior`
  return { direction, label, colorClass }
}

// Variación del tile "Ahorro" (3.2): diferencia en puntos porcentuales (nunca
// "% de un %"). Si cualquiera de los 2 meses no tiene ahorro calculable
// (ingresos <= 0), se omite el badge — no se inventa.
function buildSavingsDelta(current: number | null, previous: number | null): TileDelta | null {
  if (current === null || previous === null) return null
  const delta = current - previous
  if (Math.round(delta) === 0) return null
  const direction: 'up' | 'down' = delta > 0 ? 'up' : 'down'
  return {
    direction,
    label: `${Math.abs(Math.round(delta))} pp vs. mes anterior`,
    colorClass: direction === 'up' ? 'text-success' : 'text-destructive',
  }
}

interface SummaryTile {
  id: string
  label: string
  valueLabel: string
  valueClass: string
  delta: TileDelta | null
}

const summaryTiles = computed<SummaryTile[]>(() => [
  {
    id: 'expense',
    label: 'Total gastado',
    valueLabel: `$${formatAmount(expenseTotal.value)}`,
    valueClass: 'text-destructive',
    delta: buildMoneyDelta(expenseTotal.value, previousExpenseTotal.value, false),
  },
  {
    id: 'income',
    label: 'Total ingresos',
    valueLabel: `$${formatAmount(incomeTotal.value)}`,
    valueClass: 'text-success',
    delta: buildMoneyDelta(incomeTotal.value, previousIncomeTotal.value, true),
  },
  {
    id: 'balance',
    label: 'Balance',
    valueLabel: signedMoney(netTotal.value),
    valueClass: netClass(netTotal.value),
    delta: buildMoneyDelta(netTotal.value, previousNetTotal.value, true),
  },
  {
    id: 'savings',
    label: 'Ahorro',
    valueLabel: savingsRate.value === null ? '—' : `${savingsRate.value.toFixed(0)}%`,
    valueClass: savingsRate.value === null ? 'text-muted-foreground' : netClass(netTotal.value),
    delta: buildSavingsDelta(savingsRate.value, previousSavingsRate.value),
  },
])

const donutSlices = computed(() => buildDonutSlices(categoryTotals.value))

// Top 5 gastos individuales del mes, orden desc (3.5). Filas no clickeables.
const topExpenses = computed(() =>
  [...currentExpenses.value]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5)
    .map((expense, idx) => ({
      key: `${expense.expense_date}-${idx}`,
      title: expense.description || expense.category?.name || 'Gasto',
      dateLabel: shortDateLabel(expense.expense_date),
      amount: expense.amount,
      color: expense.category?.color ?? null,
      icon: expense.category?.icon ?? null,
    })),
)

async function loadMonthlyTotals(): Promise<void> {
  const { data, error } = await supabase
    .from('monthly_expense_income_totals')
    .select('month_start, expense_total, income_total')
    .order('month_start', { ascending: true })

  monthlyTotals.value = error ? [] : buildMonthlyBarPoints(data ?? [])
}

async function loadReport(): Promise<void> {
  loadError.value = false
  isInitialLoading.value = true

  const current = monthRange(selectedMonth.value)
  const previous = monthRange(monthKey(addMonths(current.start, -1)))

  try {
    const [
      accountsRes,
      expensesRes,
      previousExpensesRes,
      incomesRes,
      previousIncomesRes,
      transfersRes,
      debtMovementsRes,
    ] = await Promise.all([
      supabase.from('accounts').select('id, name').order('sort_order', { ascending: true }),
      supabase
        .from('expenses')
        .select('amount, expense_date, account_id, description, category:categories(id, name, color, icon)')
        .gte('expense_date', current.startKey)
        .lt('expense_date', current.nextKey)
        .order('expense_date', { ascending: false })
        .limit(1000),
      supabase
        .from('expenses')
        .select('amount, expense_date, account_id, category:categories(id, name, color)')
        .gte('expense_date', previous.startKey)
        .lt('expense_date', previous.nextKey)
        .limit(1000),
      supabase
        .from('incomes')
        .select('amount, income_date, account_id')
        .gte('income_date', current.startKey)
        .lt('income_date', current.nextKey)
        .limit(1000),
      supabase
        .from('incomes')
        .select('amount, income_date, account_id')
        .gte('income_date', previous.startKey)
        .lt('income_date', previous.nextKey)
        .limit(1000),
      supabase
        .from('account_transfers')
        .select('amount, from_account_id, to_account_id')
        .gte('transfer_date', current.startKey)
        .lt('transfer_date', current.nextKey)
        .limit(1000),
      supabase
        .from('debt_movements')
        .select('amount, account_id, debt:debts(direction)')
        .gte('movement_date', current.startKey)
        .lt('movement_date', current.nextKey)
        .limit(1000),
    ])

    if (
      accountsRes.error
      || expensesRes.error
      || previousExpensesRes.error
      || incomesRes.error
      || previousIncomesRes.error
      || transfersRes.error
      || debtMovementsRes.error
    ) {
      loadError.value = true
      return
    }

    const expenseRows = (expensesRes.data ?? []) as unknown as DetailedExpenseRow[]
    const previousExpenseRows = (previousExpensesRes.data ?? []) as unknown as ExpenseRow[]
    const incomeRows = (incomesRes.data ?? []) as unknown as IncomeRowLocal[]
    const previousIncomeRows = (previousIncomesRes.data ?? []) as unknown as IncomeRowLocal[]
    const transferRows = (transfersRes.data ?? []) as unknown as TransferRowLocal[]
    const debtMovementRows = (debtMovementsRes.data ?? []) as unknown as DebtMovementRowLocal[]

    currentExpenses.value = expenseRows
    incomeTotal.value = incomeRows.reduce((sum, income) => sum + income.amount, 0)
    expenseTotal.value = expenseRows.reduce((sum, expense) => sum + expense.amount, 0)
    previousIncomeTotal.value = previousIncomeRows.reduce((sum, income) => sum + income.amount, 0)
    previousExpenseTotal.value = previousExpenseRows.reduce((sum, expense) => sum + expense.amount, 0)

    categoryTotals.value = summarizeCategories(expenseRows, previousExpenseRows)
    const accountTotals = summarizeAccounts(accountsRes.data ?? [], expenseRows, incomeRows, transferRows, debtMovementRows)
    insights.value = buildInsights(expenseRows, categoryTotals.value, accountTotals)
    monthlyActivityCount.value = expenseRows.length + incomeRows.length + transferRows.length + debtMovementRows.length
  } finally {
    isInitialLoading.value = false
  }
}

function goToNewTransaction(): void {
  void router.push({ name: 'transactions', query: { new: '1' } })
}

function goToTransactions(): void {
  void router.push({ name: 'transactions' })
}

watch(selectedMonth, () => {
  void loadReport()
})

onMounted(() => {
  void loadMonthlyTotals()
  void loadReport()
})
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <AppHeader title="Resumen del mes" />

    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <!-- Selector de mes (3.1): mismo patrón exacto que ReportsView.vue -->
      <section class="flex flex-col gap-3">
        <div class="rounded-lg border border-border bg-card p-4 shadow-card">
          <div class="flex flex-col items-center gap-2 text-center">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <CalendarSync class="size-5" />
            </div>

            <div class="w-full max-w-64">
              <p id="summary-period-label" class="text-xs font-medium text-muted-foreground">
                Periodo del reporte
              </p>
              <Select v-model="selectedMonth">
                <SelectTrigger
                  aria-describedby="summary-period-label"
                  class="mt-1 !h-10 !w-full !justify-center !gap-1.5 !rounded-md !bg-background !px-3 text-base font-semibold transition-colors hover:!bg-accent hover:!text-accent-foreground"
                >
                  <SelectValue class="truncate capitalize">
                    {{ monthLabel }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent class="min-w-64 p-1">
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

            <Badge variant="secondary">
              {{ isCurrentMonth ? 'Mes en curso' : 'Cerrado' }}
            </Badge>
          </div>
        </div>
      </section>

      <template v-if="isInitialLoading">
        <div class="grid grid-cols-2 gap-3">
          <Skeleton v-for="i in 4" :key="i" class="h-20" />
        </div>
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
            No pudimos cargar el resumen
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
            Sin movimientos en {{ monthLabel }}
          </h2>
          <p class="max-w-xs text-sm text-muted-foreground">
            Cuando registres ingresos, gastos, transferencias o movimientos de deuda,
            este resumen se va a completar automáticamente.
          </p>
          <Button v-if="isCurrentMonth" @click="goToNewTransaction">
            <Plus class="size-4" />
            Agregar transacción
          </Button>
        </div>
      </template>

      <template v-else>
        <!-- 4 tiles con variación vs. mes anterior (3.2) -->
        <div class="grid grid-cols-2 gap-3">
          <Card v-for="tile in summaryTiles" :key="tile.id">
            <div class="flex flex-col gap-1 p-4">
              <p class="text-xs text-muted-foreground">
                {{ tile.label }}
              </p>
              <p class="text-lg font-semibold tabular-nums" :class="tile.valueClass">
                {{ tile.valueLabel }}
              </p>
              <span
                v-if="tile.delta"
                class="flex items-center gap-1 text-xs font-medium"
                :class="tile.delta.colorClass"
              >
                <component :is="tile.delta.direction === 'up' ? ArrowUp : ArrowDown" class="size-3" />
                {{ tile.delta.label }}
              </span>
            </div>
          </Card>
        </div>

        <!-- Ingresos vs. gastos, últimos 6 meses (3.3) -->
        <Card v-if="monthlyTotals.length">
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Ingresos vs. gastos
            </CardTitle>
            <CardDescription>Últimos 6 meses</CardDescription>
          </CardHeader>
          <MonthlyBarChart
            :points="monthlyTotals"
            class="px-6 pb-4"
            :height="140"
            ariaLabel="Ingresos y gastos mensuales de los últimos 6 meses"
          />
        </Card>

        <!-- Gastos por categoría, top 6 (3.4) -->
        <Card v-if="donutSlices.length">
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Gastos por categoría
            </CardTitle>
          </CardHeader>
          <div class="flex flex-col items-center gap-4 px-6 pb-6 sm:flex-row sm:items-center">
            <CategoryDonutChart :slices="donutSlices" class="size-32 shrink-0" />
            <ul class="flex w-full flex-col gap-2">
              <li v-for="slice in donutSlices" :key="slice.id" class="flex items-center gap-2 text-sm">
                <span class="size-2.5 shrink-0 rounded-full" :style="{ background: slice.color ?? 'hsl(var(--muted-foreground))' }" />
                <span class="flex-1 truncate font-medium">{{ slice.name }}</span>
                <span class="tabular-nums">${{ formatAmount(slice.amount) }}</span>
                <span class="w-10 text-right text-xs text-muted-foreground">{{ slice.percentLabel }}</span>
              </li>
            </ul>
          </div>
        </Card>

        <!-- Top gastos, top 5 (3.5) — filas no clickeables -->
        <Card v-if="topExpenses.length">
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Top gastos
            </CardTitle>
            <CardAction>
              <Button variant="link" size="sm" class="h-auto p-0" @click="goToTransactions">
                Ver todos
              </Button>
            </CardAction>
          </CardHeader>
          <div class="flex flex-col">
            <template v-for="(item, idx) in topExpenses" :key="item.key">
              <Separator v-if="idx > 0" />
              <div class="flex items-center gap-3 px-6 py-3">
                <span
                  class="flex size-9 shrink-0 items-center justify-center rounded-full border"
                  :style="{ backgroundColor: withAlpha(item.color, 0.12), borderColor: item.color ?? undefined }"
                >
                  <span v-if="item.icon" class="text-sm leading-none">{{ item.icon }}</span>
                </span>
                <div class="flex min-w-0 flex-1 flex-col">
                  <p class="truncate text-sm font-medium">
                    {{ item.title }}
                  </p>
                  <p class="truncate text-xs text-muted-foreground">
                    {{ item.dateLabel }}
                  </p>
                </div>
                <p class="text-sm font-semibold tabular-nums text-destructive">
                  ${{ formatAmount(item.amount) }}
                </p>
              </div>
            </template>
          </div>
        </Card>

        <!-- Insights del mes (3.6) -->
        <Card>
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Insights del mes
            </CardTitle>
          </CardHeader>
          <div class="px-6 pb-6">
            <dl v-if="insights.length" class="flex flex-col gap-3">
              <div v-for="insight in insights" :key="insight.label" class="flex items-start justify-between gap-3 text-sm">
                <dt class="text-muted-foreground">
                  {{ insight.label }}
                </dt>
                <dd class="text-right font-medium">
                  {{ insight.value }}
                </dd>
              </div>
            </dl>
            <p v-else class="text-sm text-muted-foreground">
              Todavía no hay suficientes gastos para generar insights del mes.
            </p>
          </div>
        </Card>
      </template>
    </main>
  </div>
</template>
