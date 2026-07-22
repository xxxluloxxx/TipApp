<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertCircle,
  ArrowDownCircle,
  ArrowRightLeft,
  EllipsisVertical,
  HandCoins,
  Pencil,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  SearchX,
  Trash2,
  X,
} from '@lucide/vue'
import { useAccountsStore } from '@/stores/accounts'
import { useAccountTransfersStore, MAX_TRANSFERS, type AccountTransfer } from '@/stores/accountTransfers'
import { useCategoriesStore } from '@/stores/categories'
import { useDebtsStore, ACCOUNT_LINKED_MOVEMENTS_LIMIT, type DebtMovementWithDebt } from '@/stores/debts'
import { useDebtPeopleStore } from '@/stores/debtPeople'
import { useExpensesStore, MAX_EXPENSES, type ExpenseWithCategory } from '@/stores/expenses'
import { useIncomesStore, MAX_INCOMES, type IncomeWithAccount } from '@/stores/incomes'
import {
  buildAccountTransactionItems,
  buildTransactionItems,
  computeRunningBalances,
  type TransactionItem,
} from '@/lib/transactionItems'
import { movementVerb } from '@/lib/debtDisplay'
import { currentMonthLabel, formatDateOnly, formatExpenseDateHeading, formatTimeShort } from '@/lib/date'
import { formatAmount } from '@/lib/currency'
import { readableTextColor, resolveAccountColor } from '@/lib/colors'
import { normalizeSearchText } from '@/lib/text'
import AppHeader from '@/components/AppHeader.vue'
import TransactionFormSheet from '@/components/TransactionFormSheet.vue'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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

// Sección 3 de dashboard-redesign-ux.md: historial completo de gastos,
// mudado tal cual desde HomeView.vue (antes hacía de "todo" el dashboard).
// Vista de "segundo nivel", usa el AppHeader compartido (botón de menú),
// mismo patrón que CategoriesView.
//
// accounts-income-ux.md sección 7.5: mezcla filas de gasto e ingreso (más las
// caras sintéticas de transferencia y los movimientos de deuda con cuenta),
// cada una con un indicador de tipo (signo + color, nunca solo color).
//
// transactions-filters-ux.md: 4 filtros — Mes/Cuenta (server-side) +
// Tipo/Búsqueda (client-side). A partir de esta iteración la vista trae su
// propio dato acotado (`fetchFiltered` por store, poblando los 4 `ref`s
// locales de abajo) en vez de leer las listas maestras de los stores — esas
// siguen sirviendo a HomeView/AccountDetailView sin cambios.

const ALL_MONTHS = 'all'
const ALL_ACCOUNTS = 'all'
const ALL_TYPES = 'all'

/** Valores del Select de Tipo (sección 3.2); 'transfer' agrupa las 2 caras
 * sintéticas `transfer-out`/`transfer-in`. */
type TypeFilter = 'all' | 'expense' | 'income' | 'transfer' | 'debt-linked'

const route = useRoute()
const router = useRouter()
const expensesStore = useExpensesStore()
const incomesStore = useIncomesStore()
const categoriesStore = useCategoriesStore()
const accountsStore = useAccountsStore()
const accountTransfersStore = useAccountTransfersStore()
const debtsStore = useDebtsStore()
const debtPeopleStore = useDebtPeopleStore()

const isDarkNow = computed(() => document.documentElement.classList.contains('dark'))

const isInitialLoading = ref(true)
// Sección 4: estado intermedio liviano al cambiar Mes/Cuenta (no repite el
// skeleton de carga inicial completo, filtros y FAB siguen interactivos).
const isRefetching = ref(false)
const loadError = ref(false)

// transactions-filters-ux.md sección 3.1/3.5: las 4 listas son `ref`s LOCALES
// de la vista, pobladas por `fetchFiltered` de cada store — NO las listas
// maestras (`expensesStore.expenses`, etc.), que siguen sirviendo a HomeView.
// `debtLinkedMovements` ya era un `ref` local; ahora también lo son las otras 3.
const filteredExpenses = ref<ExpenseWithCategory[]>([])
const filteredIncomes = ref<IncomeWithAccount[]>([])
const filteredTransfers = ref<AccountTransfer[]>([])
const debtLinkedMovements = ref<DebtMovementWithDebt[]>([])

