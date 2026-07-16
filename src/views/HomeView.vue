<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertCircle,
  ArrowLeftRight,
  ArrowUp,
  ArrowDown,
  ChartPie,
  FileText,
  Home,
  LogOut,
  Menu,
  Receipt,
  RotateCcw,
  Settings,
  Tag,
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import { useAuthStore } from '@/stores/auth'
import { useCategoriesStore } from '@/stores/categories'
import { useExpensesStore } from '@/stores/expenses'
import { currentMonthLabel, formatExpenseDateHeading, parseDateOnly } from '@/lib/date'
import { formatAmount } from '@/lib/currency'
import { withAlpha } from '@/lib/colors'
import { buildCumulativeDailySeries, buildDonutSlices, isMonthSafeToShow, type CategoryTotal } from '@/lib/charts'
import TrendAreaChart from '@/components/charts/TrendAreaChart.vue'
import CategoryDonutChart from '@/components/charts/CategoryDonutChart.vue'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent, SheetFooter, SheetTitle, SheetTrigger } from '@/components/ui/sheet'

// Rediseño de Inicio como dashboard (dashboard-redesign-ux.md, sección 2):
// saludo + total del mes con tendencia acumulada + dona de categorías +
// transacciones recientes de solo lectura. El listado completo/FAB/Sheet de
// alta se mudaron a TransactionsView (sección 2.5).

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const expensesStore = useExpensesStore()
const categoriesStore = useCategoriesStore()

const isInitialLoading = ref(true)
const loadError = ref(false)

// Inicio sigue siendo dueño de su propio fetch (sección 2.5): sigue
// necesitando gastos/categorías para el hero/dona/recientes, aunque ya no
// renderice el listado completo.
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

// Sección 2.1: saludo con el primer nombre (o el usuario del email), nunca
// el nombre/email completo.
const greetingName = computed(() => {
  const displayName = authStore.profile?.display_name?.trim()
  if (displayName) return displayName.split(/\s+/)[0]!
  const email = authStore.user?.email
  if (email) return email.split('@')[0]!
  return ''
})

function monthStart(offsetMonths: number, reference: Date = new Date()): Date {
  return new Date(reference.getFullYear(), reference.getMonth() + offsetMonths, 1)
}

// Gasto más viejo cargado (sección 1.1): la lista ya viene ordenada desc por
// `expense_date`, así que es literalmente el último elemento.
const oldestLoadedDate = computed(() => {
  const oldest = expensesStore.expenses.at(-1)
  return oldest ? parseDateOnly(oldest.expense_date) : null
})

const isPreviousMonthSafe = computed(() => {
  if (!oldestLoadedDate.value) return false
  return isMonthSafeToShow(monthStart(-1), oldestLoadedDate.value)
})

function totalForMonth(offsetMonths: number): number {
  const target = monthStart(offsetMonths)
  return expensesStore.expenses.reduce((sum, expense) => {
    const date = parseDateOnly(expense.expense_date)
    const matches = date.getFullYear() === target.getFullYear() && date.getMonth() === target.getMonth()
    return matches ? sum + expense.amount : sum
  }, 0)
}

// Sección 2.2: delta "vs. mes anterior", `null` si no es seguro calcularlo
// (sección 1.1) o si el mes anterior no tuvo gastos (división por cero) —
// nunca se inventa un número en su lugar.
const monthDelta = computed(() => {
  if (!isPreviousMonthSafe.value) return null
  const prevTotal = totalForMonth(-1)
  if (prevTotal === 0) return null

  const diffPercent = ((expensesStore.monthTotal - prevTotal) / prevTotal) * 100
  const direction: 'up' | 'down' = diffPercent >= 0 ? 'up' : 'down'
  return {
    direction,
    percentLabel: `${Math.abs(Math.round(diffPercent))}%`,
  }
})

const currentMonthExpenses = computed(() => {
  const now = new Date()
  return expensesStore.expenses.filter((expense) => {
    const date = parseDateOnly(expense.expense_date)
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
  })
})

const cumulativeDailyPoints = computed(() => buildCumulativeDailySeries(currentMonthExpenses.value))

// Sección 2.3: dona de categorías del mes en curso (siempre seguro de
// calcular, ver sección 1).
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
  return buildDonutSlices([...totals.values()], 5)
})

// Sección 2.4: últimas 5 transacciones, de solo lectura. La lista ya viene
// ordenada `expense_date desc, created_at desc` desde el store.
const recentExpenses = computed(() => expensesStore.expenses.slice(0, 5))

