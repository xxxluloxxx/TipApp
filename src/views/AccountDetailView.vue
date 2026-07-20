<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import {
  AlertCircle,
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  EllipsisVertical,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from '@lucide/vue'
import { formatDateOnly, formatExpenseDateHeading } from '@/lib/date'
import { formatAmount } from '@/lib/currency'
import { readableTextColor, resolveAccountColor } from '@/lib/colors'
import { resolveAccountIcon } from '@/lib/accountIcons'
import { buildAccountBalanceEvolution, type AccountMovementInput, type TrendPoint } from '@/lib/charts'
import { buildAccountTransactionItems, type TransactionItem } from '@/lib/transactionItems'
import { supabase } from '@/lib/supabase'
import { useAccountsStore } from '@/stores/accounts'
import { useCategoriesStore } from '@/stores/categories'
import { useExpensesStore, type ExpenseWithCategory } from '@/stores/expenses'
import { useIncomesStore, type IncomeWithAccount } from '@/stores/incomes'
import { useAccountTransfersStore, type AccountTransfer } from '@/stores/accountTransfers'
import AppHeader from '@/components/AppHeader.vue'
import AccountFormSheet from '@/components/AccountFormSheet.vue'
import AccountBalanceAdjustmentSheet from '@/components/AccountBalanceAdjustmentSheet.vue'
import TransactionFormSheet from '@/components/TransactionFormSheet.vue'
import TrendAreaChart from '@/components/charts/TrendAreaChart.vue'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

// Sección completa de account-detail-ux.md: detalle de una cuenta puntual.
// Vista de "segundo nivel" (fetch propio, deep-link directo, mismo criterio
// que DebtDetailView.vue/CardDetailView.vue). Sin botón "Volver" — el drawer
// del AppHeader es el único acceso de navegación (regla dura del proyecto).

const route = useRoute()
const accountsStore = useAccountsStore()
const categoriesStore = useCategoriesStore()
const expensesStore = useExpensesStore()
const incomesStore = useIncomesStore()
const accountTransfersStore = useAccountTransfersStore()

const accountId = computed(() => String(route.params.id))
const account = computed(() => accountsStore.accountById(accountId.value))
// Sección 4: saldo actual leído del mismo computed que usan AccountsView/
// HomeView (account_balances), nunca recalculado a mano acá.
const currentBalance = computed(() => accountsStore.balanceFor(accountId.value))

const isDarkNow = ref(document.documentElement.classList.contains('dark'))

const isInitialLoading = ref(true)
const loadError = ref(false)

// Sección 6: serie de saldo de los últimos 30 días.
const balanceEvolutionPoints = ref<TrendPoint[]>([])

// Sección 7: movimientos recientes, cada lista con su propio fetch acotado
// por cuenta (nunca un filtro sobre las listas globales capadas a 200).
const recentExpenses = ref<ExpenseWithCategory[]>([])
const recentIncomes = ref<IncomeWithAccount[]>([])
const recentTransfers = ref<AccountTransfer[]>([])

const PAGE_SIZE = 10
const currentLimit = ref(PAGE_SIZE)
const hasMore = ref(true)
const isLoadingMore = ref(false)

// -- Sección 6.1: serie de evolución de saldo ------------------------------

async function loadBalanceEvolution(): Promise<boolean> {
  if (!account.value) return false

  const reference = new Date()
  // Sección 6.3, caso borde 2: cuenta más joven que 30 días → la ventana se
  // recorta a su fecha de creación (nunca una línea plana imaginaria antes de
  // que existiera). `account.created_at` es un timestamp completo, así que se
  // normaliza con `new Date(...)` a medianoche local (NO `parseDateOnly`, que
  // asume una fecha `YYYY-MM-DD` pura — desviación puntual del snippet del
  // doc, ver reporte).
  const createdAt = new Date(account.value.created_at)
  const createdAtMidnight = new Date(createdAt.getFullYear(), createdAt.getMonth(), createdAt.getDate())
  const thirtyDaysAgo = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate())
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const windowStart = createdAtMidnight.getTime() > thirtyDaysAgo.getTime() ? createdAtMidnight : thirtyDaysAgo
  const windowStartKey = formatDateOnly(windowStart)

  const id = accountId.value
  const [expensesRes, incomesRes, transfersRes] = await Promise.all([
    supabase.from('expenses').select('amount, expense_date')
      .eq('account_id', id).gte('expense_date', windowStartKey),
    supabase.from('incomes').select('amount, income_date')
      .eq('account_id', id).gte('income_date', windowStartKey),
    supabase.from('account_transfers').select('amount, transfer_date, from_account_id, to_account_id')
      .or(`from_account_id.eq.${id},to_account_id.eq.${id}`).gte('transfer_date', windowStartKey),
  ])

  if (expensesRes.error || incomesRes.error || transfersRes.error) {
    console.error('[accountDetail] No se pudo cargar la evolución de saldo', {
      expenses: expensesRes.error, incomes: incomesRes.error, transfers: transfersRes.error,
    })
    return false
  }

  const windowMovements: AccountMovementInput[] = [
    ...(expensesRes.data ?? []).map(e => ({ date: e.expense_date, signedAmount: -e.amount })),
    ...(incomesRes.data ?? []).map(i => ({ date: i.income_date, signedAmount: i.amount })),
    ...(transfersRes.data ?? []).map(t => ({
      date: t.transfer_date,
      signedAmount: t.from_account_id === id ? -t.amount : t.amount,
    })),
  ]

  balanceEvolutionPoints.value = buildAccountBalanceEvolution(
    currentBalance.value,
    windowMovements,
    windowStart,
    reference,
  )
  return true
}

