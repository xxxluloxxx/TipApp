<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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
  Trash2,
} from '@lucide/vue'
import { useAccountsStore } from '@/stores/accounts'
import { useAccountTransfersStore, MAX_TRANSFERS } from '@/stores/accountTransfers'
import { useCategoriesStore } from '@/stores/categories'
import { useDebtsStore, ACCOUNT_LINKED_MOVEMENTS_LIMIT, type DebtMovementWithDebt } from '@/stores/debts'
import { useDebtPeopleStore } from '@/stores/debtPeople'
import { useExpensesStore, MAX_EXPENSES, type ExpenseWithCategory } from '@/stores/expenses'
import { useIncomesStore, MAX_INCOMES, type IncomeWithAccount } from '@/stores/incomes'
import { buildTransactionItems, computeRunningBalances, type TransactionItem } from '@/lib/transactionItems'
import { movementVerb } from '@/lib/debtDisplay'
import { formatExpenseDateHeading } from '@/lib/date'
import { formatAmount } from '@/lib/currency'
import { readableTextColor, resolveAccountColor } from '@/lib/colors'
import AppHeader from '@/components/AppHeader.vue'
import TransactionFormSheet from '@/components/TransactionFormSheet.vue'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
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

// Sección 3 de dashboard-redesign-ux.md: historial completo de gastos,
// mudado tal cual desde HomeView.vue (antes hacía de "todo" el dashboard).
// Vista de "segundo nivel", usa el AppHeader compartido (botón de menú),
// mismo patrón que CategoriesView.
//
// accounts-income-ux.md sección 7.5: a partir de esta iteración mezcla filas
// de gasto e ingreso (ordenadas por fecha desc, igual que hoy), cada una con
// un indicador de tipo (signo + color, nunca solo color). Se mantiene el
// layout de Card por ítem ya shippeado por dashboard-redesign-ux.md (no se
// migra a la fila plana de icono+texto que usa "Transacciones recientes" de
// Inicio) — desviación menor documentada en el reporte final de esta
// iteración.

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
const loadError = ref(false)

// debts-ux.md sección 13.1: movimientos de deuda con cuenta vinculada (de todos
// los hilos), para mezclarlos como ítem sintético `debt-linked`. Ref local (no
// una lista maestra del store), mismo criterio que `AccountDetailView`.
const debtLinkedMovements = ref<DebtMovementWithDebt[]>([])

