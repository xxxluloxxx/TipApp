<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AlertCircle, ArrowLeft, CreditCard as CreditCardIcon, Plus, RotateCcw, User } from '@lucide/vue'
import { currentMonthLabel, formatDateOnly, formatExpenseDateHeading } from '@/lib/date'
import { formatAmount } from '@/lib/currency'
import { readableTextColor, withAlpha } from '@/lib/colors'
import { buildDonutSlices, type CategoryTotal } from '@/lib/charts'
import { useCreditCardsStore } from '@/stores/creditCards'
import { useCardPeopleStore } from '@/stores/cardPeople'
import { useCardExpensesStore, type CardExpenseWithRelations } from '@/stores/cardExpenses'
import CategoryDonutChart from '@/components/charts/CategoryDonutChart.vue'
import CardFormSheet from '@/components/CardFormSheet.vue'
import CardExpenseFormSheet from '@/components/CardExpenseFormSheet.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// Sección 4 de credit-cards-ux.md: detalle de una tarjeta. Vista de "tercer
// nivel" (vuelve a /tarjetas, no a Home), fetch propio (deep-link directo).

const route = useRoute()
const router = useRouter()
const creditCardsStore = useCreditCardsStore()
const cardPeopleStore = useCardPeopleStore()
const cardExpensesStore = useCardExpensesStore()

const cardId = computed(() => String(route.params.id))
const card = computed(() => creditCardsStore.cardById(cardId.value))

const isInitialLoading = ref(true)
const isLoadingMonth = ref(false)
const loadError = ref(false)

const monthExpenses = ref<CardExpenseWithRelations[]>([])

// "Movimientos recientes" (sección 4.3) se derivan del mismo mes seleccionado
// (ya viene ordenado desc por fecha desde `fetchByDateRange`/las mutaciones
// optimistas, ver `sortDesc` en cardExpenses.ts), no de un fetch aparte
// "últimos 5 sin importar el mes" — con el selector de mes visible en el
// header, mostrar un movimiento de otro mes ahí se leía como un bug.
const recentExpenses = computed(() => monthExpenses.value.slice(0, 5))

interface MonthOption { value: string, label: string, start: Date, end: Date }

// Mismo patrón que CardsDashboardView.vue/CardTransactionsView.vue: últimos 12
// meses generados con matemática de fechas pura, sin depender de datos cargados.
const monthOptions = computed<MonthOption[]>(() => {
  const now = new Date()
  return Array.from({ length: 12 }, (_, i) => {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
    return {
      value: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
      label: currentMonthLabel(start),
      start,
      end,
    }
  })
})

const filters = reactive({
  month: monthOptions.value[0]!.value,
})

const selectedMonth = computed(() => monthOptions.value.find(o => o.value === filters.month) ?? monthOptions.value[0]!)

// A diferencia del dashboard, acá no hay badge de variación: solo se trae el
// rango del mes seleccionado para esta tarjeta, sin mes anterior ni delta.
// `recentExpenses` (computed) se deriva de este mismo array, así que no hace
// falta ninguna otra query para tenerlo actualizado.
async function loadMonthData(): Promise<boolean> {
  const cur = selectedMonth.value
  const monthRes = await cardExpensesStore.fetchByDateRange({
    from: formatDateOnly(cur.start),
    to: formatDateOnly(cur.end),
    cardId: cardId.value,
  })
  if (monthRes === null) return false
  monthExpenses.value = monthRes
  return true
}

async function loadAll() {
  loadError.value = false
  isInitialLoading.value = true
  try {
    const [cardsOk, peopleOk, monthOk] = await Promise.all([
      creditCardsStore.fetchCards(),
      cardPeopleStore.fetchPeople(),
      loadMonthData(),
    ])

    if (!cardsOk || !peopleOk || !monthOk || !card.value) {
      loadError.value = true
      return
    }
  } finally {
    isInitialLoading.value = false
  }
}

// Al cambiar el mes seleccionado, refetchear solo `monthExpenses` (las
// tarjetas/personas ya están cargadas; `recentExpenses` se recalcula solo,
// es un computed derivado de `monthExpenses`).
async function reloadMonth() {
  loadError.value = false
  isLoadingMonth.value = true
  try {
    if (!(await loadMonthData())) loadError.value = true
  } finally {
    isLoadingMonth.value = false
  }
}