// -- Sección 7: movimientos recientes --------------------------------------

async function loadMovements(): Promise<boolean> {
  const id = accountId.value
  const [expensesRes, incomesRes, transfersRes] = await Promise.all([
    expensesStore.fetchRecentForAccount(id, currentLimit.value),
    incomesStore.fetchRecentForAccount(id, currentLimit.value),
    accountTransfersStore.fetchRecentForAccount(id, currentLimit.value),
  ])
  if (expensesRes === null || incomesRes === null || transfersRes === null) {
    return false
  }
  recentExpenses.value = expensesRes
  recentIncomes.value = incomesRes
  recentTransfers.value = transfersRes

  // Heurística simple (sección 7.3): si ninguna de las 3 queries llegó a su
  // propio tope, no puede haber más para traer.
  hasMore.value = expensesRes.length === currentLimit.value
    || incomesRes.length === currentLimit.value
    || transfersRes.length === currentLimit.value
  return true
}

async function showMore() {
  isLoadingMore.value = true
  try {
    currentLimit.value += PAGE_SIZE
    await loadMovements()
  } finally {
    isLoadingMore.value = false
  }
}

// -- Sección 8.1: carga inicial --------------------------------------------

async function loadAll() {
  loadError.value = false
  isInitialLoading.value = true
  try {
    const [accountsOk, balancesOk, categoriesOk] = await Promise.all([
      accountsStore.fetchAccounts(),
      accountsStore.fetchBalances(),
      categoriesStore.fetchCategories(),
    ])
    if (!accountsOk || !balancesOk || !categoriesOk || !account.value) {
      loadError.value = true
      return
    }
    const [evolutionOk, movementsOk] = await Promise.all([loadBalanceEvolution(), loadMovements()])
    if (!evolutionOk || !movementsOk) loadError.value = true
  } finally {
    isInitialLoading.value = false
  }
}

onMounted(loadAll)

// -- Movimientos: merge acotado por cuenta (sección 7.2) --------------------

const mergedItems = computed<TransactionItem[]>(() =>
  buildAccountTransactionItems(recentExpenses.value, recentIncomes.value, recentTransfers.value, accountId.value),
)

