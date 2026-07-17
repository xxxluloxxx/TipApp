<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { AlertCircle, ArrowDown, ArrowLeft, ArrowUp, ChevronRight, CreditCard as CreditCardIcon, Plus, RotateCcw, Settings, User } from '@lucide/vue'
import { currentMonthLabel, formatDateOnly } from '@/lib/date'
import { formatAmount } from '@/lib/currency'
import { readableTextColor, withAlpha } from '@/lib/colors'
import { buildDonutSlices, type CategoryTotal } from '@/lib/charts'
import { useCreditCardsStore } from '@/stores/creditCards'
import { useCardPeopleStore } from '@/stores/cardPeople'
import { useCardExpensesStore, type CardExpenseWithRelations } from '@/stores/cardExpenses'
import CategoryDonutChart from '@/components/charts/CategoryDonutChart.vue'
import CardExpenseFormSheet from '@/components/CardExpenseFormSheet.vue'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardDescription, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// Resumen/Dashboard de tarjetas (credit-cards-ux.md sección 2). Vista de
// segundo nivel (header ArrowLeft-less... en realidad sí tiene ArrowLeft,
// vuelve a Home, mismo patrón que CategoriesView/TransactionsView).

const router = useRouter()
const creditCardsStore = useCreditCardsStore()
const cardPeopleStore = useCardPeopleStore()
const cardExpensesStore = useCardExpensesStore()

const isInitialLoading = ref(true)
const isLoadingMonth = ref(false)
const loadError = ref(false)

const monthExpenses = ref<CardExpenseWithRelations[]>([])
const prevMonthExpenses = ref<CardExpenseWithRelations[]>([])

interface MonthOption { value: string, label: string, start: Date, end: Date }

// Mismo patrón que CardTransactionsView.vue: últimos 12 meses generados con
// matemática de fechas pura, sin depender de ningún dato ya cargado.
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

// Refetch de los dos rangos ("mes seleccionado" y "mes anterior al
// seleccionado") derivados del Select, no siempre relativos a hoy.
async function loadMonthData(): Promise<boolean> {
  const cur = selectedMonth.value
  const prevStart = new Date(cur.start.getFullYear(), cur.start.getMonth() - 1, 1)
  const prevEnd = cur.start

  const [curRes, prevRes] = await Promise.all([
    cardExpensesStore.fetchByDateRange({ from: formatDateOnly(cur.start), to: formatDateOnly(cur.end) }),
    cardExpensesStore.fetchByDateRange({ from: formatDateOnly(prevStart), to: formatDateOnly(prevEnd) }),
  ])

  if (curRes === null || prevRes === null) return false

  monthExpenses.value = curRes
  prevMonthExpenses.value = prevRes
  return true
}

async function loadAll() {
  loadError.value = false
  isInitialLoading.value = true
  try {
    const [cardsOk, peopleOk, monthsOk] = await Promise.all([
      creditCardsStore.fetchCards(),
      cardPeopleStore.fetchPeople(),
      loadMonthData(),
    ])

    if (!cardsOk || !peopleOk || !monthsOk) {
      loadError.value = true
    }
  } finally {
    isInitialLoading.value = false
  }
}

// Al cambiar el mes seleccionado, refetchear solo los rangos (las tarjetas y
// personas ya están cargadas), mismo watch que usa CardTransactionsView.vue.
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

const monthTotal = computed(() => monthExpenses.value.reduce((sum, e) => sum + e.amount, 0))
const prevMonthTotal = computed(() => prevMonthExpenses.value.reduce((sum, e) => sum + e.amount, 0))

// Sección 2.1: `null` únicamente si el mes anterior no tuvo gasto (división
// por cero) — siempre es seguro de calcular (sección 1.2), a diferencia del
// dashboard de gastos personales.
const monthDelta = computed(() => {
  if (prevMonthTotal.value === 0) return null
  const diffPercent = ((monthTotal.value - prevMonthTotal.value) / prevMonthTotal.value) * 100
  const direction: 'up' | 'down' = diffPercent >= 0 ? 'up' : 'down'
  return { direction, percentLabel: `${Math.abs(Math.round(diffPercent))}%` }
})