watch(() => filters.month, () => {
  if (!isInitialLoading.value) void reloadMonth()
})

onMounted(loadAll)

const monthLabel = computed(() => selectedMonth.value.label)
const cardMonthTotal = computed(() => monthExpenses.value.reduce((sum, e) => sum + e.amount, 0))

// Sección 4.1: barra de progreso contra el límite sugerido, siempre
// acompañada de texto (nunca solo color) y del copy de "es informativo".
const limitProgress = computed(() => {
  const limit = card.value?.suggested_monthly_limit
  if (!limit) return 0
  return (cardMonthTotal.value / limit) * 100
})
// Sección 4.1.3: derivado 100% de `limitProgress`, sin dato ni query nueva.
const limitAvailableLabel = computed(() => {
  if (limitProgress.value <= 100) return `${Math.round(100 - limitProgress.value)}% disponible`
  return `Superado por ${Math.round(limitProgress.value - 100)}%`
})
const limitBarColorClass = computed(() => {
  if (limitProgress.value > 100) return 'bg-destructive'
  if (limitProgress.value >= 80) return 'bg-warning'
  return 'bg-primary'
})

// Sección 4.2: dona de gasto por persona dentro de esta tarjeta.
const personDonutSlices = computed(() => {
  const totals = new Map<string, CategoryTotal>()
  for (const e of monthExpenses.value) {
    const key = e.person_id ?? 'none'
    const existing = totals.get(key)
    if (existing) {
      existing.amount += e.amount
    } else {
      const name = e.person_id ? (e.person?.name ?? 'Persona') : 'Sin persona asignada'
      const color = e.person_id ? (e.person?.color ?? null) : null
      totals.set(key, { id: key, name, color, amount: e.amount })
    }
  }
  return buildDonutSlices([...totals.values()], 5)
})

// Sección 4.4: derivado sin queries adicionales del mismo array del hero.
const averageExpense = computed(() => (monthExpenses.value.length === 0 ? 0 : cardMonthTotal.value / monthExpenses.value.length))
const maxExpense = computed(() => Math.max(0, ...monthExpenses.value.map(e => e.amount)))

function expenseTitle(expense: CardExpenseWithRelations): string {
  return expense.description || card.value?.name || ''
}

// Sheets de edición de tarjeta / alta de gasto (sección 4.5).
const isCardSheetOpen = ref(false)
const isExpenseSheetOpen = ref(false)
const editingExpense = ref<CardExpenseWithRelations | null>(null)

function openEditCard() {
  isCardSheetOpen.value = true
}
function openNewExpense() {
  editingExpense.value = null
  isExpenseSheetOpen.value = true
}

// Definido acá, no inline en el template: un `ref` referenciado por su
// nombre dentro de una expresión de template se auto-desenvuelve, así que
// `[monthExpenses]` en el template pasaría el *valor* desenvuelto, no el
// `ref` en sí (ver mismo comentario en CardTransactionsView.vue). Un solo
// target ahora: `recentExpenses` es un computed derivado de `monthExpenses`,
// se actualiza solo.
const expenseSyncTargets = [monthExpenses]