// account-transfers-ux.md sección 6.3: gasto de comisión de una transferencia
// — no se edita/borra directo (desincronizaría su transferencia dueña). Se
// deriva de las transferencias recientes de ESTA cuenta (su `expense_id`), sin
// depender de la lista global del store (que esta vista no carga).
const linkedExpenseIds = computed(
  () => new Set(recentTransfers.value.map(t => t.expense_id).filter((id): id is string => !!id)),
)

function accountName(id: string): string {
  return accountsStore.accountById(id)?.name ?? 'Cuenta'
}

function itemTitle(item: TransactionItem): string {
  switch (item.kind) {
    case 'expense': return item.data.description || item.data.category.name
    case 'income': return item.data.description || 'Ingreso'
    case 'transfer-out': return `Transferencia a ${accountName(item.data.to_account_id)}`
    case 'transfer-in': return `Transferencia desde ${accountName(item.data.from_account_id)}`
  }
}

function isTransfer(item: TransactionItem): boolean {
  return item.kind === 'transfer-out' || item.kind === 'transfer-in'
}
function isPositive(item: TransactionItem): boolean {
  return item.kind === 'income' || item.kind === 'transfer-in'
}
function itemPending(item: TransactionItem): boolean {
  return (item.kind === 'expense' || item.kind === 'income') && !!item.data._pending
}
function isTransferCommission(item: TransactionItem): boolean {
  return item.kind === 'expense' && linkedExpenseIds.value.has(item.id)
}
function itemDeleteTitle(item: TransactionItem): string {
  return item.kind === 'income' ? '¿Eliminar este ingreso?' : '¿Eliminar este gasto?'
}

// -- Sheets -----------------------------------------------------------------

const isEditSheetOpen = ref(false)
function openEditSheet() {
  isEditSheetOpen.value = true
}

const isAdjustSheetOpen = ref(false)

const isTransactionSheetOpen = ref(false)
const editingTransaction = ref<
  { kind: 'expense', expense: ExpenseWithCategory } | { kind: 'income', income: IncomeWithAccount } | null
>(null)

function openAddTransaction() {
  editingTransaction.value = null
  isTransactionSheetOpen.value = true
}
function openEditItem(item: TransactionItem) {
  if (item.kind === 'expense') {
    editingTransaction.value = { kind: 'expense', expense: item.data }
  } else if (item.kind === 'income') {
    editingTransaction.value = { kind: 'income', income: item.data }
  } else {
    return
  }
  isTransactionSheetOpen.value = true
}
function deleteItem(item: TransactionItem) {
  if (item.kind === 'expense') {
    expensesStore.deleteExpense(item.id)
  } else if (item.kind === 'income') {
    incomesStore.deleteIncome(item.id)
  }
}

// Sección 7.5: tras cerrar el Sheet de gasto/ingreso, se re-derivan
// movimientos + gráfico (el saldo ya se ajustó solo vía adjustBalance). Las
// 3 queries de cada recarga son baratas (acotadas por cuenta y fecha).
function refreshAfterMutation() {
  void loadMovements()
  void loadBalanceEvolution()
}
function onTransactionSheetClose(open: boolean) {
  isTransactionSheetOpen.value = open
  if (!open) refreshAfterMutation()
}
function onAdjustSaved() {
  refreshAfterMutation()
}

// -- Sección 6.3: variación % ----------------------------------------------

const startBalance = computed(() => balanceEvolutionPoints.value[0]?.amount ?? currentBalance.value)
const deltaAmount = computed(() => currentBalance.value - startBalance.value)

const deltaPercentLabel = computed(() => {
  // Caso borde 1: saldo de arranque en $0 → porcentaje indefinido, se muestra
  // solo el monto con signo.
  if (startBalance.value === 0) {
    const sign = deltaAmount.value >= 0 ? '+' : '-'
    return `${sign}$${formatAmount(Math.abs(deltaAmount.value))}`
  }
  const pct = (deltaAmount.value / Math.abs(startBalance.value)) * 100
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
})

