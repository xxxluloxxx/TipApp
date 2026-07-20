<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import {
  AlertCircle,
  ArrowDownCircle,
  EllipsisVertical,
  Pencil,
  Plus,
  Receipt,
  RotateCcw,
  Trash2,
} from '@lucide/vue'
import { useAccountsStore } from '@/stores/accounts'
import { useCategoriesStore } from '@/stores/categories'
import { useExpensesStore, type ExpenseWithCategory } from '@/stores/expenses'
import { useIncomesStore, type IncomeWithAccount } from '@/stores/incomes'
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
const expensesStore = useExpensesStore()
const incomesStore = useIncomesStore()
const categoriesStore = useCategoriesStore()
const accountsStore = useAccountsStore()

const isDarkNow = computed(() => document.documentElement.classList.contains('dark'))

const isInitialLoading = ref(true)
const loadError = ref(false)

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

type TransactionItem =
  | { kind: 'expense', id: string, date: string, data: ExpenseWithCategory }
  | { kind: 'income', id: string, date: string, data: IncomeWithAccount }

// Sección 7.5: gasto e ingreso conviven en una sola lista, ordenada
// `date desc` (cada store ya trae su propia lista `expense_date`/
// `income_date desc, created_at desc`, así que solo hace falta un merge +
// re-orden por fecha).
const mergedItems = computed<TransactionItem[]>(() => {
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
  return [...expenseItems, ...incomeItems].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    return b.data.created_at.localeCompare(a.data.created_at)
  })
})

const isEmpty = computed(() => mergedItems.value.length === 0)

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
function openEditSheet(item: TransactionItem) {
  editingTransaction.value = item.kind === 'expense'
    ? { kind: 'expense', expense: item.data }
    : { kind: 'income', income: item.data }
  isSheetOpen.value = true
}

function deleteItem(item: TransactionItem) {
  if (item.kind === 'expense') {
    expensesStore.deleteExpense(item.id)
  } else {
    incomesStore.deleteIncome(item.id)
  }
}

// Sección 7.5: título/subtítulo/estilo por tipo de fila.
function itemTitle(item: TransactionItem): string {
  if (item.kind === 'expense') return item.data.description || item.data.category.name
  return item.data.description || 'Ingreso'
}
function itemSubtitle(item: TransactionItem): string {
  return item.kind === 'expense' ? item.data.category.name : item.data.account.name
}
function itemBadgeColor(item: TransactionItem): string | undefined {
  if (item.kind === 'expense') return item.data.category.color ?? undefined
  return resolveAccountColor(item.data.account.color ?? '#6b7280', isDarkNow.value)
}
function itemDeleteTitle(item: TransactionItem): string {
  return item.kind === 'expense' ? '¿Eliminar este gasto?' : '¿Eliminar este ingreso?'
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
              :class="{ 'opacity-70': item.data._pending }"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="flex flex-col gap-1.5">
                  <div class="flex items-center gap-1.5">
                    <ArrowDownCircle v-if="item.kind === 'income'" class="size-4 shrink-0 text-success" />
                    <p class="font-medium">
                      {{ itemTitle(item) }}
                    </p>
                  </div>
                  <Badge
                    class="w-fit border-transparent"
                    :style="{
                      backgroundColor: itemBadgeColor(item),
                      color: readableTextColor(itemBadgeColor(item)),
                    }"
                  >
                    {{ itemSubtitle(item) }}
                  </Badge>
                </div>

                <div class="flex items-center gap-2">
                  <p
                    class="text-right text-base font-semibold tabular-nums"
                    :class="item.kind === 'income' ? 'text-success' : 'text-foreground'"
                  >
                    <span class="text-sm font-normal text-muted-foreground">{{ item.kind === 'income' ? '+$' : '$' }}</span>{{ formatAmount(item.data.amount) }}
                  </p>

                  <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                      <Button variant="ghost" size="icon" aria-label="Más acciones para este movimiento">
                        <EllipsisVertical class="size-5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
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