// Sección 5.1: se fija UNA sola vez en la primera carga (siempre con los 4
// filtros en su default, equivalente al fetch sin filtrar) y nunca se
// recalcula — si el usuario no tiene ningún movimiento, ninguna combinación de
// filtros puede hacer aparecer uno. Distingue "vacío porque no hay nada" de
// "vacío porque los filtros no matchean" (sección 5.2).
const hasAnyMovementEver = ref<boolean | null>(null)

interface MonthOption { value: string, label: string, start: Date, end: Date }

// Sección 3.1: últimos 12 meses, matemática de fechas pura (mismo cálculo que
// CardTransactionsView). El ítem "Todos los meses" se renderiza aparte en el
// template (no se mezcla acá, para que `dateRangeForSelectedMonth` no tenga que
// ignorarlo).
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
  month: ALL_MONTHS,
  accountId: ALL_ACCOUNTS,
  type: ALL_TYPES,
  search: '',
})

// Sección 3.1: rango [from, to) del mes elegido; `{}` para "Todos los meses"
// (equivale al fetch global, sin acotar por fecha).
const dateRangeForSelectedMonth = computed<{ from?: string, to?: string }>(() => {
  if (filters.month === ALL_MONTHS) return {}
  const option = monthOptions.value.find(o => o.value === filters.month)
  if (!option) return {}
  return { from: formatDateOnly(option.start), to: formatDateOnly(option.end) }
})

// Sección 3.1: los 4 fetches acotados por Mes/Cuenta, en paralelo. Con los
// filtros en su default (`{}`), cada `fetchFiltered` equivale al fetch global
// de hoy (mismos límites defensivos). Devuelve `false` si alguno falló.
async function loadFilteredTransactions(): Promise<boolean> {
  const range = dateRangeForSelectedMonth.value
  const accountId = filters.accountId !== ALL_ACCOUNTS ? filters.accountId : undefined

  const [expensesRes, incomesRes, transfersRes, debtRes] = await Promise.all([
    expensesStore.fetchFiltered({ ...range, accountId }),
    incomesStore.fetchFiltered({ ...range, accountId }),
    accountTransfersStore.fetchFiltered({ ...range, accountId }),
    debtsStore.fetchFiltered({ ...range, accountId }),
  ])

  if (expensesRes === null || incomesRes === null || transfersRes === null || debtRes === null) {
    return false
  }

  filteredExpenses.value = expensesRes
  filteredIncomes.value = incomesRes
  filteredTransfers.value = transfersRes
  debtLinkedMovements.value = debtRes
  return true
}

// Fetch propio de esta vista (sección 3.1): prerequisitos (categorías/cuentas/
// saldos/personas) + los 4 fetches filtrados, todo en paralelo. Su fallo (en
// personas/transferencias) degrada sin bloquear; solo el fallo de los datos
// filtrados marca `loadError`.
async function loadAll() {
  loadError.value = false
  isInitialLoading.value = true
  try {
    const [, , , , filteredOk] = await Promise.all([
      categoriesStore.fetchCategories(),
      accountsStore.fetchAccounts(),
      accountsStore.fetchBalances(),
      // debts-ux.md sección 13.1: personas para el título de la fila de deuda.
      debtPeopleStore.fetchPeople(),
      loadFilteredTransactions(),
    ])
    if (!filteredOk) {
      loadError.value = true
      return
    }
    // Sección 5.1: fijado una sola vez, siempre con los 4 filtros en default
    // (la barra de filtros está oculta durante `isInitialLoading` y el `watch`
    // de refetch no corre hasta terminar el montaje).
    if (hasAnyMovementEver.value === null) {
      hasAnyMovementEver.value = mergedItems.value.length > 0
    }
  } finally {
    isInitialLoading.value = false
  }
}

onMounted(async () => {
  await loadAll()
  // Sección 3.4: soporte de `?new=1` para abrir el Sheet de alta
  // automáticamente al llegar desde el estado vacío de Inicio.
  if (route.query.new === '1') openAddSheet()
})

