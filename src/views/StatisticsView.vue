<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AlertCircle, RotateCcw } from '@lucide/vue'
import { useCategoriesStore } from '@/stores/categories'
import { useExpensesStore } from '@/stores/expenses'
import { currentMonthLabel, parseDateOnly } from '@/lib/date'
import { formatAmount } from '@/lib/currency'
import { buildDailySeries, buildDonutSlices, isMonthSafeToShow, type CategoryTotal } from '@/lib/charts'
import TrendAreaChart from '@/components/charts/TrendAreaChart.vue'
import CategoryDonutChart from '@/components/charts/CategoryDonutChart.vue'
import AppHeader from '@/components/AppHeader.vue'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

// Sección 4 de dashboard-redesign-ux.md: más detalle sobre lo mismo que ya
// vive en Inicio (dona completa + "Ver detalle" de Otros, tendencia diaria
// no acumulada, "Por mes"). Vista de segundo nivel, fetch propio.

const categoriesStore = useCategoriesStore()
const expensesStore = useExpensesStore()

const isInitialLoading = ref(true)
const loadError = ref(false)

async function loadAll() {
  loadError.value = false
  isInitialLoading.value = true
  try {
    await Promise.all([categoriesStore.fetchCategories(), expensesStore.fetchAll()])
    if (expensesStore.error) loadError.value = true
  } finally {
    isInitialLoading.value = false
  }
}

onMounted(loadAll)

const monthLabel = computed(() => currentMonthLabel())

function monthStart(offsetMonths: number, reference: Date = new Date()): Date {
  return new Date(reference.getFullYear(), reference.getMonth() + offsetMonths, 1)
}

function totalForMonth(target: Date): number {
  return expensesStore.expenses.reduce((sum, expense) => {
    const date = parseDateOnly(expense.expense_date)
    const matches = date.getFullYear() === target.getFullYear() && date.getMonth() === target.getMonth()
    return matches ? sum + expense.amount : sum
  }, 0)
}

const oldestLoadedDate = computed(() => {
  const oldest = expensesStore.expenses.at(-1)
  return oldest ? parseDateOnly(oldest.expense_date) : null
})

const currentMonthExpenses = computed(() => {
  const now = new Date()
  return expensesStore.expenses.filter((expense) => {
    const date = parseDateOnly(expense.expense_date)
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
  })
})

// Sección 4.1: dona completa. A diferencia de Inicio (que sí pliega en
// "Otros" para el resumen rápido del dashboard), acá se listan TODAS las
// categorías con gasto > 0 sin plegar, porque esta es la vista de detalle
// dedicada a categorías.
const donutSlices = computed(() => {
  const totals = new Map<string, CategoryTotal>()
  for (const expense of currentMonthExpenses.value) {
    const category = expense.category
    const existing = totals.get(category.id)
    if (existing) {
      existing.amount += expense.amount
    } else {
      totals.set(category.id, { id: category.id, name: category.name, color: category.color, amount: expense.amount })
    }
  }
  return buildDonutSlices([...totals.values()], Infinity)
})

// Sección 4.2: tendencia diaria, discreta (no acumulada), más grande y con
// eje.
const dailyPoints = computed(() => buildDailySeries(currentMonthExpenses.value))

function monthBarLabel(date: Date): string {
  const [month, year] = currentMonthLabel(date).split(' ')
  return `${month!.slice(0, 3)} ${year}`
}

// Sección 4.3: meses hacia atrás que cumplan `isMonthSafeToShow`, cortando
// apenas el primero falla — nunca se muestra un mes parcial como si fuera
// completo.
const safeMonths = computed(() => {
  const oldest = oldestLoadedDate.value
  if (!oldest) return []

  const months: { key: string, label: string, total: number }[] = []
  let cursor = monthStart(0)
  while (isMonthSafeToShow(cursor, oldest)) {
    months.push({
      key: `${cursor.getFullYear()}-${cursor.getMonth()}`,
      label: monthBarLabel(cursor),
      total: totalForMonth(cursor),
    })
    cursor = monthStart(-1, cursor)
  }
  return months
})

const maxMonthTotal = computed(() => Math.max(0, ...safeMonths.value.map(m => m.total)))

