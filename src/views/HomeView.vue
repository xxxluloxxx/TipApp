<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertCircle,
  ArrowDownCircle,
  ArrowRightLeft,
  ArrowUp,
  ArrowDown,
  CircleDollarSign,
  HandCoins,
  Plus,
  Receipt,
  RotateCcw,
  Scale,
} from '@lucide/vue'
import { useAccountsStore } from '@/stores/accounts'
import { useAccountTransfersStore } from '@/stores/accountTransfers'
import { useAuthStore } from '@/stores/auth'
import { useCategoriesStore } from '@/stores/categories'
import { useDebtsStore, type DebtMovementWithDebt } from '@/stores/debts'
import { useDebtPeopleStore } from '@/stores/debtPeople'
import { useExpensesStore } from '@/stores/expenses'
import { useIncomesStore } from '@/stores/incomes'
import { buildTransactionItems, type TransactionItem } from '@/lib/transactionItems'
import { movementVerb } from '@/lib/debtDisplay'
import { currentMonthLabel, formatExpenseDateHeading, formatTimeShort, parseDateOnly } from '@/lib/date'
import { formatAmount } from '@/lib/currency'
import { readableTextColor, withAlpha } from '@/lib/colors'
import { resolveAccountIcon } from '@/lib/accountIcons'
import { buildCumulativeDailySeries, buildDonutSlices, isMonthSafeToShow, type CategoryTotal } from '@/lib/charts'
import TrendAreaChart from '@/components/charts/TrendAreaChart.vue'
import CategoryDonutChart from '@/components/charts/CategoryDonutChart.vue'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import AppHeader from '@/components/AppHeader.vue'

// Rediseño de Inicio como dashboard (dashboard-redesign-ux.md, sección 2):
// saludo + total del mes con tendencia acumulada + dona de categorías +
// transacciones recientes de solo lectura. El listado completo/FAB/Sheet de
// alta se mudaron a TransactionsView (sección 2.5).

const router = useRouter()
const authStore = useAuthStore()
const expensesStore = useExpensesStore()
const incomesStore = useIncomesStore()
const categoriesStore = useCategoriesStore()
const accountsStore = useAccountsStore()
const accountTransfersStore = useAccountTransfersStore()
const debtsStore = useDebtsStore()
const debtPeopleStore = useDebtPeopleStore()


const isInitialLoading = ref(true)
const loadError = ref(false)

// debts-ux.md sección 13.1: movimientos de deuda con cuenta vinculada (todos
// los hilos), para las filas sintéticas `debt-linked` de "Transacciones
// recientes". Ref local, mismo criterio que `TransactionsView`.
const debtLinkedMovements = ref<DebtMovementWithDebt[]>([])

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
      // account-transfers-ux.md sección 6.4: alimenta los 2 ítems sintéticos
      // de transferencia de "Transacciones recientes". Su fallo no bloquea la
      // vista (degradación: sin esas filas).
      accountTransfersStore.fetchAll(),
      // debts-ux.md sección 13.1: personas + movimientos con cuenta vinculada,
      // para las filas `debt-linked`. Su fallo tampoco bloquea la vista.
      debtPeopleStore.fetchPeople(),
      (async () => {
        debtLinkedMovements.value = (await debtsStore.fetchAccountLinkedMovements()) ?? []
      })(),
    ])
    if (expensesStore.error || incomesStore.error) loadError.value = true
  } finally {
    isInitialLoading.value = false
  }
}

onMounted(loadAll)

const monthLabel = computed(() => currentMonthLabel())

// FAB "Agregar movimiento": solo visible en el estado dashboard-con-datos
// (mismo guard que la rama <template v-else> del dashboard), nunca durante la
// carga inicial, en error, ni en el estado vacío (que ya tiene su propio CTA).
const showFab = computed(
  () => !isInitialLoading.value && !loadError.value && expensesStore.expenses.length > 0,
)

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