// Sección 4: Mes/Cuenta disparan un refetch server-side; Tipo/Búsqueda NO (son
// instantáneos sobre datos ya en memoria). `clearFilters` resetea ambos a la
// vez → Vue agrupa este `watch` en un solo refetch.
watch(() => [filters.month, filters.accountId], async () => {
  if (isInitialLoading.value) return
  isRefetching.value = true
  const ok = await loadFilteredTransactions()
  if (!ok) loadError.value = true
  isRefetching.value = false
})

// FAB / hero solo se muestran una vez resuelta la carga inicial, con datos
// o vacío. En error se oculta también: sin categorías/cuentas cargadas el
// Sheet de alta quedaría roto.
const showMainActions = computed(() => !isInitialLoading.value && !loadError.value)

// Sección 3.5: sobre las 4 listas locales ya acotadas por Mes/Cuenta. Con un
// filtro de Cuenta activo se usa `buildAccountTransactionItems` (evita generar
// las 2 caras sintéticas de una transferencia cuando solo corresponde una,
// según de qué lado participa la cuenta filtrada); sin él, el merge completo.
const mergedItems = computed<TransactionItem[]>(() => {
  if (filters.accountId !== ALL_ACCOUNTS) {
    return buildAccountTransactionItems(
      filteredExpenses.value,
      filteredIncomes.value,
      filteredTransfers.value,
      filters.accountId,
      debtLinkedMovements.value,
    )
  }
  return buildTransactionItems(
    filteredExpenses.value,
    filteredIncomes.value,
    filteredTransfers.value,
    debtLinkedMovements.value,
  )
})

// Sección 3.2/3.3/3.4: Tipo → Búsqueda, encadenados sobre `mergedItems`.
function matchesType(item: TransactionItem, type: string): boolean {
  if (type === 'all') return true
  if (type === 'transfer') return item.kind === 'transfer-out' || item.kind === 'transfer-in'
  return item.kind === type
}
function matchesSearch(item: TransactionItem, query: string): boolean {
  if (!query) return true
  return normalizeSearchText(itemTitle(item)).includes(normalizeSearchText(query))
}
const filteredItems = computed<TransactionItem[]>(() =>
  mergedItems.value
    .filter(item => matchesType(item, filters.type))
    .filter(item => matchesSearch(item, filters.search)),
)

const isEmpty = computed(() => filteredItems.value.length === 0)

// Sección 2.1: indicador "N filtros activos" + botón "Limpiar filtros".
const activeFilterCount = computed(() => {
  let n = 0
  if (filters.month !== ALL_MONTHS) n++
  if (filters.accountId !== ALL_ACCOUNTS) n++
  if (filters.type !== ALL_TYPES) n++
  if (filters.search.trim() !== '') n++
  return n
})
function clearFilters() {
  filters.month = ALL_MONTHS
  filters.accountId = ALL_ACCOUNTS
  filters.type = ALL_TYPES
  filters.search = ''
}

// Sección 6: mes calendario en curso, y "mes pasado específico" = un mes
// concreto que no sea el actual (ni "Todos los meses").
const currentMonthValue = computed(() => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
})
const isPastSpecificMonth = computed(
  () => filters.month !== ALL_MONTHS && filters.month !== currentMonthValue.value,
)

// Saldo por fila (pedido del usuario, estilo estado de cuenta bancario):
// siempre parte del saldo actual server-side de cada cuenta, nunca resumido en
// cliente. Solo confiable si NINGUNO de los 4 fetches alcanzó su tope (sin
// paginación) — si alguno lo alcanzó, cualquier ítem más viejo que su fecha de
// corte podría mostrar un saldo parcial. `null` = sin restricción.
const balanceSafeBoundaryDate = computed<string | null>(() => {
  const cutoffs: string[] = []
  if (filteredExpenses.value.length >= MAX_EXPENSES) {
    const oldest = filteredExpenses.value.at(-1)?.expense_date
    if (oldest) cutoffs.push(oldest)
  }
  if (filteredIncomes.value.length >= MAX_INCOMES) {
    const oldest = filteredIncomes.value.at(-1)?.income_date
    if (oldest) cutoffs.push(oldest)
  }
  if (filteredTransfers.value.length >= MAX_TRANSFERS) {
    const oldest = filteredTransfers.value.at(-1)?.transfer_date
    if (oldest) cutoffs.push(oldest)
  }
  if (debtLinkedMovements.value.length >= ACCOUNT_LINKED_MOVEMENTS_LIMIT) {
    const oldest = debtLinkedMovements.value.at(-1)?.movement_date
    if (oldest) cutoffs.push(oldest)
  }
  return cutoffs.length === 0 ? null : cutoffs.reduce((latest, d) => (d > latest ? d : latest))
})

