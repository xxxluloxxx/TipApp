<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertCircle,
  EllipsisVertical,
  Home,
  LogOut,
  Menu,
  Pencil,
  Plus,
  Receipt,
  RotateCcw,
  Tag,
  Trash2,
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import { useAuthStore } from '@/stores/auth'
import { useCategoriesStore } from '@/stores/categories'
import { useExpensesStore, type ExpenseWithCategory } from '@/stores/expenses'
import { currentMonthLabel, formatExpenseDateHeading } from '@/lib/date'
import { formatAmount } from '@/lib/currency'
import { readableTextColor } from '@/lib/colors'
import ExpenseFormSheet from '@/components/ExpenseFormSheet.vue'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetFooter, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
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

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const expensesStore = useExpensesStore()
const categoriesStore = useCategoriesStore()

const isInitialLoading = ref(true)
const loadError = ref(false)

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

// FAB / hero solo se muestran una vez resuelta la carga inicial, con datos
// o vacío (sección 2.5). En error, se oculta también: sin categorías
// cargadas el Sheet de alta quedaría roto.
const showMainActions = computed(() => !isInitialLoading.value && !loadError.value)

// Agrupación visual por encabezado de fecha (sección 2.3). La lista ya
// llega ordenada `expense_date desc, created_at desc` desde el store.
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

const accountLabel = computed(() => authStore.profile?.display_name || authStore.user?.email || '')
const showEmailSecondary = computed(() => !!authStore.profile?.display_name)
const avatarInitial = computed(() => accountLabel.value.charAt(0).toUpperCase() || '?')

async function onLogout() {
  await authStore.signOut()
  await router.push('/login')
  toast('Sesión cerrada')
}

// Drawer de navegación principal (reemplaza el DropdownMenu de cuenta).
const isDrawerOpen = ref(false)
const isHomeActive = computed(() => route.name === 'home')
const isCategoriesActive = computed(() => route.name === 'categories')

function navigateFromDrawer(name: 'home' | 'categories') {
  isDrawerOpen.value = false
  if (route.name !== name) {
    router.push({ name })
  }
}

function logoutFromDrawer() {
  isDrawerOpen.value = false
  onLogout()
}

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
  // Sección 2.3.1: sin descripción, el nombre de la categoría hace de
  // texto principal.
  return expense.description || expense.category.name
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
              :class="isHomeActive ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'"
              :aria-current="isHomeActive ? 'page' : undefined"
              @click="navigateFromDrawer('home')"
            >
              <Home class="size-5 shrink-0" />
              Inicio
            </button>
            <button
              type="button"
              class="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :class="isCategoriesActive ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'"
              :aria-current="isCategoriesActive ? 'page' : undefined"
              @click="navigateFromDrawer('categories')"
            >
              <Tag class="size-5 shrink-0" />
              Categorías
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

    <main class="mx-auto flex max-w-md flex-col gap-6 px-4 py-6 pb-28 sm:px-6 lg:px-8">
      <!-- Estado de carga (sección 2.5) -->
      <template v-if="isInitialLoading">
        <Card>
          <CardHeader>
            <Skeleton class="h-4 w-32" />
            <Skeleton class="mt-2 h-9 w-40" />
          </CardHeader>
        </Card>

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

      <!-- Estado de error (sección 2.6) -->
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

      <!-- Estado vacío (sección 2.4) -->
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

      <!-- Hero + listado (sección 2.2 / 2.3) -->
      <template v-else>
        <Card>
          <CardHeader>
            <CardDescription>Total de {{ monthLabel }}</CardDescription>
            <CardTitle class="text-3xl font-bold tabular-nums tracking-tight sm:text-4xl">
              <span class="align-top text-sm font-normal text-muted-foreground">$</span>{{ formatAmount(expensesStore.monthTotal) }}
            </CardTitle>
          </CardHeader>
        </Card>

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