function goToTransactions() {
  router.push({ name: 'card-transactions', query: { cardId: cardId.value } })
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <!-- Header con selector de mes integrado (mismo patrón que
    CardsDashboardView.vue): el nombre de la tarjeta baja a eyebrow chico y el
    mes elegido pasa a ser el texto grande, sin caja/borde de campo. El bloque
    central queda centrado entre el botón Volver y un spacer del mismo tamaño. -->
    <header class="flex items-center gap-2 border-b border-border px-4 py-1.5 sm:gap-3 sm:px-6 lg:px-8">
      <Button variant="ghost" size="icon" aria-label="Volver" @click="router.push({ name: 'cards' })">
        <ArrowLeft class="size-5" />
      </Button>

      <div class="min-w-0 flex-1">
        <p id="card-detail-eyebrow" class="truncate text-center text-xs font-medium text-muted-foreground">
          {{ card?.name }}
        </p>

        <Select v-model="filters.month">
          <SelectTrigger
            aria-describedby="card-detail-eyebrow"
            class="!h-11 !w-fit !max-w-full !gap-1.5 !border-0 !bg-transparent !px-2 !py-0 !shadow-none mx-auto rounded-md text-xl font-semibold tracking-tight text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
          >
            <SelectValue class="truncate" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="option in monthOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="size-11" aria-hidden="true" />
    </header>

    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <!-- Estado de carga -->
      <template v-if="isInitialLoading">
        <Card>
          <CardHeader>
            <Skeleton class="h-4 w-32" />
            <Skeleton class="mt-2 h-9 w-40" />
          </CardHeader>
          <Skeleton class="mx-6 mb-4 h-8" />
        </Card>
        <Card>
          <CardHeader>
            <Skeleton class="h-4 w-40" />
          </CardHeader>
          <div class="flex flex-col items-center gap-4 px-6 pb-6 sm:flex-row">
            <Skeleton class="size-32 shrink-0 rounded-full" />
          </div>
        </Card>
      </template>

      <!-- Estado de error -->
      <template v-else-if="loadError">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <AlertCircle class="size-12 text-destructive" />
          <h2 class="text-lg font-semibold">
            No pudimos cargar esta tarjeta
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

      <!-- Recargando por cambio de mes: mismo esqueleto que la carga inicial -->
      <template v-else-if="isLoadingMonth">
        <Card>
          <CardHeader>
            <Skeleton class="h-4 w-32" />
            <Skeleton class="mt-2 h-9 w-40" />
          </CardHeader>
          <Skeleton class="mx-6 mb-4 h-8" />
        </Card>
        <Card>
          <CardHeader>
            <Skeleton class="h-4 w-40" />
          </CardHeader>
          <div class="flex flex-col items-center gap-4 px-6 pb-6 sm:flex-row">
            <Skeleton class="size-32 shrink-0 rounded-full" />
          </div>
        </Card>
      </template>

      <template v-else-if="card">
        <!-- Sección 4.1: hero + progreso contra límite sugerido -->
        <Card size="sm" :style="{ backgroundColor: withAlpha(card.color, 0.16) }">
          <CardHeader class="gap-2">
            <div class="flex items-center gap-3">
              <span
                class="flex size-8 shrink-0 items-center justify-center rounded-lg"
                :style="{ backgroundColor: card.color ?? 'hsl(var(--muted))' }"
              >
                <CreditCardIcon class="size-4" :style="{ color: readableTextColor(card.color) }" />
              </span>
              <div class="flex min-w-0 flex-col">
                <p class="truncate text-sm font-semibold">
                  {{ card.name }}
                </p>
                <p class="truncate text-xs text-muted-foreground">
                  •••• {{ card.last_four_digits }}
                </p>
              </div>
            </div>

            <div>
              <CardDescription>Total en {{ monthLabel }}</CardDescription>
              <CardTitle class="text-xl font-bold tabular-nums tracking-tight sm:text-2xl">
                <span class="align-top text-sm font-normal text-muted-foreground">$</span>{{ formatAmount(cardMonthTotal) }}
              </CardTitle>
            </div>
          </CardHeader>

          <div v-if="card.suggested_monthly_limit" class="flex flex-col gap-1 px-4 pb-4">
            <div class="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                class="h-full rounded-full transition-[width]"
                :class="limitBarColorClass"
                :style="{ width: `${Math.min(limitProgress, 100)}%` }"
              />
            </div>
            <div class="flex items-center justify-between text-xs text-muted-foreground">
              <span>Límite mensual (sugerido): ${{ formatAmount(cardMonthTotal) }} / ${{ formatAmount(card.suggested_monthly_limit) }}</span>
              <span>{{ limitAvailableLabel }}</span>
            </div>
            <p class="text-xs text-muted-foreground">
              Este límite es solo una referencia que vos definiste, no un límite real de tu tarjeta ni de tu banco.
            </p>
          </div>
          <p v-else class="px-4 pb-4 text-xs text-muted-foreground">
            No definiste un límite mensual sugerido para esta tarjeta.
            <button type="button" class="font-medium text-primary underline-offset-2 hover:underline" @click="openEditCard">
              Definir uno
            </button>
          </p>
        </Card>

        <!-- Sección 4.2: dona por persona -->
        <Card v-if="personDonutSlices.length">
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Gastos por persona
            </CardTitle>
          </CardHeader>
          <div class="flex flex-col items-center gap-4 px-6 pb-6 sm:flex-row">
            <CategoryDonutChart :slices="personDonutSlices" class="size-32 shrink-0" />
            <ul class="flex w-full flex-col gap-2">
              <li v-for="slice in personDonutSlices" :key="slice.id" class="flex items-center gap-2 text-sm">
                <span class="size-2.5 shrink-0 rounded-full" :style="{ background: slice.color ?? 'hsl(var(--muted-foreground))' }" />
                <span class="flex-1 truncate font-medium">{{ slice.name }}</span>
                <span class="tabular-nums">${{ formatAmount(slice.amount) }}</span>
                <span class="w-10 text-right text-xs text-muted-foreground">{{ slice.percentLabel }}</span>
              </li>
            </ul>
          </div>
        </Card>

        <!-- Sección 4.3: movimientos recientes -->
        <Card>
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Movimientos recientes
            </CardTitle>
            <CardAction>
              <Button variant="link" size="sm" class="h-auto p-0" @click="goToTransactions">
                Ver todos
              </Button>
            </CardAction>
          </CardHeader>

          <p v-if="recentExpenses.length === 0" class="px-6 pb-4 text-sm text-muted-foreground">
            No registraste gastos con esta tarjeta en {{ monthLabel }}.
          </p>
          <div v-else class="flex flex-col">
            <template v-for="(expense, idx) in recentExpenses" :key="expense.id">
              <Separator v-if="idx > 0" />
              <div class="flex items-start gap-3 px-4 py-3" :class="{ 'opacity-70': expense._pending }">
                <span
                  v-if="expense.person?.color"
                  class="flex size-9 shrink-0 items-center justify-center rounded-full"
                  :style="{ background: expense.person.color }"
                >
                  <User class="size-4" :style="{ color: readableTextColor(expense.person.color) }" />
                </span>
                <span v-else class="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                  <User class="size-4 text-muted-foreground" />
                </span>

                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div class="flex items-start justify-between gap-2">
                    <p class="truncate text-sm font-medium">
                      {{ expenseTitle(expense) }}
                    </p>
                    <p class="shrink-0 text-sm font-semibold tabular-nums">
                      ${{ formatAmount(expense.amount) }}
                    </p>
                  </div>
                  <div class="flex items-center justify-between gap-2">
                    <span class="truncate text-xs text-muted-foreground">
                      {{ expense.person?.name ?? 'Sin persona asignada' }} · {{ formatExpenseDateHeading(expense.expense_date) }}
                    </span>
                    <Badge
                      v-if="expense.installment_total"
                      variant="secondary"
                      class="shrink-0 px-1.5 py-0 text-[10px] tabular-nums"
                    >
                      {{ expense.installment_number }}/{{ expense.installment_total }}
                    </Badge>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </Card>

        <!-- Sección 4.4: resumen -->
        <Card :style="{ backgroundColor: withAlpha(card.color, 0.08) }">
          <CardHeader>
            <CardTitle class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Resumen del mes
            </CardTitle>
          </CardHeader>
          <div class="grid grid-cols-3 gap-2 px-6 pb-6 text-center">
            <div>
              <p class="text-lg font-semibold tabular-nums">
                {{ monthExpenses.length }}
              </p>
              <p class="text-xs text-muted-foreground">
                Transacciones
              </p>
            </div>
            <div>
              <p class="text-lg font-semibold tabular-nums">
                ${{ formatAmount(averageExpense) }}
              </p>
              <p class="text-xs text-muted-foreground">
                Promedio
              </p>
            </div>
            <div>
              <p class="text-lg font-semibold tabular-nums">
                ${{ formatAmount(maxExpense) }}
              </p>
              <p class="text-xs text-muted-foreground">
                Mayor gasto
              </p>
            </div>
          </div>
        </Card>
      </template>
    </main>

    <!-- Sección 4.5: acciones -->
    <div v-if="!isInitialLoading && !loadError && card" class="flex gap-3 px-4 pb-6 sm:px-6 lg:px-8">
      <Button variant="outline" class="flex-1" @click="openEditCard">
        Editar tarjeta
      </Button>
      <Button class="flex-1" @click="openNewExpense">
        <Plus class="size-4" />
        Nuevo gasto
      </Button>
    </div>

    <CardFormSheet v-model:open="isCardSheetOpen" :card="card" />
    <CardExpenseFormSheet
      v-model:open="isExpenseSheetOpen"
      :expense="editingExpense"
      :preset-card-id="cardId"
      :sync-targets="expenseSyncTargets"
    />
  </div>
</template>
