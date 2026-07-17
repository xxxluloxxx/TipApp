<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertCircle,
  ArrowDownCircle,
  ArrowLeftRight,
  ArrowUp,
  ArrowDown,
  ChartPie,
  CircleDollarSign,
  CreditCard,
  FileText,
  HandCoins,
  Home,
  LogOut,
  Menu,
  Plus,
  Receipt,
  RotateCcw,
  Scale,
  Settings,
  Tag,
  Wallet,
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import { useAccountsStore } from '@/stores/accounts'
import { useAuthStore } from '@/stores/auth'
import { useCategoriesStore } from '@/stores/categories'
import { useExpensesStore, type ExpenseWithCategory } from '@/stores/expenses'
import { useIncomesStore, type IncomeWithAccount } from '@/stores/incomes'
import { currentMonthLabel, formatExpenseDateHeading, parseDateOnly } from '@/lib/date'
import { formatAmount } from '@/lib/currency'
import { resolveAccountColor, withAlpha } from '@/lib/colors'
import { resolveAccountIcon } from '@/lib/accountIcons'
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
const incomesStore = useIncomesStore()
const categoriesStore = useCategoriesStore()
const accountsStore = useAccountsStore()

const isDarkNow = computed(() => document.documentElement.classList.contains('dark'))

const isInitialLoading = ref(true)
const loadError = ref(false)

// Inicio sigue siendo dueño de su propio fetch (sección 2.5): sigue
// necesitando gastos/categorías para el hero/dona/recientes, aunque ya no
// renderice el listado completo. accounts-income-ux.md sección 2/7 agrega
// cuentas/ingresos a este mismo fetch conjunto.
async function loadAll() {
  loadError.value = false
  isInitialLoading.value = true
  try {
    await Promise.all([
      categoriesStore.fetchCategories(),
      expensesStore.fetchAll(),
      incomesStore.fetchAll(),
      accountsStore.fetchAccounts(),
      accountsStore.fetchBalances(),
    ])
    if (expensesStore.error || incomesStore.error) loadError.value = true
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

// Sección 2.3 de accounts-income-ux.md: hasta 5 cuentas, ordenadas desc por
// saldo (las más significativas primero, mismo criterio que `cardsRanking`
// de credit-cards-ux.md) + siempre la tile "Agregar cuenta" al final
// (manejada aparte en el template, no en este computed).
const topAccounts = computed(() =>
  [...accountsStore.accounts]
    .sort((a, b) => accountsStore.balanceFor(b.id) - accountsStore.balanceFor(a.id))
    .slice(0, 5),
)

type TransactionItem =
  | { kind: 'expense', id: string, date: string, data: ExpenseWithCategory }
  | { kind: 'income', id: string, date: string, data: IncomeWithAccount }

// Sección 7.5: "Transacciones recientes" mezcla gasto e ingreso, ordenadas
// por fecha desc — mismo criterio de merge que `TransactionsView.vue`,
// recortado a las últimas 5 (sección 2.4, sin cambios de alcance: sigue
// siendo de solo lectura).
const recentItems = computed<TransactionItem[]>(() => {
  const expenseItems: TransactionItem[] = expensesStore.expenses.map(expense => ({
    kind: 'expense',
    id: expense.id,
    date: expense.expense_date,
    data: expense,
  }))
  const incomeItems: TransactionItem[] = incomesStore.incomes.map(income => ({
    kind: 'income',
    id: income.id,
    date: income.income_date,
    data: income,
  }))
  return [...expenseItems, ...incomeItems]
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1
      return b.data.created_at.localeCompare(a.data.created_at)
    })
    .slice(0, 5)
})

