<script setup lang="ts">
// reports-detail-ux.md sección 5: "Comparación mensual" — compara 2 meses
// CUALESQUIERA (no 3 consecutivos como FixedExpensesComparisonView, con la que
// no comparte componente). 2 selectores independientes (5.1), 4 tiles de
// variación A→B (5.2), tabla comparación por categoría (5.3) y gráfico de
// barras divergentes de variación % (5.4).
import { computed, onMounted, ref, watch } from 'vue'
import {
  AlertCircle,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Inbox,
  Minus,
  RotateCcw,
} from '@lucide/vue'
import AppHeader from '@/components/AppHeader.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import CategoryVariationBars, { type CategoryVariationRow } from '@/components/charts/CategoryVariationBars.vue'
import { formatAmount } from '@/lib/currency'
import { addMonths, currentMonthLabel, formatDateOnly, startOfMonth } from '@/lib/date'
import { supabase } from '@/lib/supabase'

interface ExpenseRow {
  amount: number
  category: { id: string, name: string, color: string | null } | null
}

interface IncomeRow {
  amount: number
}

interface MonthData {
  expenses: ExpenseRow[]
  incomes: IncomeRow[]
}

const isInitialLoading = ref(true)
const loadError = ref(false)

// Default (5.1): Mes A = mes anterior, Mes B = mes actual.
const monthA = ref(monthKey(addMonths(startOfMonth(new Date()), -1)))
const monthB = ref(monthKey(new Date()))

const dataA = ref<MonthData>({ expenses: [], incomes: [] })
const dataB = ref<MonthData>({ expenses: [], incomes: [] })

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
  return { startKey: formatDateOnly(start), nextKey: formatDateOnly(next) }
}

const monthOptions = computed(() => {
  const now = startOfMonth(new Date())
  return Array.from({ length: 12 }, (_, index) => {
    const date = addMonths(now, -index)
    const label = currentMonthLabel(date)
    const [month = label, year = ''] = label.split(' ')
    return { value: monthKey(date), label, month, year, isCurrent: index === 0 }
  })
})

const monthALabel = computed(() => currentMonthLabel(monthFromKey(monthA.value)))
const monthBLabel = computed(() => currentMonthLabel(monthFromKey(monthB.value)))

function totalExpenses(data: MonthData): number {
  return data.expenses.reduce((sum, row) => sum + row.amount, 0)
}
function totalIncomes(data: MonthData): number {
  return data.incomes.reduce((sum, row) => sum + row.amount, 0)
}

const expenseTotalA = computed(() => totalExpenses(dataA.value))
const expenseTotalB = computed(() => totalExpenses(dataB.value))
const incomeTotalA = computed(() => totalIncomes(dataA.value))
const incomeTotalB = computed(() => totalIncomes(dataB.value))
const netA = computed(() => incomeTotalA.value - expenseTotalA.value)
const netB = computed(() => incomeTotalB.value - expenseTotalB.value)
const savingsA = computed(() => (incomeTotalA.value <= 0 ? null : (netA.value / incomeTotalA.value) * 100))
const savingsB = computed(() => (incomeTotalB.value <= 0 ? null : (netB.value / incomeTotalB.value) * 100))

const hasAnyActivity = computed(() =>
  dataA.value.expenses.length + dataA.value.incomes.length
  + dataB.value.expenses.length + dataB.value.incomes.length > 0,
)