// Fetch propio de esta vista (sección 3.1): no hay "prefetch" compartido con
// Inicio, cada vista carga sus propios datos igual que ya hace CategoriesView.
async function loadAll() {
  loadError.value = false
  isInitialLoading.value = true
  try {
    await Promise.all([
      categoriesStore.fetchCategories(),
      accountsStore.fetchAccounts(),
      accountsStore.fetchBalances(),
      expensesStore.fetchAll(),
      incomesStore.fetchAll(),
      // account-transfers-ux.md sección 6.3: para saber qué gastos provienen de
      // una comisión de transferencia y restringir su edición directa acá. Su
      // fallo no bloquea la vista (degradación: sin marca, filas editables).
      accountTransfersStore.fetchAll(),
      // debts-ux.md sección 13.1: personas (para el título de la fila de deuda)
      // + movimientos con cuenta vinculada. Su fallo tampoco bloquea la vista
      // (degradación: sin esas filas / con "Persona" genérica).
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

onMounted(async () => {
  await loadAll()
  // Sección 3.4: soporte de `?new=1` para abrir el Sheet de alta
  // automáticamente al llegar desde el estado vacío de Inicio.
  if (route.query.new === '1') openAddSheet()
})

// FAB / hero solo se muestran una vez resuelta la carga inicial, con datos
// o vacío. En error se oculta también: sin categorías/cuentas cargadas el
// Sheet de alta quedaría roto.
const showMainActions = computed(() => !isInitialLoading.value && !loadError.value)

// Sección 7.5 + account-transfers-ux.md sección 6.4: gasto, ingreso y las 2
// caras sintéticas de cada transferencia conviven en una sola lista ordenada
// `date desc`. El merge/orden vive en `buildTransactionItems` (compartido con
// "Transacciones recientes" de HomeView para que el union de 4 variantes no se
// desincronice entre las dos vistas). Los ítems de transferencia NO tocan
// `expensesStore`/`incomesStore` ni ningún total agregado.
const mergedItems = computed<TransactionItem[]>(() =>
  buildTransactionItems(
    expensesStore.expenses,
    incomesStore.incomes,
    accountTransfersStore.transfers,
    debtLinkedMovements.value,
  ),
)

const isEmpty = computed(() => mergedItems.value.length === 0)

// Pedido del usuario ("saldo con el que queda la cuenta" en cada fila, estilo
// estado de cuenta bancario): saldo por fila vía `computeRunningBalances`
// (siempre parte del saldo actual server-side de cada cuenta, nunca resumido
// en cliente). Solo es confiable si NINGUNO de los 4 fetches que alimentan
// `mergedItems` alcanzó su tope (sin paginación, ver cada store) — si alguno
// lo alcanzó, cualquier ítem más viejo que la fecha de corte de ESE fetch
// podría estar mostrando un saldo parcial disfrazado de exacto (mismo
// criterio que `isMonthSafeToShow` en `charts.ts`). `null` = sin
// restricción, se muestra en todas las filas.
const balanceSafeBoundaryDate = computed<string | null>(() => {
  const cutoffs: string[] = []
  if (expensesStore.expenses.length >= MAX_EXPENSES) {
    const oldest = expensesStore.expenses.at(-1)?.expense_date
    if (oldest) cutoffs.push(oldest)
  }
  if (incomesStore.incomes.length >= MAX_INCOMES) {
    const oldest = incomesStore.incomes.at(-1)?.income_date
    if (oldest) cutoffs.push(oldest)
  }
  if (accountTransfersStore.transfers.length >= MAX_TRANSFERS) {
    const oldest = accountTransfersStore.transfers.at(-1)?.transfer_date
    if (oldest) cutoffs.push(oldest)
  }
  if (debtLinkedMovements.value.length >= ACCOUNT_LINKED_MOVEMENTS_LIMIT) {
    const oldest = debtLinkedMovements.value.at(-1)?.movement_date
    if (oldest) cutoffs.push(oldest)
  }
  return cutoffs.length === 0 ? null : cutoffs.reduce((latest, d) => (d > latest ? d : latest))
})

const runningBalances = computed(() => computeRunningBalances(mergedItems.value, id => accountsStore.balanceFor(id)))

function balanceAfter(item: TransactionItem): number | null {
  if (balanceSafeBoundaryDate.value !== null && item.date <= balanceSafeBoundaryDate.value) return null
  return runningBalances.value.get(`${item.kind}-${item.id}`) ?? null
}

// Agrupación visual por encabezado de fecha (sección 3.1), ahora sobre la
// lista mezclada.
interface TransactionGroup { heading: string, items: TransactionItem[] }
const groupedItems = computed<TransactionGroup[]>(() => {
  const groups: TransactionGroup[] = []
  for (const item of mergedItems.value) {
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
    expensesStore.deleteExpense(item.id)
  } else if (item.kind === 'income') {
    incomesStore.deleteIncome(item.id)
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
// borrar directo desde Transacciones (quedaría desincronizado de su
// transferencia dueña, que maneja el efecto combinado de forma atómica). Se
// deriva del `Set` del store (mismo patrón que `linkedLiveMatchIds`), no de una
// columna `expenses.account_transfer_id` (que no existe).
function isTransferCommission(item: TransactionItem): boolean {
  return item.kind === 'expense' && accountTransfersStore.linkedExpenseIds.has(item.id)
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

    <main class="mx-auto flex max-w-md flex-col gap-6 px-4 py-6 pb-28 sm:px-6 lg:px-8">
      <!-- Estado de carga -->
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

      <!-- Estado vacío -->
      <template v-else-if="isEmpty">
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

      <!-- Listado agrupado por fecha, mezclando gasto/ingreso -->
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
                      {{ itemTitle(item) }}
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
                         omite si `balanceAfter` no puede garantizar el
                         número completo (ver comentario de
                         `balanceSafeBoundaryDate`). -->
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

    <TransactionFormSheet v-model:open="isSheetOpen" :transaction="editingTransaction" />
  </div>
</template>
