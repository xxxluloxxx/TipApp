<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertCircle,
  ArrowLeft,
  EllipsisVertical,
  Pencil,
  Plus,
  Receipt,
  RotateCcw,
  Trash2,
} from '@lucide/vue'
import { useCategoriesStore } from '@/stores/categories'
import { useExpensesStore, type ExpenseWithCategory } from '@/stores/expenses'
import { formatExpenseDateHeading } from '@/lib/date'
import { formatAmount } from '@/lib/currency'
import { readableTextColor } from '@/lib/colors'
import ExpenseFormSheet from '@/components/ExpenseFormSheet.vue'
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
// Vista de "segundo nivel" (header con ArrowLeft, sin trigger de drawer),
// mismo patrón que CategoriesView.

const router = useRouter()
const route = useRoute()
const expensesStore = useExpensesStore()
const categoriesStore = useCategoriesStore()

const isInitialLoading = ref(true)
const loadError = ref(false)

// Fetch propio de esta vista (sección 3.1): no hay "prefetch" compartido con
// Inicio, cada vista carga sus propios datos igual que ya hace CategoriesView.
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

onMounted(async () => {
  await loadAll()
  // Sección 3.4: soporte de `?new=1` para abrir el Sheet de alta
  // automáticamente al llegar desde el estado vacío de Inicio.
  if (route.query.new === '1') openAddSheet()
})

// FAB / hero solo se muestran una vez resuelta la carga inicial, con datos
// o vacío. En error se oculta también: sin categorías cargadas el Sheet de
// alta quedaría roto.
const showMainActions = computed(() => !isInitialLoading.value && !loadError.value)

// Agrupación visual por encabezado de fecha (sección 3.1). La lista ya llega
// ordenada `expense_date desc, created_at desc` desde el store.
interface ExpenseGroup { heading: string, items: ExpenseWithCategory[] }
const groupedExpenses = computed<ExpenseGroup[]>(() => {
  const groups: ExpenseGroup[] = []
  for (const expense of expensesStore.expenses) {
    const heading = formatExpenseDateHeading(expense.expense_date)
    const last = groups.at(-1)
    if (last && last.heading === heading) {
      last.items.push(expense)
    } else {
      groups.push({ heading, items: [expense] })
    }
  }
  return groups
})

// Estado del Sheet de alta/edición.
const isSheetOpen = ref(false)
const editingExpense = ref<ExpenseWithCategory | null>(null)

function openAddSheet() {
  editingExpense.value = null
  isSheetOpen.value = true
}
function openEditSheet(expense: ExpenseWithCategory) {
  editingExpense.value = expense
  isSheetOpen.value = true
}

function expenseTitle(expense: ExpenseWithCategory): string {
  // Sin descripción, el nombre de la categoría hace de texto principal.
  return expense.description || expense.category.name
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <header class="flex items-center gap-3 border-b border-border px-4 py-4 sm:px-6 lg:px-8">
      <Button variant="ghost" size="icon" aria-label="Volver" @click="router.push({ name: 'home' })">
        <ArrowLeft class="size-5" />
      </Button>
      <h1 class="text-xl font-semibold">
        Transacciones
      </h1>
    </header>

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
          <Button @click="openAddSheet">
            Agregar tu primer gasto
          </Button>
        </div>
      </template>

      <!-- Listado agrupado por fecha -->
      <template v-else>
        <section class="flex flex-col gap-3">
          <template v-for="(group, idx) in groupedExpenses" :key="`${group.heading}-${idx}`">
            <Separator v-if="idx > 0" />
            <span class="text-xs font-medium text-muted-foreground">{{ group.heading }}</span>

            <Card
              v-for="expense in group.items"
              :key="expense.id"
              class="p-4 sm:p-6"
              :class="{ 'opacity-70': expense._pending }"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="flex flex-col gap-1.5">
                  <p class="font-medium">
                    {{ expenseTitle(expense) }}
                  </p>
                  <Badge
                    class="w-fit border-transparent"
                    :style="{
                      backgroundColor: expense.category.color ?? undefined,
                      color: readableTextColor(expense.category.color),
                    }"
                  >
                    {{ expense.category.name }}
                  </Badge>
                </div>

                <div class="flex items-center gap-2">
                  <p class="text-right text-base font-semibold tabular-nums">
                    <span class="text-sm font-normal text-muted-foreground">$</span>{{ formatAmount(expense.amount) }}
                  </p>

                  <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                      <Button variant="ghost" size="icon" aria-label="Más acciones para este gasto">
                        <EllipsisVertical class="size-5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem @select="openEditSheet(expense)">
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
                            <AlertDialogTitle>¿Eliminar este gasto?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Esta acción no se puede deshacer. Se eliminará "{{ expenseTitle(expense) }}" permanentemente.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction @click="expensesStore.deleteExpense(expense.id)">
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
      aria-label="Agregar gasto"
      @click="openAddSheet"
    >
      <Plus class="size-6" />
    </Button>

    <ExpenseFormSheet v-model:open="isSheetOpen" :expense="editingExpense" />
  </div>
</template>