function expenseTitle(expense: (typeof recentExpenses.value)[number]): string {
  return expense.description || expense.category.name
}

const accountLabel = computed(() => authStore.profile?.display_name || authStore.user?.email || '')
const showEmailSecondary = computed(() => !!authStore.profile?.display_name)
const avatarInitial = computed(() => accountLabel.value.charAt(0).toUpperCase() || '?')

async function onLogout() {
  await authStore.signOut()
  await router.push('/login')
  toast('Sesión cerrada')
}

// Drawer de navegación principal (sección 6.1: 6 ítems, ya no incluye el
// selector de tema, movido a Ajustes).
const isDrawerOpen = ref(false)

type NavRouteName = 'home' | 'transactions' | 'categories' | 'statistics' | 'reports' | 'settings'

function isActive(name: NavRouteName): boolean {
  return route.name === name
}

function navigateFromDrawer(name: NavRouteName) {
  isDrawerOpen.value = false
  if (route.name !== name) {
    router.push({ name })
  }
}

function logoutFromDrawer() {
  isDrawerOpen.value = false
  onLogout()
}

// Sección 2.6: desde el estado vacío, "Agregar tu primer gasto" navega a
// Transacciones (el Sheet de alta ya no vive en Inicio) y le pide que abra
// el Sheet automáticamente vía `?new=1` (sección 3.4).
function goAddFirstExpense() {
  router.push({ name: 'transactions', query: { new: '1' } })
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <header class="flex items-center justify-between border-b border-border px-4 py-4 sm:px-6 lg:px-8">
      <Sheet v-model:open="isDrawerOpen">
        <SheetTrigger as-child>
          <Button variant="ghost" size="icon" aria-label="Abrir menú">
            <Menu class="size-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" class="p-0">
          <div class="flex items-center gap-3 border-b border-border p-6 pr-14">
            <SheetTitle class="sr-only">
              Menú principal
            </SheetTitle>
            <div class="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">
              {{ avatarInitial }}
            </div>
            <div class="flex min-w-0 flex-col">
              <p class="truncate text-base font-semibold text-foreground">
                {{ accountLabel }}
              </p>
              <p v-if="showEmailSecondary" class="truncate text-sm text-muted-foreground">
                {{ authStore.user?.email }}
              </p>
            </div>
          </div>

          <nav class="flex flex-col gap-1 p-3">
            <button
              type="button"
              class="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :class="isActive('home') ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'"
              :aria-current="isActive('home') ? 'page' : undefined"
              @click="navigateFromDrawer('home')"
            >
              <Home class="size-5 shrink-0" />
              Inicio
            </button>
            <button
              type="button"
              class="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :class="isActive('transactions') ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'"
              :aria-current="isActive('transactions') ? 'page' : undefined"
              @click="navigateFromDrawer('transactions')"
            >
              <ArrowLeftRight class="size-5 shrink-0" />
              Transacciones
            </button>
            <button
              type="button"
              class="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :class="isActive('categories') ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'"
              :aria-current="isActive('categories') ? 'page' : undefined"
              @click="navigateFromDrawer('categories')"
            >
              <Tag class="size-5 shrink-0" />
              Categorías
            </button>
            <button
              type="button"
              class="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :class="isActive('statistics') ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'"
              :aria-current="isActive('statistics') ? 'page' : undefined"
              @click="navigateFromDrawer('statistics')"
            >
              <ChartPie class="size-5 shrink-0" />
              Estadísticas
            </button>
            <button
              type="button"
              class="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :class="isActive('reports') ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'"
              :aria-current="isActive('reports') ? 'page' : undefined"
              @click="navigateFromDrawer('reports')"
            >
              <FileText class="size-5 shrink-0" />
              Reportes
            </button>
            <button
              type="button"
              class="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :class="isActive('settings') ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'"
              :aria-current="isActive('settings') ? 'page' : undefined"
              @click="navigateFromDrawer('settings')"
            >
              <Settings class="size-5 shrink-0" />
              Ajustes
            </button>
          </nav>

          <SheetFooter class="border-t border-border">
            <button
              type="button"
              class="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              @click="logoutFromDrawer"
            >
              <LogOut class="size-5 shrink-0" />
              Cerrar sesión
            </button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <h1 class="text-xl font-semibold">
        TipApp
      </h1>
    </header>

    <main class="mx-auto flex max-w-md flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <!-- Sección 2.1: saludo -->
      <div class="flex flex-col gap-1">
        <h2 class="text-xl font-semibold">
          Hola, {{ greetingName }}
        </h2>
        <p class="text-sm text-muted-foreground">
          Este es el resumen de tus gastos.
        </p>
      </div>

      <!-- Estado de carga -->
      <template v-if="isInitialLoading">
        <Card>
          <CardHeader>
            <Skeleton class="h-4 w-32" />
            <Skeleton class="mt-2 h-9 w-40" />
          </CardHeader>
          <Skeleton class="mx-6 mb-4 h-16" />
        </Card>

        <Card>
          <CardHeader>
            <Skeleton class="h-4 w-40" />
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
            <Skeleton class="h-4 w-48" />
          </CardHeader>
          <div class="flex flex-col">
            <div v-for="i in 3" :key="i" class="flex items-center gap-3 px-6 py-3">
              <Skeleton class="size-9 shrink-0 rounded-full" />
              <div class="flex flex-1 flex-col gap-1.5">
                <Skeleton class="h-4 w-32" />
                <Skeleton class="h-3 w-20" />
              </div>
              <Skeleton class="h-4 w-14" />
            </div>
          </div>
        </Card>
      </template>

      <!-- Estado de error -->
      <template v-else-if="loadError">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <AlertCircle class="size-12 text-destructive" />
          <h2 class="text-lg font-semibold">
            No pudimos cargar tus gastos
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

      <!-- Estado vacío -->
      <template v-else-if="expensesStore.expenses.length === 0">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <Receipt class="size-12 text-muted-foreground" />
          <h2 class="text-lg font-semibold">
            Todavía no registraste ningún gasto
          </h2>
          <p class="max-w-xs text-center text-sm text-muted-foreground">
            Empezá a registrar tus gastos para ver acá tu resumen y tu historial.
          </p>
          <Button @click="goAddFirstExpense">
            Agregar tu primer gasto
          </Button>
        </div>
      </template>

      <!-- Dashboard (sección 2.2/2.3/2.4) -->
      <template v-else>
        <Card>
          <CardHeader>
            <div class="flex items-start justify-between gap-2">
              <div class="flex flex-col gap-1">
                <CardDescription>Total de {{ monthLabel }}</CardDescription>
                <CardTitle class="text-3xl font-bold tabular-nums tracking-tight sm:text-4xl">
                  <span class="align-top text-sm font-normal text-muted-foreground">$</span>{{ formatAmount(expensesStore.monthTotal) }}
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

          <TrendAreaChart
            :points="cumulativeDailyPoints"
            class="px-6 pb-4"
            :height="72"
            :ariaLabel="`Gasto acumulado de ${monthLabel}, día a día`"
          />
        </Card>

        <Card v-if="donutSlices.length">
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Resumen por categoría
            </CardTitle>
            <CardAction>
              <Button variant="link" size="sm" class="h-auto p-0" @click="router.push({ name: 'statistics' })">
                Ver más
              </Button>
            </CardAction>
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

        <Card>
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Transacciones recientes
            </CardTitle>
            <CardAction>
              <Button variant="link" size="sm" class="h-auto p-0" @click="router.push({ name: 'transactions' })">
                Ver todas
              </Button>
            </CardAction>
          </CardHeader>

          <div class="flex flex-col">
            <template v-for="(expense, idx) in recentExpenses" :key="expense.id">
              <Separator v-if="idx > 0" />
              <div class="flex items-center gap-3 px-6 py-3">
                <span
                  class="flex size-9 shrink-0 items-center justify-center rounded-full border"
                  :style="{ backgroundColor: withAlpha(expense.category.color, 0.12), borderColor: expense.category.color ?? undefined }"
                >
                  <span v-if="expense.category.icon" class="text-sm leading-none">{{ expense.category.icon }}</span>
                </span>
                <div class="flex min-w-0 flex-1 flex-col">
                  <p class="truncate text-sm font-medium">
                    {{ expenseTitle(expense) }}
                  </p>
                  <p class="truncate text-xs text-muted-foreground">
                    {{ expense.category.name }}
                  </p>
                </div>
                <div class="flex flex-col items-end gap-0.5">
                  <p class="text-sm font-semibold tabular-nums">
                    ${{ formatAmount(expense.amount) }}
                  </p>
                  <p class="text-xs text-muted-foreground">
                    {{ formatExpenseDateHeading(expense.expense_date) }}
                  </p>
                </div>
              </div>
            </template>
          </div>
        </Card>
      </template>
    </main>
  </div>
</template>
