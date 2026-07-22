<script setup lang="ts">
// reports-detail-ux.md sección 4: "Detalle del mes" — desglose del mes por
// tarjeta (4.2), por persona (4.3), mayores gastos (4.4), métodos de pago
// (4.5) y resumen de transacciones por categoría (4.6). "Por tarjeta"/"Por
// persona"/"Métodos de pago" viven en el dominio de tarjeta (card_expenses);
// "Mayores gastos"/"Resumen" en el dominio de gasto personal (expenses) — ver
// recap de fuentes en sección 4.1.
import { computed, onMounted, ref, watch } from 'vue'
import {
  AlertCircle,
  CalendarSync,
  CreditCard as CreditCardIcon,
  FileText,
  RotateCcw,
  User,
} from '@lucide/vue'
import AppHeader from '@/components/AppHeader.vue'
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
import { Separator } from '@/components/ui/separator'
import CategoryDonutChart from '@/components/charts/CategoryDonutChart.vue'
import { formatAmount } from '@/lib/currency'
import { readableTextColor, withAlpha } from '@/lib/colors'
import { addMonths, currentMonthLabel, formatDateOnly, startOfMonth } from '@/lib/date'
import { shortDateLabel } from '@/lib/reportInsights'
import type { DonutSlice } from '@/lib/charts'
import { supabase } from '@/lib/supabase'

interface CardExpenseRow {
  amount: number
  card_id: string
  person_id: string | null
  expense_date: string
}

interface ExpenseRow {
  amount: number
  expense_date: string
  description: string | null
  category: { id: string, name: string, color: string | null, icon: string | null } | null
}

interface CardRef {
  id: string
  name: string
  color: string | null
}

interface PersonRef {
  id: string
  name: string
  color: string | null
}

const isInitialLoading = ref(true)
const loadError = ref(false)
const selectedMonth = ref(monthKey(new Date()))

const cardExpenses = ref<CardExpenseRow[]>([])
const expenses = ref<ExpenseRow[]>([])
const cards = ref<CardRef[]>([])
const people = ref<PersonRef[]>([])

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

const monthLabel = computed(() => currentMonthLabel(monthFromKey(selectedMonth.value)))

const cardExpensesTotal = computed(() => cardExpenses.value.reduce((sum, row) => sum + row.amount, 0))
const accountExpensesTotal = computed(() => expenses.value.reduce((sum, row) => sum + row.amount, 0))

const hasActivity = computed(() => cardExpenses.value.length > 0 || expenses.value.length > 0)

function percentLabelOf(amount: number, total: number): string {
  return total === 0 ? '0%' : `${Math.round((amount / total) * 100)}%`
}

// "Por tarjeta" (4.2): card_expenses agrupados por card_id, cruzado con
// credit_cards. Solo tarjetas con gasto en el mes (un reporte histórico no
// necesita listar tarjetas sin movimiento), ordenadas desc, con barra
// escalada contra el máximo del set.
const cardRanking = computed(() => {
  const totals = new Map<string, number>()
  for (const row of cardExpenses.value) {
    totals.set(row.card_id, (totals.get(row.card_id) ?? 0) + row.amount)
  }
  const rows = [...totals.entries()].map(([cardId, amount]) => {
    const card = cards.value.find(c => c.id === cardId)
    return { id: cardId, name: card?.name ?? 'Tarjeta', color: card?.color ?? null, amount }
  }).sort((a, b) => b.amount - a.amount)

  const max = Math.max(0, ...rows.map(r => r.amount))
  return rows.map(r => ({
    ...r,
    percentOfMax: max === 0 ? 0 : (r.amount / max) * 100,
    percentLabel: percentLabelOf(r.amount, cardExpensesTotal.value),
  }))
})

// "Por persona" (4.3): mismo patrón que peopleRanking de CardsDashboardView —
// bucket sintético 'none' = "Sin persona asignada" (sin color propio).
const peopleRanking = computed(() => {
  const totals = new Map<string, number>()
  for (const row of cardExpenses.value) {
    const key = row.person_id ?? 'none'
    totals.set(key, (totals.get(key) ?? 0) + row.amount)
  }
  const rows = [...totals.entries()].map(([key, amount]) => {
    if (key === 'none') return { id: 'none', name: 'Sin persona asignada', amount, color: null as string | null }
    const person = people.value.find(p => p.id === key)
    return { id: key, name: person?.name ?? 'Persona', amount, color: person?.color ?? null }
  }).sort((a, b) => b.amount - a.amount)

  const max = Math.max(0, ...rows.map(r => r.amount))
  return rows.map(r => ({
    ...r,
    percentOfMax: max === 0 ? 0 : (r.amount / max) * 100,
    percentLabel: percentLabelOf(r.amount, cardExpensesTotal.value),
  }))
})