// Sección 7.5 + account-transfers-ux.md sección 6.4: "Transacciones recientes"
// mezcla gasto, ingreso y las 2 caras sintéticas de cada transferencia,
// ordenadas por fecha desc — mismo merge compartido que `TransactionsView.vue`
// (`buildTransactionItems`), recortado a las últimas 5 (sigue siendo de solo
// lectura). Los ítems de transferencia no tocan ningún total agregado.
const recentItems = computed<TransactionItem[]>(() =>
  buildTransactionItems(
    expensesStore.expenses,
    incomesStore.incomes,
    accountTransfersStore.transfers,
    debtLinkedMovements.value,
  ).slice(0, 5),
)

function accountName(id: string): string {
  return accountsStore.accountById(id)?.name ?? 'Cuenta'
}
function accountColor(id: string): string {
  return accountsStore.accountById(id)?.color ?? '#6b7280'
}
// debts-ux.md sección 13.3/13.4: nombre de la contraparte, resuelto contra
// `debtPeopleStore` por `movement.debt.person_id`.
function personName(movement: DebtMovementWithDebt): string {
  return debtPeopleStore.personById(movement.debt.person_id)?.name ?? 'Persona'
}

// Filas con monto en verde y signo `+`: ingreso real, la cara de entrada de
// una transferencia (sección 6.4.2) y un movimiento de deuda que sumó saldo
// (debts-ux.md sección 13.4). Gasto real (sección 6.6), la cara de salida y un
// movimiento de deuda negativo van en `text-destructive`.
function isPositive(item: TransactionItem): boolean {
  return item.kind === 'income'
    || item.kind === 'transfer-in'
    || (item.kind === 'debt-linked' && item.data.amount > 0)
}