// Sección 6, nota de implementación: en un mes pasado específico el saldo por
// fila nunca se muestra (el acumulador no revierte los meses posteriores que no
// están en la lista filtrada), así que ni siquiera se calcula.
const runningBalances = computed(() => {
  if (isPastSpecificMonth.value) return new Map<string, number>()
  return computeRunningBalances(mergedItems.value, id => accountsStore.balanceFor(id))
})

// Sección 6: dos chequeos independientes que coexisten — (1) mes pasado
// específico (problema estructural del acumulador), evaluado primero; (2) el
// límite de fetch ya existente (`balanceSafeBoundaryDate`).
function balanceAfter(item: TransactionItem): number | null {
  if (isPastSpecificMonth.value) return null
  if (balanceSafeBoundaryDate.value !== null && item.date <= balanceSafeBoundaryDate.value) return null
  return runningBalances.value.get(`${item.kind}-${item.id}`) ?? null
}

// Agrupación visual por encabezado de fecha (sección 3.1), ahora sobre la
// lista YA filtrada por Tipo/Búsqueda (sección 3.4).
interface TransactionGroup { heading: string, items: TransactionItem[] }
const groupedItems = computed<TransactionGroup[]>(() => {
  const groups: TransactionGroup[] = []
  for (const item of filteredItems.value) {
    const heading = formatExpenseDateHeading(item.date)
    const last = groups.at(-1)
    if (last && last.heading === heading) {
      last.items.push(item)
    } else {
      groups.push({ heading, items: [item] })
    }
  }
  return groups
})

// Estado del Sheet de alta/edición.
const isSheetOpen = ref(false)
const editingTransaction = ref<
  { kind: 'expense', expense: ExpenseWithCategory } | { kind: 'income', income: IncomeWithAccount } | null
>(null)

// transactions-filters-ux.md sección 3.5: los `ref`s locales que el Sheet y
// los borrados deben sincronizar de forma optimista (esta vista ya no lee las
// listas maestras del store). Definidos como arrays estables (no inline en el
// template, que auto-desenvolvería el `ref`), mismo criterio que
// `CardTransactionsView.transactionsSyncTargets`.
const expenseSyncTargets = [filteredExpenses]
const incomeSyncTargets = [filteredIncomes]

function openAddSheet() {
  editingTransaction.value = null
  isSheetOpen.value = true
}
// Solo se invoca sobre filas reales de gasto/ingreso (los ítems de
// transferencia no ofrecen "Editar" en su menú, sección 6.4.5).
function openEditSheet(item: TransactionItem) {
  if (item.kind === 'expense') {
    editingTransaction.value = { kind: 'expense', expense: item.data }
  } else if (item.kind === 'income') {
    editingTransaction.value = { kind: 'income', income: item.data }
  } else {
    return
  }
  isSheetOpen.value = true
}

function deleteItem(item: TransactionItem) {
  if (item.kind === 'expense') {
    expensesStore.deleteExpense(item.id, expenseSyncTargets)
  } else if (item.kind === 'income') {
    incomesStore.deleteIncome(item.id, incomeSyncTargets)
  }
}