// "Métodos de pago" (4.5): dona de 2 slices fijos, Tarjeta vs. Cuenta. Colores
// sintéticos (primary/muted-foreground), no de una categoría/tarjeta real.
const paymentMethodSlices = computed<DonutSlice[]>(() => {
  const total = cardExpensesTotal.value + accountExpensesTotal.value
  if (total === 0) return []
  return [
    {
      id: 'card',
      name: 'Tarjeta',
      color: 'hsl(var(--primary))',
      amount: cardExpensesTotal.value,
      percentLabel: percentLabelOf(cardExpensesTotal.value, total),
    },
    {
      id: 'account',
      name: 'Cuenta',
      color: 'hsl(var(--muted-foreground))',
      amount: accountExpensesTotal.value,
      percentLabel: percentLabelOf(accountExpensesTotal.value, total),
    },
  ]
})

// "Mayores gastos" (4.4): top 10 gastos individuales del mes.
const topExpenses = computed(() =>
  [...expenses.value]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10)
    .map((expense, idx) => ({
      key: `${expense.expense_date}-${idx}`,
      title: expense.description || expense.category?.name || 'Gasto',
      dateLabel: shortDateLabel(expense.expense_date),
      amount: expense.amount,
      color: expense.category?.color ?? null,
      icon: expense.category?.icon ?? null,
    })),
)

// "Resumen de transacciones" (4.6): expenses agrupados por categoría, con
// cantidad de transacciones, ordenados por monto desc.
const transactionsSummary = computed(() => {
  const totals = new Map<string, { categoryId: string, categoryName: string, color: string | null, amount: number, count: number }>()
  for (const expense of expenses.value) {
    const category = expense.category
    const key = category?.id ?? 'uncategorized'
    const existing = totals.get(key)
    if (existing) {
      existing.amount += expense.amount
      existing.count += 1
    } else {
      totals.set(key, {
        categoryId: key,
        categoryName: category?.name ?? 'Sin categoría',
        color: category?.color ?? null,
        amount: expense.amount,
        count: 1,
      })
    }
  }
  return [...totals.values()]
    .sort((a, b) => b.amount - a.amount)
    .map(row => ({ ...row, percentLabel: percentLabelOf(row.amount, accountExpensesTotal.value) }))
})

async function loadDetail(): Promise<void> {
  loadError.value = false
  isInitialLoading.value = true

  const range = monthRange(selectedMonth.value)

  try {
    const [cardExpensesRes, expensesRes, cardsRes, peopleRes] = await Promise.all([
      supabase
        .from('card_expenses')
        .select('amount, card_id, person_id, expense_date')
        .gte('expense_date', range.startKey)
        .lt('expense_date', range.nextKey)
        .limit(1000),
      supabase
        .from('expenses')
        .select('amount, expense_date, description, category:categories(id, name, color, icon)')
        .gte('expense_date', range.startKey)
        .lt('expense_date', range.nextKey)
        .order('expense_date', { ascending: false })
        .limit(1000),
      supabase.from('credit_cards').select('id, name, color'),
      supabase.from('card_people').select('id, name, color'),
    ])

    if (cardExpensesRes.error || expensesRes.error || cardsRes.error || peopleRes.error) {
      loadError.value = true
      return
    }

    cardExpenses.value = (cardExpensesRes.data ?? []) as unknown as CardExpenseRow[]
    expenses.value = (expensesRes.data ?? []) as unknown as ExpenseRow[]
    cards.value = (cardsRes.data ?? []) as CardRef[]
    people.value = (peopleRes.data ?? []) as PersonRef[]
  } finally {
    isInitialLoading.value = false
  }
}

watch(selectedMonth, () => {
  void loadDetail()
})