function itemTitle(item: TransactionItem): string {
  if (item.kind === 'expense') return item.data.description || item.data.category.name
  return item.data.description || 'Ingreso'
}
function itemSubtitle(item: TransactionItem): string {
  return item.kind === 'expense' ? item.data.category.name : item.data.account.name
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

type NavRouteName = 'home' | 'transactions' | 'cards' | 'accounts' | 'debts' | 'categories' | 'statistics' | 'reports' | 'settings'

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
              :class="isActive('cards') ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'"
              :aria-current="isActive('cards') ? 'page' : undefined"
              @click="navigateFromDrawer('cards')"
            >
              <CreditCard class="size-5 shrink-0" />
              Tarjetas de crédito
            </button>
            <button
              type="button"
              class="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :class="isActive('accounts') ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'"
              :aria-current="isActive('accounts') ? 'page' : undefined"
              @click="navigateFromDrawer('accounts')"
            >
              <Wallet class="size-5 shrink-0" />
              Cuentas
            </button>
            <button
              type="button"
              class="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :class="isActive('debts') ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'"
              :aria-current="isActive('debts') ? 'page' : undefined"
              @click="navigateFromDrawer('debts')"
            >
              <HandCoins class="size-5 shrink-0" />
              Deudas
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

        <!-- accounts-income-ux.md sección 2.3: "Mis cuentas" -->
        <Card>
          <CardHeader>
            <div class="flex items-start justify-between gap-2">
              <div class="flex flex-col gap-0.5">
                <CardTitle class="text-base font-semibold">
                  Mis cuentas
                </CardTitle>
                <CardDescription>
                  Saldo total: <span class="font-semibold tabular-nums text-foreground">${{ formatAmount(accountsStore.totalBalance) }}</span>
                </CardDescription>
              </div>
              <CardAction>
                <Button variant="link" size="sm" class="h-auto p-0" @click="router.push({ name: 'accounts' })">
                  Ver todas
                </Button>
              </CardAction>
            </div>
          </CardHeader>

          <div class="grid grid-cols-2 gap-3 px-4 pb-4 sm:px-6 sm:pb-6">
            <button
              v-for="account in topAccounts"
              :key="account.id"
              type="button"
              class="flex flex-col gap-2 rounded-lg border border-border p-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              disabled
              aria-disabled="true"
            >
              <span
                class="flex size-9 shrink-0 items-center justify-center rounded-full"
                :style="{ backgroundColor: withAlpha(account.color, 0.15) }"
              >
                <component
                  :is="resolveAccountIcon(account.icon)"
                  class="size-5"
                  :style="{ color: resolveAccountColor(account.color ?? '#6b7280', isDarkNow) }"
                />
              </span>
              <div class="flex flex-col gap-0.5">
                <p class="truncate text-sm font-medium">
                  {{ account.name }}
                </p>
                <p
                  class="text-sm font-semibold tabular-nums"
                  :class="accountsStore.balanceFor(account.id) < 0 ? 'text-destructive' : 'text-foreground'"
                >
                  {{ accountsStore.balanceFor(account.id) < 0 ? '-' : '' }}${{ formatAmount(Math.abs(accountsStore.balanceFor(account.id))) }}
                </p>
              </div>
            </button>

            <button
              type="button"
              class="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              @click="router.push({ name: 'accounts', query: { new: '1' } })"
            >
              <Plus class="size-5" />
              Agregar cuenta
            </button>
          </div>
        </Card>

        <!-- accounts-income-ux.md sección 9: Accesos rápidos -->
        <div class="flex gap-2">
          <Button variant="outline" class="flex h-auto flex-1 flex-col gap-1 py-3" @click="router.push({ name: 'accounts' })">
            <Scale class="size-5" />
            <span class="text-xs font-medium">Saldo</span>
          </Button>

          <Button variant="outline" class="flex h-auto flex-1 flex-col gap-1 py-3" disabled aria-disabled="true">
            <CircleDollarSign class="size-5" />
            <span class="text-xs font-medium">Pagos</span>
            <span class="text-[10px] text-muted-foreground">Próximamente</span>
          </Button>

          <Button variant="outline" class="flex h-auto flex-1 flex-col gap-1 py-3" @click="router.push({ name: 'debts' })">
            <HandCoins class="size-5" />
            <span class="text-xs font-medium">Deudas</span>
          </Button>
        </div>

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
            <template v-for="(item, idx) in recentItems" :key="`${item.kind}-${item.id}`">
              <Separator v-if="idx > 0" />
              <div class="flex items-center gap-3 px-6 py-3">
                <span
                  v-if="item.kind === 'expense'"
                  class="flex size-9 shrink-0 items-center justify-center rounded-full border"
                  :style="{ backgroundColor: withAlpha(item.data.category.color, 0.12), borderColor: item.data.category.color ?? undefined }"
                >
                  <span v-if="item.data.category.icon" class="text-sm leading-none">{{ item.data.category.icon }}</span>
                </span>
                <span
                  v-else
                  class="flex size-9 shrink-0 items-center justify-center rounded-full border"
                  :style="{ backgroundColor: withAlpha(resolveAccountColor(item.data.account.color ?? '#6b7280', isDarkNow), 0.12), borderColor: resolveAccountColor(item.data.account.color ?? '#6b7280', isDarkNow) }"
                >
                  <ArrowDownCircle class="size-4" :style="{ color: resolveAccountColor(item.data.account.color ?? '#6b7280', isDarkNow) }" />
                </span>
                <div class="flex min-w-0 flex-1 flex-col">
                  <p class="truncate text-sm font-medium">
                    {{ itemTitle(item) }}
                  </p>
                  <p class="truncate text-xs text-muted-foreground">
                    {{ itemSubtitle(item) }}
                  </p>
                </div>
                <div class="flex flex-col items-end gap-0.5">
                  <p
                    class="text-sm font-semibold tabular-nums"
                    :class="item.kind === 'income' ? 'text-success' : 'text-foreground'"
                  >
                    {{ item.kind === 'income' ? '+' : '' }}${{ formatAmount(item.data.amount) }}
                  </p>
                  <p class="text-xs text-muted-foreground">
                    {{ formatExpenseDateHeading(item.date) }}
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
