<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertCircle,
  ArrowLeft,
  CreditCard as CreditCardIcon,
  EllipsisVertical,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from '@lucide/vue'
import { currentMonthLabel, formatDateOnly } from '@/lib/date'
import { formatAmount } from '@/lib/currency'
import { readableTextColor, withAlpha } from '@/lib/colors'
import { useCreditCardsStore, type CreditCard } from '@/stores/creditCards'
import { useCardPeopleStore } from '@/stores/cardPeople'
import { useCardExpensesStore, type CardExpenseWithRelations } from '@/stores/cardExpenses'
import CardExpenseFormSheet from '@/components/CardExpenseFormSheet.vue'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
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

// Sección 3 de credit-cards-ux.md: transacciones de tarjeta filtradas por
// mes (obligatorio)/tarjeta/persona, agrupadas por tarjeta.

const ALL_CARDS = 'all'
const ALL_PEOPLE = 'all'
const NO_PERSON = 'none'

const router = useRouter()
const route = useRoute()
const creditCardsStore = useCreditCardsStore()
const cardPeopleStore = useCardPeopleStore()
const cardExpensesStore = useCardExpensesStore()

const isInitialLoading = ref(true)
const isLoadingTransactions = ref(false)
const loadError = ref(false)

const transactions = ref<CardExpenseWithRelations[]>([])

interface MonthOption { value: string, label: string, start: Date, end: Date }

// Sección 1.5/3.1: los últimos 12 meses generados con matemática de fechas
// pura, sin depender de ningún dato ya cargado.
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
  cardId: ALL_CARDS,
  personId: ALL_PEOPLE,
})

const selectedMonth = computed(() => monthOptions.value.find(o => o.value === filters.month) ?? monthOptions.value[0]!)

async function loadTransactions() {
  isLoadingTransactions.value = true
  loadError.value = false
  try {
    const result = await cardExpensesStore.fetchByDateRange({
      from: formatDateOnly(selectedMonth.value.start),
      to: formatDateOnly(selectedMonth.value.end),
      cardId: filters.cardId !== ALL_CARDS ? filters.cardId : undefined,
      personId: filters.personId === NO_PERSON ? 'none' : (filters.personId !== ALL_PEOPLE ? filters.personId : undefined),
    })
    if (result === null) {
      loadError.value = true
      return
    }
    transactions.value = result
  } finally {
    isLoadingTransactions.value = false
  }
}

onMounted(async () => {
  isInitialLoading.value = true
  try {
    const [cardsOk, peopleOk] = await Promise.all([
      creditCardsStore.fetchCards(),
      cardPeopleStore.fetchPeople(),
    ])

    if (!cardsOk || !peopleOk) {
      loadError.value = true
      return
    }

    // Sección 3.4: sin ninguna tarjeta creada no hay nada que filtrar.
    if (creditCardsStore.cards.length === 0) {
      router.replace({ name: 'manage-cards' })
      return
    }

    // Sección 4.3: preselección de tarjeta vía `?cardId=` (viene de "Ver
    // todos" del detalle de tarjeta).
    const presetCardId = typeof route.query.cardId === 'string' ? route.query.cardId : null
    if (presetCardId && creditCardsStore.cardById(presetCardId)) {
      filters.cardId = presetCardId
    }

    await loadTransactions()
  } finally {
    isInitialLoading.value = false
  }
})

watch(() => [filters.month, filters.cardId, filters.personId], () => {
  if (!isInitialLoading.value) void loadTransactions()
})

// Sección 3.2: todas las tarjetas del usuario aparecen como grupo (salvo
// filtro fijado a una específica), ordenadas por total desc.
const groupedByCard = computed(() => {
  const cardsToShow: CreditCard[] = filters.cardId !== ALL_CARDS
    ? creditCardsStore.cards.filter(c => c.id === filters.cardId)
    : creditCardsStore.cards

  const byCard = new Map<string, CardExpenseWithRelations[]>()
  for (const expense of transactions.value) {
    const list = byCard.get(expense.card_id) ?? []
    list.push(expense)
    byCard.set(expense.card_id, list)
  }

  return cardsToShow
    .map((card) => {
      const expenses = byCard.get(card.id) ?? []
      return { card, expenses, total: expenses.reduce((sum, e) => sum + e.amount, 0) }
    })
    .sort((a, b) => b.total - a.total)
})

