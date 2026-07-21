<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Minus,
  RotateCcw,
} from '@lucide/vue'
import { addMonths, currentMonthLabel, formatDateOnly, startOfMonth } from '@/lib/date'
import { formatAmount } from '@/lib/currency'
import { withAlpha } from '@/lib/colors'
import { useFixedExpensesStore, type FixedExpenseHistoryRow } from '@/stores/fixedExpenses'
import { useCategoriesStore } from '@/stores/categories'
import AppHeader from '@/components/AppHeader.vue'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardDescription, CardHeader } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

// Sección 13 de fixed-expenses-ux.md: Comparación mensual — 3 columnas
// consecutivas (prev/pivot/next) derivadas de un ÚNICO pivote (13.1), cada una
// listando las instancias de `fixed_expense_instances` de ESE período (NUNCA
// plantillas filtradas, 13.4), con total al pie y dos indicadores de variación
// (13.6.1). Todo el estado de esta pantalla es local (13.10): el store solo
// aporta la query acotada `fetchInstancesForPeriod`.

const router = useRouter()
const fixedExpensesStore = useFixedExpensesStore()
const categoriesStore = useCategoriesStore()

// Color de categoría por fila (13.11): realce puramente decorativo. Se resuelve
// contra el store de categorías ya cargado; si todavía no resolvió (o falla),
// cae al fallback gris — sin estado de carga propio (13.11.1).
function categoryColorFor(categoryId: string | null): string | null {
  if (!categoryId) return null
  return categoriesStore.categoryById(categoryId)?.color ?? null
}

type ColumnState = 'loading' | 'empty' | 'error' | 'data'

interface ColumnData {
  state: ColumnState
  rows: FixedExpenseHistoryRow[]
  total: number | null
}

interface MonthColumn {
  periodKey: string
  period: Date
  monthLabel: string
  /** Columna central del pivote (foco visual, 13.1) — NO implica "mes actual". */
  isPivot: boolean
  /** `period` coincide con el mes calendario real de hoy (badge "Actual", 13.1). */
  isRealCurrentMonth: boolean
  state: ColumnState
  rows: FixedExpenseHistoryRow[]
  total: number | null
}

// Pivote normalizado siempre al día 1 del mes (13.1). Arranca en el mes actual.
const pivot = ref<Date>(startOfMonth(new Date()))

// Datos por columna cacheados por `periodKey` (YYYY-MM-DD del día 1). Cachear
// por clave evita el "flash" a Skeleton de las 2 columnas que se solapan al
// desplazar el pivote un mes (solo la columna nueva entra en `loading`).
const columnData = ref<Record<string, ColumnData>>({})

function periodKeyOf(date: Date): string {
  return formatDateOnly(startOfMonth(date))
}

function startOfCurrentMonth(): Date {
  return startOfMonth(new Date())
}

// prev / pivot / next (13.1).
const periods = computed<Date[]>(() => [
  addMonths(pivot.value, -1),
  pivot.value,
  addMonths(pivot.value, 1),
])

const monthColumns = computed<MonthColumn[]>(() => {
  const realCurrentKey = periodKeyOf(new Date())
  const pivotKey = periodKeyOf(pivot.value)

  return periods.value.map((period) => {
    const periodKey = periodKeyOf(period)
    const data: ColumnData = columnData.value[periodKey] ?? { state: 'loading', rows: [], total: null }
    return {
      periodKey,
      period,
      monthLabel: currentMonthLabel(period),
      isPivot: periodKey === pivotKey,
      isRealCurrentMonth: periodKey === realCurrentKey,
      state: data.state,
      rows: data.rows,
      total: data.total,
    }
  })
})

// Sección 13.2: la flecha `>` se deshabilita en cuanto el pivote llega al mes
// calendario real — el pivote nunca puede ser un mes estrictamente futuro.
const isNextDisabled = computed(() => pivot.value.getTime() >= startOfCurrentMonth().getTime())

// Sección 13.1: rango textual siempre visible, ej. "junio – agosto 2026". Se
// colapsa el año del primer extremo cuando ambos comparten año.
const pivotRangeLabel = computed(() => {
  const first = currentMonthLabel(periods.value[0])
  const last = currentMonthLabel(periods.value[2])
  const [firstMonth, firstYear] = first.split(' ')
  const lastYear = last.split(' ')[1]
  return firstYear === lastYear ? `${firstMonth} – ${last}` : `${first} – ${last}`
})

async function loadColumn(period: Date): Promise<void> {
  const periodKey = periodKeyOf(period)
  // Solo mostramos Skeleton si no hay nada cacheado para esa clave (evita el
  // flash de las columnas que se solapan al navegar).
  if (!columnData.value[periodKey]) {
    columnData.value = { ...columnData.value, [periodKey]: { state: 'loading', rows: [], total: null } }
  }

  const result = await fixedExpensesStore.fetchInstancesForPeriod(period)

  let next: ColumnData
  if (result === null) {
    next = { state: 'error', rows: [], total: null }
  } else if (result.length === 0) {
    next = { state: 'empty', rows: [], total: null }
  } else {
    // Sección 14: una instancia omitida se sigue LISTANDO (para que el
    // historial de ese mes quede completo), pero su monto no cuenta para el
    // total de la columna — mismo criterio ya aplicado al hero "Total del
    // mes" y a la dona "Por categoría" del dashboard.
    const total = result.reduce((sum, row) => (row.isSkipped ? sum : sum + row.amount), 0)
    next = { state: 'data', rows: result, total }
  }
  columnData.value = { ...columnData.value, [periodKey]: next }
}