onMounted(loadDetail)
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <AppHeader title="Detalle del mes" />

    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <!-- Selector de mes (4/3.1) -->
      <section class="flex flex-col gap-3">
        <div class="rounded-lg border border-border bg-card p-4 shadow-card">
          <div class="flex flex-col items-center gap-2 text-center">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <CalendarSync class="size-5" />
            </div>

            <div class="w-full max-w-64">
              <p id="detail-period-label" class="text-xs font-medium text-muted-foreground">
                Periodo del reporte
              </p>
              <Select v-model="selectedMonth">
                <SelectTrigger
                  aria-describedby="detail-period-label"
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
          </div>
        </div>
      </section>

      <template v-if="isInitialLoading">
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
            No pudimos cargar el detalle
          </h2>
          <p class="text-sm text-muted-foreground">
            Revisá tu conexión e intentá de nuevo.
          </p>
          <Button variant="outline" @click="loadDetail">
            <RotateCcw class="size-4" />
            Reintentar
          </Button>
        </div>
      </template>

      <template v-else-if="!hasActivity">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <FileText class="size-12 text-muted-foreground" />
          <h2 class="text-lg font-semibold">
            Sin gastos en {{ monthLabel }}
          </h2>
          <p class="max-w-xs text-sm text-muted-foreground">
            Cuando registres gastos de cuenta o de tarjeta, el detalle del mes se
            va a completar automáticamente.
          </p>
        </div>
      </template>

      <template v-else>
        <!-- Por tarjeta (4.2) -->
        <Card v-if="cardRanking.length">
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Por tarjeta
            </CardTitle>
          </CardHeader>
          <div class="flex flex-col gap-3 px-6 pb-6">
            <div v-for="card in cardRanking" :key="card.id" class="flex items-center gap-3">
              <span
                class="flex size-6 shrink-0 items-center justify-center rounded-full"
                :style="{ background: card.color ?? 'hsl(var(--muted))' }"
              >
                <CreditCardIcon class="size-3.5" :style="{ color: readableTextColor(card.color) }" />
              </span>
              <span class="w-20 shrink-0 truncate text-xs text-muted-foreground">{{ card.name }}</span>
              <div class="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div class="h-full rounded-full" :style="{ width: `${card.percentOfMax}%`, background: card.color ?? 'hsl(var(--muted-foreground))' }" />
              </div>
              <span class="w-14 shrink-0 text-right text-xs font-medium tabular-nums">{{ card.percentLabel }}</span>
            </div>
          </div>
        </Card>

        <!-- Por persona (4.3) -->
        <Card v-if="peopleRanking.length">
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Por persona
            </CardTitle>
          </CardHeader>
          <div class="flex flex-col gap-3 px-6 pb-6">
            <div v-for="person in peopleRanking" :key="person.id" class="flex items-center gap-3">
              <span
                v-if="person.color"
                class="flex size-6 shrink-0 items-center justify-center rounded-full"
                :style="{ background: person.color }"
              >
                <User class="size-3.5" :style="{ color: readableTextColor(person.color) }" />
              </span>
              <span v-else class="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
                <User class="size-3.5 text-muted-foreground" />
              </span>
              <span class="w-20 shrink-0 truncate text-xs text-muted-foreground">{{ person.name }}</span>
              <div class="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div class="h-full rounded-full" :style="{ width: `${person.percentOfMax}%`, background: person.color ?? 'hsl(var(--muted-foreground))' }" />
              </div>
              <span class="w-14 shrink-0 text-right text-xs font-medium tabular-nums">{{ person.percentLabel }}</span>
            </div>
          </div>
        </Card>

        <!-- Métodos de pago (4.5) -->
        <Card v-if="paymentMethodSlices.length">
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Métodos de pago
            </CardTitle>
            <CardDescription>Tarjeta vs. cuenta</CardDescription>
          </CardHeader>
          <div class="flex flex-col items-center gap-4 px-6 pb-6 sm:flex-row sm:items-center">
            <CategoryDonutChart :slices="paymentMethodSlices" class="size-32 shrink-0" />
            <ul class="flex w-full flex-col gap-2">
              <li v-for="slice in paymentMethodSlices" :key="slice.id" class="flex items-center gap-2 text-sm">
                <span class="size-2.5 shrink-0 rounded-full" :style="{ background: slice.color ?? 'hsl(var(--muted-foreground))' }" />
                <span class="flex-1 truncate font-medium">{{ slice.name }}</span>
                <span class="tabular-nums">${{ formatAmount(slice.amount) }}</span>
                <span class="w-10 text-right text-xs text-muted-foreground">{{ slice.percentLabel }}</span>
              </li>
            </ul>
          </div>
        </Card>

        <!-- Mayores gastos (4.4): top 10, filas no clickeables -->
        <Card v-if="topExpenses.length">
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Mayores gastos
            </CardTitle>
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

        <!-- Resumen de transacciones (4.6): card-list de 4 columnas -->
        <Card v-if="transactionsSummary.length">
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Resumen de transacciones
            </CardTitle>
          </CardHeader>
          <div class="flex flex-col gap-2 px-6 pb-6">
            <!-- Encabezado de columnas explícito (a11y, sección 8.7) -->
            <div class="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 text-xs uppercase text-muted-foreground">
              <span>Categoría</span>
              <span class="w-8 text-right">Cant.</span>
              <span class="text-right">Monto</span>
              <span class="w-10 text-right">%</span>
            </div>
            <div v-for="row in transactionsSummary" :key="row.categoryId" class="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 text-sm">
              <div class="flex min-w-0 items-center gap-2">
                <span class="size-2.5 shrink-0 rounded-full" :style="{ background: row.color ?? 'hsl(var(--muted-foreground))' }" />
                <span class="truncate font-medium">{{ row.categoryName }}</span>
              </div>
              <span class="w-8 text-right text-xs text-muted-foreground tabular-nums">{{ row.count }}</span>
              <span class="tabular-nums">${{ formatAmount(row.amount) }}</span>
              <span class="w-10 text-right text-xs text-muted-foreground">{{ row.percentLabel }}</span>
            </div>
          </div>
        </Card>
      </template>
    </main>
  </div>
</template>