const grandTotal = computed(() => transactions.value.reduce((sum, e) => sum + e.amount, 0))

function expenseTitle(expense: CardExpenseWithRelations, cardName: string): string {
  return expense.description || cardName
}

// Estado del Sheet de alta/edición.
const isSheetOpen = ref(false)
const editingExpense = ref<CardExpenseWithRelations | null>(null)
const presetCardId = computed(() => (filters.cardId !== ALL_CARDS ? filters.cardId : null))
const presetPersonId = computed(() => (filters.personId !== ALL_PEOPLE && filters.personId !== NO_PERSON ? filters.personId : null))

function openAddSheet() {
  editingExpense.value = null
  isSheetOpen.value = true
}
function openEditSheet(expense: CardExpenseWithRelations) {
  editingExpense.value = expense
  isSheetOpen.value = true
}

const showFab = computed(() => !isInitialLoading.value && !loadError.value)

// Definido acá (no inline en el template) a propósito: un `ref` referenciado
// por su nombre dentro de una expresión de template se auto-desenvuelve
// (`transactions` -> `transactions.value`), así que `[transactions]` en el
// template arma un array con el *valor* desenvuelto, no con el `ref` en sí
// — y `cardExpensesStore` necesita el `ref` real para mutarlo in place
// (sección 1 de credit-cards-ux.md). Este array sí conserva la referencia.
const transactionsSyncTargets = [transactions]
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <header class="flex items-center gap-3 border-b border-border px-4 py-4 sm:px-6 lg:px-8">
      <Button variant="ghost" size="icon" aria-label="Volver" @click="router.push({ name: 'cards' })">
        <ArrowLeft class="size-5" />
      </Button>
      <h1 class="text-xl font-semibold">
        Transacciones de tarjetas
      </h1>
    </header>

    <!-- Sección 3.1: filtros -->
    <div v-if="!isInitialLoading && !loadError" class="flex gap-2 overflow-x-auto px-4 py-3 sm:px-6 lg:px-8">
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

      <Select v-model="filters.cardId">
        <SelectTrigger class="h-11 w-auto min-w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem :value="ALL_CARDS">
            Todas las tarjetas
          </SelectItem>
          <SelectItem v-for="card in creditCardsStore.cards" :key="card.id" :value="card.id">
            {{ card.name }}
          </SelectItem>
        </SelectContent>
      </Select>

      <Select v-model="filters.personId">
        <SelectTrigger class="h-11 w-auto min-w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem :value="ALL_PEOPLE">
            Todas las personas
          </SelectItem>
          <SelectItem v-for="person in cardPeopleStore.people" :key="person.id" :value="person.id">
            {{ person.name }}
          </SelectItem>
          <SelectItem :value="NO_PERSON">
            Sin persona asignada
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <main class="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-2 pb-28 sm:px-6 lg:px-8">
      <!-- Estado de carga inicial -->
      <template v-if="isInitialLoading">
        <Card v-for="i in 3" :key="i">
          <CardHeader>
            <Skeleton class="h-4 w-40" />
          </CardHeader>
          <div class="flex flex-col gap-2 px-6 pb-4">
            <Skeleton class="h-4 w-full" />
            <Skeleton class="h-4 w-full" />
          </div>
        </Card>
      </template>

      <!-- Estado de error -->
      <template v-else-if="loadError">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <AlertCircle class="size-12 text-destructive" />
          <h2 class="text-lg font-semibold">
            No pudimos cargar las transacciones
          </h2>
          <p class="text-sm text-muted-foreground">
            Revisá tu conexión e intentá de nuevo.
          </p>
          <Button variant="outline" @click="loadTransactions">
            <RotateCcw class="size-4" />
            Reintentar
          </Button>
        </div>
      </template>

      <!-- Recargando por cambio de filtros -->
      <template v-else-if="isLoadingTransactions">
        <Card v-for="i in 2" :key="i">
          <CardHeader>
            <Skeleton class="h-4 w-40" />
          </CardHeader>
          <div class="flex flex-col gap-2 px-6 pb-4">
            <Skeleton class="h-4 w-full" />
          </div>
        </Card>
      </template>

      <template v-else>
        <!-- Sección 3.2: agrupado por tarjeta — header de grupo con fondo
        neutro (igual que el resto de la card); el color propio de la
        tarjeta vive solo en el chip cuadrado a la izquierda del nombre,
        mismo tratamiento que la lista "Tus tarjetas" del dashboard y "Mis
        cuentas" de Inicio/AccountsView.vue (icon-color-chip-ux.md). Cada
        fila sigue con la persona en negrita primero, luego descripción,
        badge de cuota y monto. -->
        <Card v-for="group in groupedByCard" :key="group.card.id" class="overflow-hidden py-0">
          <div
            class="flex items-center gap-2 border-b border-border px-4 py-3"
            :style="{ backgroundColor: withAlpha(group.card.color, 0.16) }"
          >
            <span
              class="flex size-8 shrink-0 items-center justify-center rounded-lg"
              :style="{ backgroundColor: group.card.color ?? 'hsl(var(--muted))' }"
            >
              <CreditCardIcon class="size-4" :style="{ color: readableTextColor(group.card.color) }" />
            </span>
            <span class="flex-1 truncate text-sm font-semibold">
              {{ group.card.name }} (•••• {{ group.card.last_four_digits }})
            </span>
            <span class="text-sm font-semibold tabular-nums">${{ formatAmount(group.total) }}</span>
          </div>

          <p v-if="group.expenses.length === 0" class="px-6 py-4 text-sm text-muted-foreground">
            Sin transacciones
          </p>
          <div v-else class="flex flex-col">
            <template v-for="(expense, idx) in group.expenses" :key="expense.id">
              <Separator v-if="idx > 0" />
              <div class="flex items-center gap-3 px-4 py-3" :class="{ 'opacity-70': expense._pending }">
                <span class="w-16 shrink-0 truncate text-sm font-semibold">
                  {{ expense.person?.name ?? 'Sin persona' }}
                </span>
                <span class="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                  {{ expenseTitle(expense, group.card.name) }}
                </span>
                <span
                  v-if="expense.installment_total"
                  class="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary tabular-nums"
                >
                  {{ expense.installment_number }}/{{ expense.installment_total }}
                </span>
                <span class="shrink-0 text-sm font-semibold tabular-nums">
                  ${{ formatAmount(expense.amount) }}
                </span>

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
                            Esta acción no se puede deshacer.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction @click="cardExpensesStore.deleteExpense(expense.id, transactionsSyncTargets)">
                            Eliminar
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </template>
          </div>
        </Card>

        <!-- Sección 3.3: total general al pie -->
        <Card class="mt-2">
          <div class="flex items-center justify-between px-6 py-4">
            <span class="text-sm font-medium">Total ({{ selectedMonth.label }})</span>
            <span class="text-lg font-bold tabular-nums">${{ formatAmount(grandTotal) }}</span>
          </div>
        </Card>
      </template>
    </main>

    <Button
      v-if="showFab"
      size="icon"
      class="fixed right-4 h-14 w-14 rounded-full shadow-[var(--shadow-elevated)] sm:right-6"
      style="bottom: calc(1.5rem + env(safe-area-inset-bottom))"
      aria-label="Agregar gasto de tarjeta"
      @click="openAddSheet"
    >
      <Plus class="size-6" />
    </Button>

    <CardExpenseFormSheet
      v-model:open="isSheetOpen"
      :expense="editingExpense"
      :preset-card-id="presetCardId"
      :preset-person-id="presetPersonId"
      :sync-targets="transactionsSyncTargets"
    />
  </div>
</template>