const deltaDirection = computed<'up' | 'down'>(() => (deltaAmount.value >= 0 ? 'up' : 'down'))
const deltaTextClass = computed(() => (deltaAmount.value >= 0 ? 'text-success' : 'text-destructive'))

// Sección 6.3, último bullet: con un único punto (cuenta creada hoy, sin
// movimientos) no hay nada para graficar — se oculta la Card del gráfico.
const showChart = computed(() => balanceEvolutionPoints.value.length > 1)
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <AppHeader>
      <template #default>
        <div v-if="account" class="flex min-w-0 flex-1 items-center gap-3">
          <span
            class="flex size-10 shrink-0 items-center justify-center rounded-lg"
            :style="{ backgroundColor: resolveAccountColor(account.color ?? '#6b7280', isDarkNow) }"
          >
            <component
              :is="resolveAccountIcon(account.icon)"
              class="size-5"
              :style="{ color: readableTextColor(resolveAccountColor(account.color ?? '#6b7280', isDarkNow)) }"
            />
          </span>
          <h1 class="truncate text-xl font-semibold">{{ account.name }}</h1>
        </div>
        <h1 v-else class="flex-1 truncate text-xl font-semibold">Cuenta</h1>
      </template>

      <template #actions>
        <Button v-if="account" variant="ghost" size="icon" aria-label="Editar cuenta" @click="openEditSheet">
          <Pencil class="size-5" />
        </Button>
      </template>
    </AppHeader>

    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 pb-28 sm:px-6 lg:px-8">
      <!-- Estado de carga -->
      <template v-if="isInitialLoading">
        <Skeleton class="h-24 w-full rounded-xl" />
        <Skeleton class="h-40 w-full rounded-xl" />
        <Skeleton class="h-64 w-full rounded-xl" />
      </template>

      <!-- Estado de error -->
      <template v-else-if="loadError">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <AlertCircle class="size-12 text-destructive" />
          <h2 class="text-lg font-semibold">
            No pudimos cargar esta cuenta
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

      <template v-else-if="account">
        <!-- Sección 4: HOY + saldo actual + ajuste -->
        <Card>
          <div class="flex flex-col gap-1 px-6 py-5">
            <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Hoy</p>
            <div class="flex items-center gap-2">
              <p
                class="text-3xl font-bold tabular-nums tracking-tight"
                :class="currentBalance < 0 ? 'text-destructive' : 'text-foreground'"
              >
                {{ currentBalance < 0 ? '-' : '' }}${{ formatAmount(Math.abs(currentBalance)) }}
              </p>
              <Button variant="ghost" size="icon" aria-label="Ajustar saldo" @click="isAdjustSheetOpen = true">
                <Pencil class="size-4 text-muted-foreground" />
              </Button>
            </div>
          </div>
        </Card>

        <!-- Sección 6: últimos 30 días -->
        <Card v-if="showChart">
          <CardHeader>
            <div class="flex items-center justify-between gap-2">
              <div class="flex flex-col gap-0.5">
                <CardTitle class="text-base font-semibold">Últimos 30 días</CardTitle>
              </div>
              <div class="flex items-center gap-1" :class="deltaTextClass">
                <component :is="deltaDirection === 'up' ? ArrowUp : ArrowDown" class="size-3.5" />
                <span class="text-sm font-semibold tabular-nums">{{ deltaPercentLabel }}</span>
              </div>
            </div>
          </CardHeader>
          <div class="px-4 pb-6 sm:px-6">
            <TrendAreaChart
              :points="balanceEvolutionPoints"
              :height="80"
              show-axis
              :ariaLabel="`Evolución del saldo de ${account.name}, últimos 30 días`"
            />
          </div>
        </Card>

        <!-- Sección 7: movimientos recientes -->
        <Card>
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Movimientos recientes
            </CardTitle>
          </CardHeader>

          <!-- Sección 8.4: vacío -->
          <p v-if="mergedItems.length === 0" class="px-6 pb-8 pt-2 text-center text-sm text-muted-foreground">
            Todavía no hay movimientos en esta cuenta.
          </p>

          <div v-else class="flex flex-col">
            <template v-for="(item, idx) in mergedItems" :key="`${item.kind}-${item.id}`">
              <Separator v-if="idx > 0" />
              <div class="flex items-center gap-3 px-4 py-3" :class="{ 'opacity-70': itemPending(item) }">
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p class="truncate text-sm font-medium">
                    {{ itemTitle(item) }}
                  </p>
                  <p class="truncate text-xs text-muted-foreground">
                    {{ formatExpenseDateHeading(item.date) }}
                  </p>
                  <div v-if="isTransfer(item) || isTransferCommission(item)" class="mt-0.5">
                    <Badge variant="outline" class="w-fit gap-1">
                      <ArrowRightLeft class="size-3" />
                      {{ isTransfer(item) ? 'Transferencia entre cuentas' : 'Vinculado a una transferencia' }}
                    </Badge>
                  </div>
                </div>

                <p
                  class="shrink-0 text-sm font-semibold tabular-nums"
                  :class="isPositive(item) ? 'text-success' : 'text-destructive'"
                >
                  {{ isPositive(item) ? '+' : '-' }}${{ formatAmount(item.data.amount) }}
                </p>

                <!-- Sección 7.4: solo gasto/ingreso propios tienen menú. Las 2
                     caras de transferencia y el gasto de comisión se
                     editan/borran solo desde /transferencias (account-transfers
                     -ux.md sección 6.3/6.4), así que acá van sin menú. -->
                <DropdownMenu v-if="!isTransfer(item) && !isTransferCommission(item)">
                  <DropdownMenuTrigger as-child>
                    <Button variant="ghost" size="icon" aria-label="Más acciones para este movimiento">
                      <EllipsisVertical class="size-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem @select="openEditItem(item)">
                      <Pencil class="size-4" />
                      Editar
                    </DropdownMenuItem>
                    <AlertDialog>
                      <AlertDialogTrigger as-child>
                        <DropdownMenuItem variant="destructive" @select="(e: Event) => e.preventDefault()">
                          <Trash2 class="size-4" />
                          Eliminar
                        </DropdownMenuItem>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{{ itemDeleteTitle(item) }}</AlertDialogTitle>
                          <AlertDialogDescription>
                            Esta acción no se puede deshacer. Se eliminará "{{ itemTitle(item) }}" permanentemente.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction @click="deleteItem(item)">
                            Eliminar
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </template>

            <!-- Sección 7.3: "Mostrar más" -->
            <template v-if="hasMore">
              <Separator />
              <div class="px-4 py-3">
                <Button variant="outline" class="w-full" :disabled="isLoadingMore" @click="showMore">
                  <Loader2 v-if="isLoadingMore" class="size-4 animate-spin" />
                  {{ isLoadingMore ? 'Cargando…' : 'Mostrar más' }}
                </Button>
              </div>
            </template>
          </div>
        </Card>
      </template>
    </main>

    <!-- Sección 7.5: FAB (gasto/ingreso, no transferencias) -->
    <Button
      v-if="!isInitialLoading && !loadError && account"
      size="icon"
      class="fixed right-4 h-14 w-14 rounded-full shadow-[var(--shadow-elevated)] sm:right-6"
      style="bottom: calc(1.5rem + env(safe-area-inset-bottom))"
      aria-label="Agregar movimiento"
      @click="openAddTransaction"
    >
      <Plus class="size-6" />
    </Button>

    <AccountFormSheet v-model:open="isEditSheetOpen" :account="account ?? null" />
    <AccountBalanceAdjustmentSheet
      v-if="account"
      v-model:open="isAdjustSheetOpen"
      :account="account"
      :current-balance="currentBalance"
      @saved="onAdjustSaved"
    />
    <TransactionFormSheet
      :open="isTransactionSheetOpen"
      :transaction="editingTransaction"
      :preset-account-id="accountId"
      @update:open="onTransactionSheetClose"
    />
  </div>
</template>