function loadVisibleColumns(): void {
  void Promise.all(periods.value.map(loadColumn))
}

function retryColumn(period: Date): void {
  const periodKey = periodKeyOf(period)
  columnData.value = { ...columnData.value, [periodKey]: { state: 'loading', rows: [], total: null } }
  void loadColumn(period)
}

function shiftPivot(delta: number): void {
  const next = addMonths(pivot.value, delta)
  // Guard redundante con `isNextDisabled` (13.2), defensivo ante cualquier
  // llamada programática.
  if (delta > 0 && next.getTime() > startOfCurrentMonth().getTime()) return
  pivot.value = next
}

// Recarga las 3 columnas cada vez que cambia el pivote (y al montar).
watch(pivot, loadVisibleColumns, { immediate: true })

// Carga no bloqueante de categorías para el color del dot por fila (13.11.1):
// independiente del estado de las 3 columnas, sin Skeleton/error propio.
onMounted(() => {
  if (categoriesStore.categories.length === 0) {
    void categoriesStore.fetchCategories()
  }
})

// --- Indicadores de variación (13.6.1) ---
interface Variation {
  direction: 'up' | 'down' | 'flat' | null
  percent: number | null
  amountDelta: number
}

/** Sección 13.6.1: función pura. `null` si falta cualquiera de los dos lados
 * (columna sin datos) — nunca inventa una variación con un 0 de por medio. */
function buildVariation(fromTotal: number | null, toTotal: number | null): Variation {
  if (fromTotal === null || toTotal === null) {
    return { direction: null, percent: null, amountDelta: 0 }
  }
  const amountDelta = toTotal - fromTotal
  if (amountDelta === 0) return { direction: 'flat', percent: 0, amountDelta: 0 }
  // `percent = null` cuando el mes base es 0 (división por cero): un aumento
  // desde 0 no es un porcentaje honesto, se muestra solo el monto.
  const percent = fromTotal > 0 ? Math.round((Math.abs(amountDelta) / fromTotal) * 1000) / 10 : null
  return { direction: amountDelta > 0 ? 'up' : 'down', percent, amountDelta }
}

interface VariationIndicator extends Variation {
  id: string
  label: string
}