// Sección 2.3: todas las tarjetas del usuario, con total/porcentaje del mes
// vigente (0 si no tuvieron movimiento), ordenadas desc.
const cardsRanking = computed(() => {
  const totals = new Map<string, number>()
  for (const e of monthExpenses.value) {
    totals.set(e.card_id, (totals.get(e.card_id) ?? 0) + e.amount)
  }
  return creditCardsStore.cards
    .map((card) => {
      const total = totals.get(card.id) ?? 0
      return {
        id: card.id,
        name: card.name,
        color: card.color,
        lastFourDigits: card.last_four_digits,
        monthTotal: total,
        percentLabel: monthTotal.value === 0 ? '0%' : `${Math.round((total / monthTotal.value) * 100)}%`,
      }
    })
    .sort((a, b) => b.monthTotal - a.monthTotal)
})

// Sección 2.2: dona por tarjeta (no por mes, ver justificación del doc).
const cardDonutSlices = computed(() => {
  const totals: CategoryTotal[] = cardsRanking.value.map(c => ({ id: c.id, name: c.name, color: c.color, amount: c.monthTotal }))
  return buildDonutSlices(totals, 5)
})

// Sección 2.4: ranking "Top personas", incluyendo "Sin persona asignada"
// como fila sintética (sin color propio, usa muted-foreground). Cada persona
// real lleva su propio `color` (mismo dato que ManageCardsView ya usa para el
// avatar), reusado acá tanto para el ícono como para la barra de progreso.
const peopleRanking = computed(() => {
  const totals = new Map<string, number>()
  for (const e of monthExpenses.value) {
    const key = e.person_id ?? 'none'
    totals.set(key, (totals.get(key) ?? 0) + e.amount)
  }

  const rows = [...totals.entries()].map(([key, amount]) => {
    if (key === 'none') {
      return { id: 'none', name: 'Sin persona asignada', amount, color: null as string | null }
    }
    const person = cardPeopleStore.personById(key)
    return { id: key, name: person?.name ?? 'Persona', amount, color: person?.color ?? null }
  }).sort((a, b) => b.amount - a.amount)

  const max = Math.max(0, ...rows.map(r => r.amount))

  return rows.map(r => ({
    ...r,
    percentOfMax: max === 0 ? 0 : (r.amount / max) * 100,
    percentLabel: monthTotal.value === 0 ? '0%' : `${Math.round((r.amount / monthTotal.value) * 100)}%`,
  }))
})

const hasCards = computed(() => !isInitialLoading.value && !loadError.value && creditCardsStore.cards.length > 0)
const showDistribution = computed(() => monthTotal.value > 0)

// FAB propio del dashboard (opcional según el doc, sección 5): se agrega acá
// también, no solo en Transacciones/Detalle, para no forzar una navegación
// extra desde la pantalla que el usuario probablemente abre más seguido.
const isExpenseSheetOpen = ref(false)
function openAddExpense() {
  isExpenseSheetOpen.value = true
}