function signedMoney(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}$${formatAmount(Math.abs(value))}`
}

function netClass(value: number): string {
  if (value > 0) return 'text-success'
  if (value < 0) return 'text-destructive'
  return 'text-muted-foreground'
}

// --- Variación (5.2) — réplica de buildVariation de
// FixedExpensesComparisonView.vue (función privada de ese archivo; duplicación
// aceptada, ver sección 5.2 del doc). ---
interface Variation {
  direction: 'up' | 'down' | 'flat' | null
  percent: number | null
  amountDelta: number
}

function buildVariation(fromTotal: number | null, toTotal: number | null): Variation {
  if (fromTotal === null || toTotal === null) {
    return { direction: null, percent: null, amountDelta: 0 }
  }
  const amountDelta = toTotal - fromTotal
  if (amountDelta === 0) return { direction: 'flat', percent: 0, amountDelta: 0 }
  const percent = fromTotal > 0 ? Math.round((Math.abs(amountDelta) / fromTotal) * 1000) / 10 : null
  return { direction: amountDelta > 0 ? 'up' : 'down', percent, amountDelta }
}

interface TileDelta {
  direction: 'up' | 'down'
  label: string
  colorClass: string
}

function moneyTileDelta(fromValue: number, toValue: number, positiveIsGood: boolean): TileDelta | null {
  const variation = buildVariation(fromValue, toValue)
  if (variation.direction === null || variation.direction === 'flat') return null
  const direction = variation.direction
  const isGood = positiveIsGood ? direction === 'up' : direction === 'down'
  const label = variation.percent !== null
    ? `${variation.percent}% vs. Mes A`
    : `${signedMoney(variation.amountDelta)} vs. Mes A`
  return { direction, label, colorClass: isGood ? 'text-success' : 'text-destructive' }
}

// Ahorro (5.2): diferencia en puntos porcentuales, nunca "% de un %".
function savingsTileDelta(a: number | null, b: number | null): TileDelta | null {
  if (a === null || b === null) return null
  const delta = b - a
  if (Math.round(delta) === 0) return null
  const direction: 'up' | 'down' = delta > 0 ? 'up' : 'down'
  return {
    direction,
    label: `${Math.abs(Math.round(delta))} pp vs. Mes A`,
    colorClass: direction === 'up' ? 'text-success' : 'text-destructive',
  }
}

interface ComparisonTile {
  id: string
  label: string
  valueLabel: string
  valueClass: string
  delta: TileDelta | null
}

const comparisonTiles = computed<ComparisonTile[]>(() => {
  const tiles: ComparisonTile[] = [
    {
      id: 'expense',
      label: 'Gastos totales',
      valueLabel: `$${formatAmount(expenseTotalB.value)}`,
      valueClass: 'text-destructive',
      delta: moneyTileDelta(expenseTotalA.value, expenseTotalB.value, false),
    },
    {
      id: 'income',
      label: 'Ingresos totales',
      valueLabel: `$${formatAmount(incomeTotalB.value)}`,
      valueClass: 'text-success',
      delta: moneyTileDelta(incomeTotalA.value, incomeTotalB.value, true),
    },
    {
      id: 'balance',
      label: 'Balance',
      valueLabel: signedMoney(netB.value),
      valueClass: netClass(netB.value),
      delta: moneyTileDelta(netA.value, netB.value, true),
    },
  ]
  // Ahorro (5.2): se omite el tile completo si cualquiera de los 2 meses no
  // tiene ahorro calculable (ingresos <= 0) — no un "—", se omite.
  if (savingsA.value !== null && savingsB.value !== null) {
    tiles.push({
      id: 'savings',
      label: 'Ahorro',
      valueLabel: `${savingsB.value.toFixed(0)}%`,
      valueClass: netClass(netB.value),
      delta: savingsTileDelta(savingsA.value, savingsB.value),
    })
  }
  return tiles
})

// --- Comparación por categoría (5.3) ---
type ChangeType = 'percent' | 'new' | 'gone' | 'flat'

interface CategoryComparisonRow {
  categoryId: string
  categoryName: string
  color: string | null
  amountA: number
  amountB: number
  amountDelta: number
  direction: 'up' | 'down' | 'flat'
  percent: number | null
  changeType: ChangeType
}

function categoryMap(data: MonthData) {
  const map = new Map<string, { name: string, color: string | null, amount: number }>()
  for (const expense of data.expenses) {
    const category = expense.category
    const key = category?.id ?? 'uncategorized'
    const existing = map.get(key)
    if (existing) {
      existing.amount += expense.amount
    } else {
      map.set(key, { name: category?.name ?? 'Sin categoría', color: category?.color ?? null, amount: expense.amount })
    }
  }
  return map
}

const categoryComparison = computed<CategoryComparisonRow[]>(() => {
  const mapA = categoryMap(dataA.value)
  const mapB = categoryMap(dataB.value)
  const keys = new Set([...mapA.keys(), ...mapB.keys()])

  const rows: CategoryComparisonRow[] = []
  for (const key of keys) {
    const a = mapA.get(key)
    const b = mapB.get(key)
    const amountA = a?.amount ?? 0
    const amountB = b?.amount ?? 0
    if (amountA <= 0 && amountB <= 0) continue
    const amountDelta = amountB - amountA

    let direction: 'up' | 'down' | 'flat'
    let percent: number | null
    let changeType: ChangeType

    if (amountA === 0) {
      direction = 'up'
      percent = null
      changeType = 'new'
    } else if (amountB === 0) {
      direction = 'down'
      percent = null
      changeType = 'gone'
    } else if (amountDelta === 0) {
      direction = 'flat'
      percent = 0
      changeType = 'flat'
    } else {
      direction = amountDelta > 0 ? 'up' : 'down'
      percent = Math.round((Math.abs(amountDelta) / amountA) * 100)
      changeType = 'percent'
    }

    rows.push({
      categoryId: key,
      categoryName: (b ?? a)!.name,
      color: (b ?? a)!.color,
      amountA,
      amountB,
      amountDelta,
      direction,
      percent,
      changeType,
    })
  }

  // Orden por magnitud de variación absoluta desc (5.3).
  return rows.sort((x, y) => Math.abs(y.amountDelta) - Math.abs(x.amountDelta))
})

// Gráfico de variación % (5.4): solo categorías con % proporcional graficable
// (changeType 'percent' — excluye Nuevo/Ya no aparece, que no tienen base, y
// las sin cambio). Las excluidas siguen en la tabla de arriba.
const variationChartRows = computed<CategoryVariationRow[]>(() =>
  categoryComparison.value
    .filter(row => row.changeType === 'percent' && row.percent !== null)
    .map(row => ({
      id: row.categoryId,
      name: row.categoryName,
      percent: row.percent!,
      direction: row.direction as 'up' | 'down',
    })),
)

async function loadMonth(value: string): Promise<MonthData | null> {
  const range = monthRange(value)
  const [expensesRes, incomesRes] = await Promise.all([
    supabase
      .from('expenses')
      .select('amount, category:categories(id, name, color)')
      .gte('expense_date', range.startKey)
      .lt('expense_date', range.nextKey)
      .limit(1000),
    supabase
      .from('incomes')
      .select('amount')
      .gte('income_date', range.startKey)
      .lt('income_date', range.nextKey)
      .limit(1000),
  ])
  if (expensesRes.error || incomesRes.error) return null
  return {
    expenses: (expensesRes.data ?? []) as unknown as ExpenseRow[],
    incomes: (incomesRes.data ?? []) as unknown as IncomeRow[],
  }
}

async function loadComparison(): Promise<void> {
  loadError.value = false
  isInitialLoading.value = true
  try {
    const [resultA, resultB] = await Promise.all([loadMonth(monthA.value), loadMonth(monthB.value)])
    if (resultA === null || resultB === null) {
      loadError.value = true
      return
    }
    dataA.value = resultA
    dataB.value = resultB
  } finally {
    isInitialLoading.value = false
  }
}

watch([monthA, monthB], () => {
  void loadComparison()
})

onMounted(loadComparison)
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <AppHeader title="Comparación mensual" />

    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <!-- Selector de 2 meses (5.1) -->
      <Card>
        <div class="flex flex-col items-center gap-3 p-4 sm:flex-row sm:justify-center">
          <div class="w-full max-w-56 sm:w-56">
            <p id="comparison-month-a" class="text-xs font-medium text-muted-foreground">
              Mes A
            </p>
            <Select v-model="monthA">
              <SelectTrigger
                aria-labelledby="comparison-month-a"
                class="mt-1 !h-10 !w-full !justify-center !gap-1.5 !rounded-md !bg-background !px-3 text-base font-semibold transition-colors hover:!bg-accent hover:!text-accent-foreground"
              >
                <SelectValue class="truncate capitalize">
                  {{ monthALabel }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent class="min-w-56 p-1">
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
                    <span v-if="option.isCurrent" class="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                      Actual
                    </span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <ArrowLeftRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />

          <div class="w-full max-w-56 sm:w-56">
            <p id="comparison-month-b" class="text-xs font-medium text-muted-foreground">
              Mes B
            </p>
            <Select v-model="monthB">
              <SelectTrigger
                aria-labelledby="comparison-month-b"
                class="mt-1 !h-10 !w-full !justify-center !gap-1.5 !rounded-md !bg-background !px-3 text-base font-semibold transition-colors hover:!bg-accent hover:!text-accent-foreground"
              >
                <SelectValue class="truncate capitalize">
                  {{ monthBLabel }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent class="min-w-56 p-1">
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
                    <span v-if="option.isCurrent" class="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                      Actual
                    </span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <template v-if="isInitialLoading">
        <div class="grid grid-cols-2 gap-3">
          <Skeleton v-for="i in 4" :key="i" class="h-20" />
        </div>
        <Card v-for="i in 2" :key="i">
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
            No pudimos cargar la comparación
          </h2>
          <p class="text-sm text-muted-foreground">
            Revisá tu conexión e intentá de nuevo.
          </p>
          <Button variant="outline" @click="loadComparison">
            <RotateCcw class="size-4" />
            Reintentar
          </Button>
        </div>
      </template>

      <template v-else-if="!hasAnyActivity">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <Inbox class="size-12 text-muted-foreground" />
          <h2 class="text-lg font-semibold">
            Sin datos para comparar
          </h2>
          <p class="max-w-xs text-sm text-muted-foreground">
            Ninguno de los 2 meses tiene movimientos para comparar.
          </p>
        </div>
      </template>

      <template v-else>
        <!-- 4 tiles de variación A → B (5.2) -->
        <div class="grid grid-cols-2 gap-3">
          <Card v-for="tile in comparisonTiles" :key="tile.id">
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

        <!-- Comparación por categoría (5.3) -->
        <Card v-if="categoryComparison.length">
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Comparación por categoría
            </CardTitle>
          </CardHeader>
          <div class="flex flex-col gap-2 px-6 pb-6">
            <div
              v-for="row in categoryComparison"
              :key="row.categoryId"
              class="flex flex-col gap-1 rounded-lg border border-border p-3"
            >
              <div class="flex items-center justify-between gap-2">
                <div class="flex min-w-0 items-center gap-2">
                  <span class="size-2.5 shrink-0 rounded-full" :style="{ background: row.color ?? 'hsl(var(--muted-foreground))' }" />
                  <span class="truncate text-sm font-medium">{{ row.categoryName }}</span>
                </div>
                <Badge
                  v-if="row.changeType === 'percent'"
                  variant="secondary"
                  class="gap-1"
                  :class="row.direction === 'up' ? 'text-destructive' : 'text-success'"
                >
                  <component :is="row.direction === 'up' ? ArrowUp : ArrowDown" class="size-3" />
                  {{ row.percent }}%
                </Badge>
                <Badge v-else-if="row.changeType === 'new'" variant="secondary" class="text-destructive">
                  Nuevo
                </Badge>
                <Badge v-else-if="row.changeType === 'gone'" variant="secondary" class="text-success">
                  Ya no aparece
                </Badge>
                <Badge v-else variant="secondary" class="gap-1 text-muted-foreground">
                  <Minus class="size-3" />
                  0%
                </Badge>
              </div>
              <p class="text-xs tabular-nums text-muted-foreground">
                Mes A: ${{ formatAmount(row.amountA) }} · Mes B: ${{ formatAmount(row.amountB) }}
              </p>
            </div>
          </div>
        </Card>

        <!-- Gráfico de variación de gastos por categoría (5.4) -->
        <Card v-if="variationChartRows.length">
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Variación de gastos por categoría
            </CardTitle>
          </CardHeader>
          <div class="px-6 pb-6">
            <CategoryVariationBars :rows="variationChartRows" />
          </div>
        </Card>
      </template>
    </main>
  </div>
</template>