// Sección 6.4.1 + 13.3: el título de una transferencia nombra "la otra punta"
// (destino para la salida, origen para la entrada); el de una deuda reusa el
// verbo del movimiento + la persona (guión largo).
function itemTitle(item: TransactionItem): string {
  switch (item.kind) {
    case 'expense': return item.data.description || item.data.category.name
    case 'income': return item.data.description || 'Ingreso'
    case 'transfer-out': return `Transferencia a ${accountName(item.data.to_account_id)}`
    case 'transfer-in': return `Transferencia desde ${accountName(item.data.from_account_id)}`
    case 'debt-linked': return `${movementVerb(item.data)} — ${personName(item.data)}`
  }
}
// Sección 6.5 + 13.4: el subtítulo de un gasto real pasa a "Categoría · Cuenta"
// (sin punto de color, ese layout ya usa el color en el círculo del ícono). El
// de una transferencia nombra la cuenta de su propia cara. El de una deuda es
// "{persona} · {cuenta}" (la persona cumple el rol de clasificador que en un
// gasto cumple la categoría). El `!` es seguro: `debt-linked` solo existe con
// cuenta vinculada (sección 13.2).
function itemSubtitle(item: TransactionItem): string {
  switch (item.kind) {
    case 'expense': return `${item.data.category.name} · ${accountName(item.data.account_id)}`
    case 'income': return item.data.account.name
    case 'transfer-out': return accountName(item.data.from_account_id)
    case 'transfer-in': return accountName(item.data.to_account_id)
    case 'debt-linked': return `${personName(item.data)} · ${accountName(item.data.account_id!)}`
  }
}
// Color del círculo del ícono de una transferencia (6.4.2): origen para la
// salida, destino para la entrada.
function transferCircleColor(item: TransactionItem): string {
  if (item.kind === 'transfer-out') return accountColor(item.data.from_account_id)
  if (item.kind === 'transfer-in') return accountColor(item.data.to_account_id)
  return '#6b7280'
}
// Color del círculo del ícono de una deuda con cuenta vinculada (sección
// 13.4): siempre el de su única cuenta (no hay origen/destino que elegir).
function debtLinkedCircleColor(item: TransactionItem): string {
  if (item.kind !== 'debt-linked' || !item.data.account_id) return '#6b7280'
  return accountColor(item.data.account_id)
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
    <AppHeader title="TipApp" />

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
            show-axis
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
              class="flex flex-col gap-2 rounded-lg border border-border p-3 text-left transition hover:brightness-95 active:brightness-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :style="{ backgroundColor: withAlpha(account.color ?? '#6b7280', 0.16) }"
              @click="router.push({ name: 'account-detail', params: { id: account.id } })"
            >
              <span
                class="flex size-10 shrink-0 items-center justify-center rounded-lg"
                :style="{ backgroundColor: account.color ?? '#6b7280' }"
              >
                <component
                  :is="resolveAccountIcon(account.icon)"
                  class="size-5"
                  :style="{ color: readableTextColor(account.color ?? '#6b7280') }"
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
              <div
                class="flex items-center gap-3 px-6 py-3"
                :class="isPositive(item) ? 'bg-success/5 dark:bg-success/10' : 'bg-destructive/5 dark:bg-destructive/10'"
              >
                <!-- Gasto real: círculo con color de categoría + emoji. -->
                <span
                  v-if="item.kind === 'expense'"
                  class="flex size-9 shrink-0 items-center justify-center rounded-full border"
                  :style="{ backgroundColor: withAlpha(item.data.category.color, 0.12), borderColor: item.data.category.color ?? undefined }"
                >
                  <span v-if="item.data.category.icon" class="text-sm leading-none">{{ item.data.category.icon }}</span>
                </span>
                <!-- Ingreso real: círculo con color de cuenta + ArrowDownCircle. -->
                <span
                  v-else-if="item.kind === 'income'"
                  class="flex size-9 shrink-0 items-center justify-center rounded-full border"
                  :style="{ backgroundColor: withAlpha(item.data.account.color ?? '#6b7280', 0.12), borderColor: item.data.account.color ?? '#6b7280' }"
                >
                  <ArrowDownCircle class="size-4" :style="{ color: item.data.account.color ?? '#6b7280' }" />
                </span>
                <!-- Deuda con cuenta vinculada (debts-ux.md sección 13.4):
                     círculo con color de la cuenta + HandCoins (nunca
                     ArrowDownCircle/ArrowRightLeft, reservados para ingreso/
                     transferencia). Un solo ícono para ambas direcciones — lo
                     que comunica es "esto es de Deudas", no el flujo. -->
                <span
                  v-else-if="item.kind === 'debt-linked'"
                  class="flex size-9 shrink-0 items-center justify-center rounded-full border"
                  :style="{ backgroundColor: withAlpha(debtLinkedCircleColor(item), 0.12), borderColor: debtLinkedCircleColor(item) }"
                >
                  <HandCoins class="size-4" :style="{ color: debtLinkedCircleColor(item) }" />
                </span>
                <!-- Transferencia (6.4.2): círculo con color de su propia cara
                     (origen/destino) + ArrowRightLeft, NO ArrowDownCircle (que
                     se reserva para ingreso real en este layout sin badge). -->
                <span
                  v-else
                  class="flex size-9 shrink-0 items-center justify-center rounded-full border"
                  :style="{ backgroundColor: withAlpha(transferCircleColor(item), 0.12), borderColor: transferCircleColor(item) }"
                >
                  <ArrowRightLeft class="size-4" :style="{ color: transferCircleColor(item) }" />
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
                    :class="isPositive(item) ? 'text-success' : 'text-destructive'"
                  >
                    {{ isPositive(item) ? '+' : '' }}${{ formatAmount(Math.abs(item.data.amount)) }}
                  </p>
                  <p class="text-xs text-muted-foreground">
                    <!-- transaction-time-ux.md sección 6: "Hoy · 14:32" cuando hay hora. -->
                    {{ formatExpenseDateHeading(item.date) }}{{ item.time ? ` · ${formatTimeShort(item.time)}` : '' }}
                  </p>
                </div>
              </div>
            </template>
          </div>
        </Card>
      </template>
    </main>

    <Button
      v-if="showFab"
      size="icon"
      class="fixed right-4 h-14 w-14 rounded-full shadow-[var(--shadow-elevated)] sm:right-6"
      style="bottom: calc(1.5rem + env(safe-area-inset-bottom))"
      aria-label="Agregar movimiento"
      @click="goAddFirstExpense"
    >
      <Plus class="size-6" />
    </Button>
  </div>
</template>