// Definido acá, no inline en el template (ver mismo comentario en
// CardTransactionsView.vue/CardDetailView.vue): sincroniza `monthExpenses`
// para que agregar un gasto desde este FAB actualice de inmediato el total,
// la dona y los rankings de esta misma pantalla.
const dashboardSyncTargets = [monthExpenses]
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <header class="flex items-center gap-3 border-b border-border px-4 py-4 sm:px-6 lg:px-8">
      <Button variant="ghost" size="icon" aria-label="Volver" @click="router.push({ name: 'home' })">
        <ArrowLeft class="size-5" />
      </Button>
      <h1 class="flex-1 text-xl font-semibold">
        Tarjetas de crédito
      </h1>
      <Button variant="ghost" size="icon" aria-label="Gestionar tarjetas y personas" @click="router.push({ name: 'manage-cards' })">
        <Settings class="size-5" />
      </Button>
    </header>

    <!-- Filtro por mes (mismo patrón que la fila de filtros de
    CardTransactionsView.vue): el total, el badge "vs. mes anterior", la dona y
    la lista "Tus tarjetas" reflejan el mes elegido, no siempre el actual. -->
    <div v-if="hasCards" class="flex gap-2 overflow-x-auto px-4 py-3 sm:px-6 lg:px-8">
      <Select v-model="filters.month">
        <SelectTrigger class="h-11 w-auto min-w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="option in monthOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 pb-28 sm:px-6 lg:px-8">
      <!-- Estado de carga -->
      <template v-if="isInitialLoading">
        <Card>
          <CardHeader>
            <Skeleton class="h-4 w-40" />
            <Skeleton class="mt-2 h-9 w-40" />
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton class="h-4 w-48" />
          </CardHeader>
          <div class="flex flex-col items-center gap-4 px-6 pb-6 sm:flex-row">
            <Skeleton class="size-32 shrink-0 rounded-full" />
            <div class="flex w-full flex-col gap-2">
              <Skeleton v-for="i in 3" :key="i" class="h-4 w-full" />
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton class="h-4 w-32" />
          </CardHeader>
          <div class="flex flex-col gap-3 px-6 pb-6">
            <Skeleton v-for="i in 3" :key="i" class="h-4 w-full" />
          </div>
        </Card>
      </template>

      <!-- Estado de error -->
      <template v-else-if="loadError">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <AlertCircle class="size-12 text-destructive" />
          <h2 class="text-lg font-semibold">
            No pudimos cargar tus tarjetas
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

      <!-- Estado vacío: sin ninguna tarjeta creada -->
      <template v-else-if="creditCardsStore.cards.length === 0">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <CreditCardIcon class="size-12 text-muted-foreground" />
          <h2 class="text-lg font-semibold">
            Todavía no agregaste ninguna tarjeta
          </h2>
          <p class="max-w-xs text-center text-sm text-muted-foreground">
            Agregá tu primera tarjeta para empezar a registrar sus gastos.
          </p>
          <Button @click="router.push({ name: 'manage-cards' })">
            Agregar tarjeta
          </Button>
        </div>
      </template>

      <!-- Recargando por cambio de mes -->
      <template v-else-if="isLoadingMonth">
        <Card>
          <CardHeader>
            <Skeleton class="h-4 w-40" />
            <Skeleton class="mt-2 h-9 w-40" />
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton class="h-4 w-48" />
          </CardHeader>
          <div class="flex flex-col items-center gap-4 px-6 pb-6 sm:flex-row">
            <Skeleton class="size-32 shrink-0 rounded-full" />
            <div class="flex w-full flex-col gap-2">
              <Skeleton v-for="i in 3" :key="i" class="h-4 w-full" />
            </div>
          </div>
        </Card>
      </template>

      <template v-else>
        <!-- Sección 2.1: Total del mes -->
        <Card>
          <CardHeader>
            <div class="flex items-start justify-between gap-2">
              <div class="flex flex-col gap-1">
                <CardDescription>Total de tarjetas en {{ monthLabel }}</CardDescription>
                <CardTitle class="text-3xl font-bold tabular-nums tracking-tight sm:text-4xl">
                  <span class="align-top text-sm font-normal text-muted-foreground">$</span>{{ formatAmount(monthTotal) }}
                </CardTitle>
              </div>

              <span
                v-if="monthDelta !== null"
                class="mt-1 flex shrink-0 items-center gap-1 text-xs font-medium"
                :class="monthDelta.direction === 'up' ? 'text-destructive' : 'text-success'"
              >
                <component :is="monthDelta.direction === 'up' ? ArrowUp : ArrowDown" class="size-3.5" />
                {{ monthDelta.percentLabel }} vs. mes anterior
              </span>
            </div>
          </CardHeader>
        </Card>

        <!-- Sección 2.2: Dona por tarjeta -->
        <Card v-if="showDistribution">
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Distribución por tarjeta
            </CardTitle>
          </CardHeader>
          <div class="flex flex-col items-center gap-4 px-6 pb-6 sm:flex-row sm:items-center">
            <CategoryDonutChart :slices="cardDonutSlices" class="size-32 shrink-0" />
            <ul class="flex w-full flex-col gap-2">
              <li v-for="slice in cardDonutSlices" :key="slice.id" class="flex items-center gap-2 text-sm">
                <span class="size-2.5 shrink-0 rounded-full" :style="{ background: slice.color ?? 'hsl(var(--muted-foreground))' }" />
                <span class="flex-1 truncate font-medium">{{ slice.name }}</span>
                <span class="tabular-nums">${{ formatAmount(slice.amount) }}</span>
                <span class="w-10 text-right text-xs text-muted-foreground">{{ slice.percentLabel }}</span>
              </li>
            </ul>
          </div>
        </Card>

        <!-- Sección 2.3: Lista de tarjetas — fondo de fila neutro (igual que
        cualquier otra card de la app); el color propio de la tarjeta vive
        solo en el chip cuadrado con esquinas redondeadas a la izquierda del
        nombre (icon-color-chip-ux.md), mismo tratamiento que "Mis cuentas"
        en Inicio/AccountsView.vue. `readableTextColor` decide si el ícono va
        blanco o casi negro según el hex de la tarjeta (mismo helper que ya
        resolvía el texto sobre el fondo completo, reusado acá para el ícono
        sobre el chip). -->
        <Card>
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Tus tarjetas
            </CardTitle>
          </CardHeader>
          <div class="flex flex-col gap-2 px-3 pb-3">
            <button
              v-for="card in cardsRanking"
              :key="card.id"
              type="button"
              class="flex min-h-14 w-full items-center gap-3 rounded-lg border border-border px-4 py-3 text-left transition hover:brightness-95 active:brightness-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :style="{ backgroundColor: withAlpha(card.color, 0.16) }"
              @click="router.push({ name: 'card-detail', params: { id: card.id } })"
            >
              <span
                class="flex size-10 shrink-0 items-center justify-center rounded-lg"
                :style="{ backgroundColor: card.color ?? 'hsl(var(--muted))' }"
              >
                <CreditCardIcon class="size-4.5" :style="{ color: readableTextColor(card.color) }" />
              </span>
              <div class="flex min-w-0 flex-1 flex-col">
                <p class="truncate text-sm font-semibold">
                  {{ card.name }}
                </p>
                <p class="truncate text-xs text-muted-foreground">
                  •••• {{ card.lastFourDigits }}
                </p>
              </div>
              <div class="flex flex-col items-end gap-0.5">
                <p class="text-sm font-semibold tabular-nums">
                  ${{ formatAmount(card.monthTotal) }}
                </p>
                <p class="text-xs text-muted-foreground">
                  {{ card.percentLabel }} del total
                </p>
              </div>
              <ChevronRight class="size-4 shrink-0 text-muted-foreground" />
            </button>
          </div>
          <p v-if="!showDistribution" class="px-6 pb-4 text-sm text-muted-foreground">
            Todavía no registraste gastos de tarjeta este mes.
          </p>
        </Card>

        <!-- Sección 2.4: Top personas -->
        <Card v-if="showDistribution && peopleRanking.length">
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Top personas
            </CardTitle>
          </CardHeader>
          <div class="flex flex-col gap-3 px-6 pb-6">
            <div v-for="p in peopleRanking" :key="p.id" class="flex items-center gap-3">
              <span
                v-if="p.color"
                class="flex size-6 shrink-0 items-center justify-center rounded-full"
                :style="{ background: p.color }"
              >
                <User class="size-3.5" :style="{ color: readableTextColor(p.color) }" />
              </span>
              <span v-else class="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
                <User class="size-3.5 text-muted-foreground" />
              </span>
              <span class="w-20 shrink-0 truncate text-xs text-muted-foreground">{{ p.name }}</span>
              <div class="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  class="h-full rounded-full"
                  :style="{ width: `${p.percentOfMax}%`, background: p.color ?? 'hsl(var(--muted-foreground))' }"
                />
              </div>
              <span class="w-14 shrink-0 text-right text-xs font-medium tabular-nums">{{ p.percentLabel }}</span>
            </div>
          </div>
        </Card>
      </template>
    </main>

    <Button
      v-if="hasCards"
      size="icon"
      class="fixed right-4 h-14 w-14 rounded-full shadow-[var(--shadow-elevated)] sm:right-6"
      style="bottom: calc(1.5rem + env(safe-area-inset-bottom))"
      aria-label="Agregar gasto de tarjeta"
      @click="openAddExpense"
    >
      <Plus class="size-6" />
    </Button>

    <CardExpenseFormSheet v-model:open="isExpenseSheetOpen" :sync-targets="dashboardSyncTargets" />
  </div>
</template>