const variationIndicators = computed<VariationIndicator[]>(() => {
  const cols = monthColumns.value
  const prevTotal = cols[0]?.total ?? null
  const centerTotal = cols[1]?.total ?? null
  const nextTotal = cols[2]?.total ?? null
  return [
    { id: 'actual-vs-prev', label: 'Mes actual vs. anterior', ...buildVariation(prevTotal, centerTotal) },
    { id: 'next-vs-actual', label: 'Mes siguiente vs. actual', ...buildVariation(centerTotal, nextTotal) },
  ]
})
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <AppHeader title="Comparación mensual" />

    <main class="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
      <!-- Control de pivote (13.1) -->
      <div class="flex items-center justify-center gap-2">
        <Button variant="outline" size="icon" aria-label="Mes anterior" @click="shiftPivot(-1)">
          <ChevronLeft class="size-5" />
        </Button>
        <p class="min-w-40 text-center text-sm font-medium capitalize tabular-nums">
          {{ pivotRangeLabel }}
        </p>
        <Button
          variant="outline"
          size="icon"
          aria-label="Mes siguiente"
          :disabled="isNextDisabled"
          @click="shiftPivot(1)"
        >
          <ChevronRight class="size-5" />
        </Button>
      </div>

      <!-- 3 columnas: scroll horizontal con snap en mobile, grid fijo desde sm: (13.6) -->
      <div
        class="grid auto-cols-[85%] grid-flow-col gap-3 overflow-x-auto snap-x snap-mandatory pb-2 sm:auto-cols-auto sm:grid-flow-row sm:grid-cols-3 sm:overflow-visible sm:pb-0"
      >
        <Card
          v-for="column in monthColumns"
          :key="column.periodKey"
          class="shrink-0 snap-center"
          :class="column.isPivot ? 'border-primary/40' : ''"
        >
          <CardHeader class="pb-2">
            <div class="flex items-center justify-between gap-2">
              <CardDescription class="truncate capitalize">
                {{ column.monthLabel }}
              </CardDescription>
              <Badge
                v-if="column.isRealCurrentMonth"
                variant="outline"
                class="shrink-0 border-transparent bg-primary/10 text-[10px] font-semibold text-primary dark:bg-primary/20"
              >
                Actual
              </Badge>
            </div>
          </CardHeader>

          <!-- Carga -->
          <div v-if="column.state === 'loading'" class="flex flex-col gap-2 px-4 pb-4">
            <Skeleton class="h-4 w-full" />
            <Skeleton class="h-4 w-4/5" />
            <Skeleton class="h-4 w-3/5" />
          </div>

          <!-- Error por columna (13.7) -->
          <div
            v-else-if="column.state === 'error'"
            class="flex flex-col items-center gap-2 px-4 py-8 text-center"
          >
            <AlertCircle class="size-6 text-destructive" />
            <p class="text-xs text-muted-foreground">
              No pudimos cargar este mes.
            </p>
            <Button variant="outline" size="sm" @click="retryColumn(column.period)">
              <RotateCcw class="size-4" />
              Reintentar
            </Button>
          </div>

          <!-- Vacío por columna (13.3.2) -->
          <div
            v-else-if="column.state === 'empty'"
            class="flex flex-col items-center gap-2 px-4 py-8 text-center"
          >
            <Inbox class="size-6 text-muted-foreground" />
            <p class="text-xs text-muted-foreground">
              Sin datos para este mes.
            </p>
          </div>

          <!-- Con datos (13.4) -->
          <template v-else>
            <div class="flex flex-col">
              <template v-for="(row, idx) in column.rows" :key="row.instanceId">
                <Separator v-if="idx > 0" />
                <div class="flex items-center gap-2 px-4 py-2">
                  <!-- Color de categoría (13.11): decorativo, aria-hidden -->
                  <span
                    aria-hidden="true"
                    class="flex size-5 shrink-0 items-center justify-center rounded-full"
                    :style="{ background: withAlpha(categoryColorFor(row.categoryId), 0.15) ?? 'var(--color-muted)' }"
                  >
                    <span
                      class="size-1.5 rounded-full"
                      :style="{ background: categoryColorFor(row.categoryId) ?? 'var(--color-muted-foreground)' }"
                    />
                  </span>
                  <p class="min-w-0 flex-1 truncate text-xs">
                    {{ row.name }}
                  </p>
                  <div class="flex shrink-0 flex-col items-end">
                    <p class="text-xs font-medium tabular-nums">
                      ${{ formatAmount(row.amount) }}
                    </p>
                    <p v-if="row.isSkipped" class="text-[10px] text-muted-foreground">
                      Omitido
                    </p>
                    <p v-else-if="row.isPending" class="text-[10px] text-muted-foreground">
                      Pendiente
                    </p>
                  </div>
                </div>
              </template>
            </div>
            <Separator />
            <!-- Total con más peso (13.11): banda bg-muted/30 + cifra text-base font-bold -->
            <div class="flex items-center justify-between bg-muted/30 px-4 py-3">
              <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Total
              </p>
              <p class="text-base font-bold tabular-nums">
                ${{ formatAmount(column.total ?? 0) }}
              </p>
            </div>
          </template>
        </Card>
      </div>

      <!-- Indicadores de variación (13.6.1) — peso visual (13.11): ícono en
           círculo de color + tipografía grande, mismo lenguaje que el hero
           "Total del mes" del dashboard. -->
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card v-for="indicator in variationIndicators" :key="indicator.id">
          <CardHeader class="pb-2">
            <CardDescription>{{ indicator.label }}</CardDescription>
          </CardHeader>
          <div class="flex items-center gap-3 px-6 pb-5">
            <span
              aria-hidden="true"
              class="flex size-10 shrink-0 items-center justify-center rounded-full"
              :class="{
                'bg-destructive/10 dark:bg-destructive/20': indicator.direction === 'up',
                'bg-success/10 dark:bg-success/20': indicator.direction === 'down',
                'bg-muted': indicator.direction === 'flat' || indicator.direction === null,
              }"
            >
              <component
                :is="indicator.direction === 'up' ? ArrowUp : indicator.direction === 'down' ? ArrowDown : Minus"
                class="size-5"
                :class="{
                  'text-destructive': indicator.direction === 'up',
                  'text-success': indicator.direction === 'down',
                  'text-muted-foreground': indicator.direction === 'flat' || indicator.direction === null,
                }"
              />
            </span>
            <div v-if="indicator.direction !== null" class="flex min-w-0 flex-col">
              <p
                class="text-xl font-bold tabular-nums sm:text-2xl"
                :class="{
                  'text-destructive': indicator.direction === 'up',
                  'text-success': indicator.direction === 'down',
                  'text-foreground': indicator.direction === 'flat',
                }"
              >
                <template v-if="indicator.percent !== null">{{ indicator.percent }}%</template>
                <template v-else>{{ indicator.direction === 'up' ? '+' : '-' }}${{ formatAmount(Math.abs(indicator.amountDelta)) }}</template>
              </p>
              <p v-if="indicator.percent !== null" class="text-xs tabular-nums text-muted-foreground">
                {{ indicator.direction === 'up' ? '+' : indicator.direction === 'down' ? '-' : '' }}${{ formatAmount(Math.abs(indicator.amountDelta)) }}
              </p>
            </div>
            <p v-else class="text-xs text-muted-foreground">
              No hay datos suficientes para comparar.
            </p>
          </div>
        </Card>
      </div>
    </main>
  </div>
</template>