function percentOfMax(total: number): number {
  return maxMonthTotal.value === 0 ? 0 : (total / maxMonthTotal.value) * 100
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <AppHeader title="Estadísticas" />

    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <!-- Estado de carga -->
      <template v-if="isInitialLoading">
        <Card>
          <CardHeader>
            <Skeleton class="h-4 w-40" />
          </CardHeader>
          <div class="flex flex-col items-center gap-4 px-6 pb-6 sm:flex-row">
            <Skeleton class="size-32 shrink-0 rounded-full" />
            <div class="flex w-full flex-col gap-2">
              <Skeleton v-for="i in 4" :key="i" class="h-4 w-full" />
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton class="h-4 w-32" />
          </CardHeader>
          <Skeleton class="mx-6 mb-4 h-40" />
        </Card>
      </template>

      <!-- Estado de error -->
      <template v-else-if="loadError">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <AlertCircle class="size-12 text-destructive" />
          <h2 class="text-lg font-semibold">
            No pudimos cargar tus estadísticas
          </h2>
          <p class="text-sm text-muted-foreground">
            Revisá tu conexión e intentá de nuevo.
          </p>
          <Button variant="outline" @click="loadAll">
            <RotateCcw class="size-4" />
            Reintentar
          </Button>
        </div>
      </template>

      <template v-else>
        <!-- Sección 4.1: Por categoría -->
        <Card v-if="donutSlices.length">
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Por categoría · {{ monthLabel }}
            </CardTitle>
          </CardHeader>

          <div class="flex flex-col items-center gap-4 px-6 pb-6 sm:flex-row sm:items-start">
            <CategoryDonutChart :slices="donutSlices" class="size-32 shrink-0" />

            <ul class="flex w-full flex-col gap-2">
              <li v-for="slice in donutSlices" :key="slice.id" class="flex flex-col gap-1 text-sm">
                <template v-if="slice.folded">
                  <div class="flex items-center gap-2">
                    <span class="size-2.5 shrink-0 rounded-full bg-muted-foreground" />
                    <span class="flex-1 font-medium">{{ slice.name }}</span>
                    <span class="tabular-nums">${{ formatAmount(slice.amount) }}</span>
                    <span class="w-10 text-right text-xs text-muted-foreground">{{ slice.percentLabel }}</span>
                  </div>
                  <details class="pl-4.5 text-xs text-muted-foreground">
                    <summary class="cursor-pointer select-none">Ver detalle</summary>
                    <ul class="mt-1 flex flex-col gap-0.5">
                      <li v-for="c in slice.folded" :key="c.id" class="flex justify-between gap-2">
                        <span class="truncate">{{ c.name }}</span>
                        <span class="tabular-nums">${{ formatAmount(c.amount) }}</span>
                      </li>
                    </ul>
                  </details>
                </template>
                <div v-else class="flex items-center gap-2">
                  <span class="size-2.5 shrink-0 rounded-full" :style="{ background: slice.color ?? 'hsl(var(--muted-foreground))' }" />
                  <span class="flex-1 truncate font-medium">{{ slice.name }}</span>
                  <span class="tabular-nums">${{ formatAmount(slice.amount) }}</span>
                  <span class="w-10 text-right text-xs text-muted-foreground">{{ slice.percentLabel }}</span>
                </div>
              </li>
            </ul>
          </div>
        </Card>

        <!-- Sección 4.2: Tendencia diaria -->
        <Card v-if="dailyPoints.length">
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Tendencia diaria · {{ monthLabel }}
            </CardTitle>
          </CardHeader>
          <TrendAreaChart
            :points="dailyPoints"
            class="px-6 pb-4"
            :height="160"
            show-axis
            :ariaLabel="`Gasto diario de ${monthLabel}, día a día`"
          />
        </Card>

        <!-- Sección 4.3: Por mes -->
        <Card>
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Por mes
            </CardTitle>
          </CardHeader>

          <div class="px-6 pb-6">
            <div v-if="safeMonths.length >= 2" class="flex flex-col gap-3">
              <div v-for="m in safeMonths" :key="m.key" class="flex items-center gap-3">
                <span class="w-20 shrink-0 text-xs text-muted-foreground">{{ m.label }}</span>
                <div class="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div class="h-full rounded-full bg-primary" :style="{ width: `${percentOfMax(m.total)}%` }" />
                </div>
                <span class="w-16 shrink-0 text-right text-xs font-medium tabular-nums">${{ formatAmount(m.total) }}</span>
              </div>
            </div>
            <p v-else class="text-sm text-muted-foreground">
              Todavía no hay suficiente historial para mostrar la tendencia mensual.
            </p>
          </div>
        </Card>
      </template>
    </main>
  </div>
</template>