// account-transfers-ux.md sección 6.4: un ítem sintético de transferencia
// (`transfer-out`/`transfer-in`) no es un recurso propio.
function isTransfer(item: TransactionItem): boolean {
  return item.kind === 'transfer-out' || item.kind === 'transfer-in'
}
// Filas con monto en verde y signo `+`: ingreso real, la cara de entrada de
// una transferencia (sección 6.4.2) y un movimiento de deuda que SUMÓ saldo al
// hilo (debts-ux.md sección 13.4, `amount > 0`). El resto (gasto real —sección
// 6.6—, la cara de salida y un movimiento de deuda negativo) va en
// `text-destructive`.
function isPositive(item: TransactionItem): boolean {
  return item.kind === 'income'
    || item.kind === 'transfer-in'
    || (item.kind === 'debt-linked' && item.data.amount > 0)
}
// El fondo `opacity-70` de "guardando…" solo aplica a gasto/ingreso optimistas
// (`_pending`); una transferencia no es optimista y su `data` no lo modela.
function itemPending(item: TransactionItem): boolean {
  return (item.kind === 'expense' || item.kind === 'income') && !!item.data._pending
}

function accountName(id: string): string {
  return accountsStore.accountById(id)?.name ?? 'Cuenta'
}
function accountColor(id: string): string {
  return accountsStore.accountById(id)?.color ?? '#6b7280'
}
// debts-ux.md sección 13.3: nombre de la contraparte, resuelto contra
// `debtPeopleStore` por `movement.debt.person_id` (mismo store/mecanismo que
// `DebtSummary.personName`, no se duplica el lookup).
function personName(movement: DebtMovementWithDebt): string {
  return debtPeopleStore.personById(movement.debt.person_id)?.name ?? 'Persona'
}

// Sección 7.5 + 6.4.1 + 13.3: título por tipo de fila. El título de una
// transferencia nombra "la otra punta" (destino para la salida, origen para la
// entrada), no la cuenta de su propio badge. El de una deuda reusa el verbo
// del movimiento + la persona, separados por guión largo.
function itemTitle(item: TransactionItem): string {
  switch (item.kind) {
    case 'expense': return item.data.description || item.data.category.name
    case 'income': return item.data.description || 'Ingreso'
    case 'transfer-out': return `Transferencia a ${accountName(item.data.to_account_id)}`
    case 'transfer-in': return `Transferencia desde ${accountName(item.data.from_account_id)}`
    case 'debt-linked': return `${movementVerb(item.data)} — ${personName(item.data)}`
  }
}
// Badge sólido (clasificador primario de la fila, sección 6.4.3/6.5): categoría
// en un gasto, cuenta en un ingreso, y la cuenta de la propia cara de la
// transferencia (origen en la salida, destino en la entrada).
// El `!` en `debt-linked` es seguro: un ítem `debt-linked` solo se genera para
// movimientos con `account_id` no nulo (sección 13.2), aunque el tipo de la
// columna lo declare nullable.
function primaryBadgeText(item: TransactionItem): string {
  switch (item.kind) {
    case 'expense': return item.data.category.name
    case 'income': return item.data.account.name
    case 'transfer-out': return accountName(item.data.from_account_id)
    case 'transfer-in': return accountName(item.data.to_account_id)
    case 'debt-linked': return accountName(item.data.account_id!)
  }
}
function primaryBadgeColor(item: TransactionItem): string | undefined {
  switch (item.kind) {
    case 'expense': return item.data.category.color ?? undefined
    case 'income': return resolveAccountColor(item.data.account.color ?? '#6b7280', isDarkNow.value)
    case 'transfer-out': return resolveAccountColor(accountColor(item.data.from_account_id), isDarkNow.value)
    case 'transfer-in': return resolveAccountColor(accountColor(item.data.to_account_id), isDarkNow.value)
    case 'debt-linked': return resolveAccountColor(accountColor(item.data.account_id!), isDarkNow.value)
  }
}
function itemDeleteTitle(item: TransactionItem): string {
  return item.kind === 'income' ? '¿Eliminar este ingreso?' : '¿Eliminar este gasto?'
}

// account-transfers-ux.md sección 6.3: un gasto generado por la comisión de
// una transferencia se muestra acá (es un gasto real), pero NO se puede editar/
// borrar directo desde Transacciones. Se deriva localmente de `filteredTransfers`
// (no del getter `accountTransfersStore.linkedExpenseIds`, que lee la lista
// maestra del store que esta vista ya no puebla): con los filtros en default
// equivale exactamente a ese getter; con un filtro activo, el gasto de comisión
// y su transferencia caen bajo el mismo filtro (misma fecha, misma cuenta
// origen), así que el marcado sigue siendo consistente.
const linkedExpenseIds = computed(
  () => new Set(
    filteredTransfers.value
      .map(transfer => transfer.expense_id)
      .filter((id): id is string => !!id),
  ),
)
function isTransferCommission(item: TransactionItem): boolean {
  return item.kind === 'expense' && linkedExpenseIds.value.has(item.id)
}

function goToTransfers() {
  router.push({ name: 'account-transfers' })
}

// debts-ux.md sección 13.6: la única acción de una fila `debt-linked` — navega
// al hilo dueño (ruta de detalle puntual, no un listado genérico). Nunca
// Editar/Eliminar desde acá (eso vive en /deudas/:id).
function goToDebt(debtId: string) {
  router.push({ name: 'debt-detail', params: { id: debtId } })
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <AppHeader title="Transacciones" />

    <!-- Sección 2: filtros (Mes/Cuenta/Tipo en fila scrolleable + Búsqueda de
         ancho completo + indicador/limpiar). Se ocultan durante la carga
         inicial y el error (sin datos que filtrar). -->
    <div
      v-if="!isInitialLoading && !loadError"
      class="mx-auto flex max-w-md flex-col gap-2 px-4 py-3 sm:px-6 lg:px-8"
    >
      <div class="flex gap-2 overflow-x-auto">
        <Select v-model="filters.month">
          <SelectTrigger class="h-11 w-auto min-w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem :value="ALL_MONTHS">
              Todos los meses
            </SelectItem>
            <SelectItem v-for="option in monthOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </SelectItem>
          </SelectContent>
        </Select>

        <Select v-model="filters.accountId">
          <SelectTrigger class="h-11 w-auto min-w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem :value="ALL_ACCOUNTS">
              Todas las cuentas
            </SelectItem>
            <SelectItem v-for="account in accountsStore.accounts" :key="account.id" :value="account.id">
              {{ account.name }}
            </SelectItem>
          </SelectContent>
        </Select>

        <Select v-model="filters.type">
          <SelectTrigger class="h-11 w-auto min-w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem :value="ALL_TYPES">
              Todos los tipos
            </SelectItem>
            <SelectItem value="expense">
              Gastos
            </SelectItem>
            <SelectItem value="income">
              Ingresos
            </SelectItem>
            <SelectItem value="transfer">
              Transferencias
            </SelectItem>
            <SelectItem value="debt-linked">
              Deuda vinculada
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <!-- Búsqueda, ancho completo -->
      <div class="relative">
        <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          v-model="filters.search"
          type="text"
          inputmode="search"
          placeholder="Buscar por descripción, categoría, cuenta o persona…"
          class="h-11 pl-9"
          :class="{ 'pr-9': filters.search }"
        />
        <button
          v-if="filters.search"
          type="button"
          class="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Borrar búsqueda"
          @click="filters.search = ''"
        >
          <X class="size-4" />
        </button>
      </div>

      <!-- Indicador + limpiar (solo si hay al menos un filtro activo) -->
      <div v-if="activeFilterCount > 0" class="flex items-center justify-between">
        <span class="text-xs text-muted-foreground">
          {{ activeFilterCount }} filtro{{ activeFilterCount === 1 ? '' : 's' }} activo{{ activeFilterCount === 1 ? '' : 's' }}
        </span>
        <button
          type="button"
          class="rounded-sm text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @click="clearFilters"
        >
          Limpiar filtros
        </button>
      </div>
    </div>

    <main class="mx-auto flex max-w-md flex-col gap-6 px-4 py-6 pb-28 sm:px-6 lg:px-8">
      <!-- Estado de carga inicial -->
      <template v-if="isInitialLoading">
        <div class="flex flex-col gap-3">
          <Card v-for="i in 4" :key="i" class="p-4 sm:p-6">
            <div class="flex items-center justify-between gap-3">
              <div class="flex flex-col gap-2">
                <Skeleton class="h-4 w-32" />
                <Skeleton class="h-5 w-20 rounded-full" />
              </div>
              <Skeleton class="h-5 w-16" />
            </div>
          </Card>
        </div>
      </template>

      <!-- Estado de error -->
      <template v-else-if="loadError">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <AlertCircle class="size-12 text-destructive" />
          <h2 class="text-lg font-semibold">
            No pudimos cargar tus movimientos
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

      <!-- Sección 4: recargando por cambio de Mes/Cuenta (3 cards, más liviano
           que el skeleton inicial de 4) -->
      <template v-else-if="isRefetching">
        <div class="flex flex-col gap-3">
          <Card v-for="i in 3" :key="i" class="p-4 sm:p-6">
            <div class="flex items-center justify-between gap-3">
              <div class="flex flex-col gap-2">
                <Skeleton class="h-4 w-32" />
                <Skeleton class="h-5 w-20 rounded-full" />
              </div>
              <Skeleton class="h-5 w-16" />
            </div>
          </Card>
        </div>
      </template>

      <!-- Sección 5.1: sin ningún movimiento registrado -->
      <template v-else-if="isEmpty && hasAnyMovementEver === false">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <Receipt class="size-12 text-muted-foreground" />
          <h2 class="text-lg font-semibold">
            Todavía no registraste ningún movimiento
          </h2>
          <p class="max-w-xs text-center text-sm text-muted-foreground">
            Empezá a registrar tus gastos e ingresos para ver acá tu historial.
          </p>
          <Button @click="openAddSheet">
            Agregar tu primer movimiento
          </Button>
        </div>
      </template>

      <!-- Sección 5.2: hay datos, pero la combinación de filtros no matchea -->
      <template v-else-if="isEmpty">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <SearchX class="size-12 text-muted-foreground" />
          <h2 class="text-lg font-semibold">
            Ningún movimiento coincide con estos filtros
          </h2>
          <p class="max-w-xs text-center text-sm text-muted-foreground">
            Probá con otra combinación o limpiá los filtros para ver todo de nuevo.
          </p>
          <Button variant="outline" @click="clearFilters">
            Limpiar filtros
          </Button>
        </div>
      </template>

      <!-- Listado agrupado por fecha, mezclando gasto/ingreso/transferencia/deuda -->
      <template v-else>
        <section class="flex flex-col gap-3">
          <template v-for="(group, idx) in groupedItems" :key="`${group.heading}-${idx}`">
            <Separator v-if="idx > 0" />
            <span class="text-xs font-medium text-muted-foreground">{{ group.heading }}</span>

            <Card
              v-for="item in group.items"
              :key="`${item.kind}-${item.id}`"
              class="p-4 sm:p-6"
              :class="[
                itemPending(item) ? 'opacity-70' : '',
                isPositive(item) ? 'bg-success/5 dark:bg-success/10' : 'bg-destructive/5 dark:bg-destructive/10',
              ]"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="flex min-w-0 flex-col gap-1.5">
                  <div class="flex items-center gap-1.5">
                    <ArrowDownCircle v-if="isPositive(item)" class="size-4 shrink-0 text-success" />
                    <p class="font-medium">
                      {{ itemTitle(item) }}<!-- transaction-time-ux.md sección 6: hora junto al título, solo si la fila la tiene (solo expense/income). -->
                      <span v-if="item.time" class="text-xs font-normal text-muted-foreground">· {{ formatTimeShort(item.time) }}</span>
                    </p>
                  </div>
                  <div class="flex flex-wrap items-center gap-1.5">
                    <!-- Badge sólido: clasificador primario de la fila (6.4.3/6.5). -->
                    <Badge
                      class="w-fit border-transparent"
                      :style="{
                        backgroundColor: primaryBadgeColor(item),
                        color: readableTextColor(primaryBadgeColor(item)),
                      }"
                    >
                      {{ primaryBadgeText(item) }}
                    </Badge>
                    <!-- Sección 6.5: cuenta de un gasto real como marcador
                         secundario (outline + punto de color), nunca sólido. -->
                    <Badge v-if="item.kind === 'expense'" variant="outline" class="w-fit gap-1.5">
                      <span
                        class="size-2 shrink-0 rounded-full"
                        :style="{ backgroundColor: resolveAccountColor(accountColor(item.data.account_id), isDarkNow) }"
                      />
                      {{ accountName(item.data.account_id) }}
                    </Badge>
                    <!-- Sección 6.4.4: marca de ítem sintético de transferencia. -->
                    <Badge v-if="isTransfer(item)" variant="outline" class="w-fit gap-1">
                      <ArrowRightLeft class="size-3" />
                      Transferencia entre cuentas
                    </Badge>
                    <!-- Sección 6.3: gasto real que proviene de una comisión. -->
                    <Badge v-if="isTransferCommission(item)" variant="outline" class="w-fit gap-1">
                      <ArrowRightLeft class="size-3" />
                      Vinculado a una transferencia
                    </Badge>
                    <!-- debts-ux.md sección 13.5: marcador secundario de un
                         movimiento de deuda con cuenta vinculada (el badge
                         sólido de arriba ya clasifica la cuenta). -->
                    <Badge v-if="item.kind === 'debt-linked'" variant="outline" class="w-fit gap-1">
                      <HandCoins class="size-3" />
                      Vinculado a una deuda
                    </Badge>
                  </div>
                </div>

                <div class="flex items-center gap-2">
                  <div class="flex flex-col items-end gap-0.5">
                    <p
                      class="text-right text-base font-semibold tabular-nums"
                      :class="isPositive(item) ? 'text-success' : 'text-destructive'"
                    >
                      <span class="text-sm font-normal text-muted-foreground">{{ isPositive(item) ? '+$' : '$' }}</span>{{ formatAmount(Math.abs(item.data.amount)) }}
                    </p>
                    <!-- Saldo de la cuenta después de este movimiento (pedido
                         del usuario, estilo estado de cuenta bancario). Se
                         omite si `balanceAfter` devuelve `null` (mes pasado
                         específico —sección 6— o ítem más viejo que el límite
                         seguro del fetch). -->
                    <p
                      v-if="balanceAfter(item) !== null"
                      class="text-right text-xs tabular-nums"
                      :class="balanceAfter(item)! < 0 ? 'text-destructive' : 'text-success'"
                    >
                      ({{ balanceAfter(item)! < 0 ? '-' : '' }}${{ formatAmount(Math.abs(balanceAfter(item)!)) }})
                    </p>
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                      <Button variant="ghost" size="icon" aria-label="Más acciones para este movimiento">
                        <EllipsisVertical class="size-5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <!-- Ítem sintético de transferencia (6.4.5) o gasto de
                           comisión (6.3): no se edita/borra desde acá, sólo se
                           navega a la transferencia dueña. -->
                      <template v-if="isTransfer(item) || isTransferCommission(item)">
                        <DropdownMenuItem @select="goToTransfers">
                          <ArrowRightLeft class="size-4" />
                          Ver transferencia
                        </DropdownMenuItem>
                      </template>
                      <!-- debts-ux.md sección 13.6: fila de deuda con cuenta
                           vinculada — única acción "Ver deuda" hacia su hilo,
                           nunca Editar/Eliminar (eso vive en /deudas/:id). -->
                      <template v-else-if="item.kind === 'debt-linked'">
                        <DropdownMenuItem @select="goToDebt(item.data.debt_id)">
                          <HandCoins class="size-4" />
                          Ver deuda
                        </DropdownMenuItem>
                      </template>
                      <template v-else>
                        <DropdownMenuItem @select="openEditSheet(item)">
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
                      </template>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </Card>
          </template>
        </section>
      </template>
    </main>

    <Button
      v-if="showMainActions"
      size="icon"
      class="fixed right-4 h-14 w-14 rounded-full shadow-[var(--shadow-elevated)] sm:right-6"
      style="bottom: calc(1.5rem + env(safe-area-inset-bottom))"
      aria-label="Agregar movimiento"
      @click="openAddSheet"
    >
      <Plus class="size-6" />
    </Button>

    <TransactionFormSheet
      v-model:open="isSheetOpen"
      :transaction="editingTransaction"
      :expense-sync-targets="expenseSyncTargets"
      :income-sync-targets="incomeSyncTargets"
    />
  </div>
</template>
