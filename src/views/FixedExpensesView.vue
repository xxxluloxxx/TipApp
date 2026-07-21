<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CalendarSync,
  Columns3,
  EllipsisVertical,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  RotateCcw,
  Trash2,
} from '@lucide/vue'
import { currentMonthLabel } from '@/lib/date'
import { formatAmount } from '@/lib/currency'
import { withAlpha } from '@/lib/colors'
import { buildDonutSlices, type CategoryTotal } from '@/lib/charts'
import { useAccountsStore } from '@/stores/accounts'
import { useCategoriesStore } from '@/stores/categories'
import { useFixedExpensesStore, type FixedExpense, type FixedExpenseRow } from '@/stores/fixedExpenses'
import FixedExpenseFormSheet from '@/components/FixedExpenseFormSheet.vue'
import FixedExpenseStatusBadge from '@/components/FixedExpenseStatusBadge.vue'
import MarkFixedExpensePaidSheet, { type PayTarget } from '@/components/MarkFixedExpensePaidSheet.vue'
import CategoryDonutChart from '@/components/charts/CategoryDonutChart.vue'
import AppHeader from '@/components/AppHeader.vue'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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

// Sección 3 de fixed-expenses-ux.md: dashboard de Gastos fijos — 4 cards
// resumen, dona por categoría, lista con estado, FAB de alta. Una sola ruta
// (`/gastos-fijos`, sección 2). Los 3 números de las cards salen directo de
// `fixed_expenses_summary` (nunca re-sumados en cliente, ver store).

const router = useRouter()
const fixedExpensesStore = useFixedExpensesStore()
const categoriesStore = useCategoriesStore()
const accountsStore = useAccountsStore()

const isInitialLoading = ref(true)
const loadError = ref(false)

async function loadAll() {
  loadError.value = false
  isInitialLoading.value = true
  try {
    // Generación perezosa (sección 1.1): siempre antes de leer las vistas del
    // período actual. El Skeleton cubre este paso, no hace falta un tercer
    // estado de carga.
    const ensured = await fixedExpensesStore.ensureCurrentInstances()

    const [templatesOk, instancesOk, summaryOk, prevOk, categoriesOk, accountsOk] = await Promise.all([
      fixedExpensesStore.fetchTemplates(),
      fixedExpensesStore.fetchCurrentInstances(),
      fixedExpensesStore.fetchSummary(),
      fixedExpensesStore.fetchPreviousMonthTotal(),
      categoriesStore.fetchCategories(),
      accountsStore.fetchAccounts(),
    ])

    if (!ensured || !templatesOk || !instancesOk || !summaryOk || !prevOk || !categoriesOk || !accountsOk) {
      loadError.value = true
    }
  } finally {
    isInitialLoading.value = false
  }
}

onMounted(loadAll)

const monthLabel = computed(() => currentMonthLabel())
const hasAnyTemplate = computed(() => fixedExpensesStore.hasAnyTemplate)

// Sección 3.2: hero "Total del mes" — cifra de `summary.total_amount`.
const monthTotal = computed(() => fixedExpensesStore.monthTotal)

// Delta vs. mes anterior (sección 3.2): `null` si no hay mes anterior con
// datos o si no cambió — nunca un 0% con flecha sin sentido.
const monthDelta = computed<{ direction: 'up' | 'down', percent: number } | null>(() => {
  const prev = fixedExpensesStore.previousMonthTotal
  if (prev === null || prev <= 0) return null
  const current = monthTotal.value
  if (current === prev) return null
  const percent = Math.round(Math.abs((current - prev) / prev) * 100)
  return { direction: current > prev ? 'up' : 'down', percent }
})

// Sección 3.3: progreso "X de Y pagados".
const paidCount = computed(() => fixedExpensesStore.paidCount)
const totalCount = computed(() => fixedExpensesStore.plannedCount)

// Sección 3.4: promedio mensual (`null` = sin historial suficiente).
const monthlyAverage = computed(() => fixedExpensesStore.monthlyAverage)

// Sección 3.5: próximos pagos (instancias pendientes del mes).
const upcomingInstances = computed(() => fixedExpensesStore.upcomingInstances)
const upcomingCount = computed(() => upcomingInstances.value.length)

const upcomingSparkline = computed(() => {
  const items = upcomingInstances.value.slice(0, 6)
  const max = Math.max(...items.map(item => item.template_amount ?? 0), 1)
  return items.map(item => ({
    id: item.instance_id ?? '',
    heightPercent: Math.max(((item.template_amount ?? 0) / max) * 100, 8),
  }))
})

function clampDay(paymentDay: number, reference: Date = new Date()): number {
  const lastDay = new Date(reference.getFullYear(), reference.getMonth() + 1, 0).getDate()
  return Math.min(paymentDay, lastDay)
}

const nextPaymentLabel = computed(() => {
  const next = upcomingInstances.value[0]
  if (!next) return ''
  const now = new Date()
  const dd = String(clampDay(next.payment_day ?? 1, now)).padStart(2, '0')
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  return `Próximo: ${next.fixed_expense_name ?? 'Gasto fijo'}, ${dd}/${mm}`
})

const upcomingAriaLabel = computed(() => {
  const items = upcomingInstances.value
  if (items.length === 0) return 'Sin pagos pendientes este mes'
  const amounts = items.map(item => item.template_amount ?? 0)
  const min = Math.min(...amounts)
  const max = Math.max(...amounts)
  return `${items.length} pagos pendientes este mes, entre $${formatAmount(min)} y $${formatAmount(max)}`
})

// Sección 3.6: "Por categoría" — dona reusando `buildDonutSlices`/
// `CategoryDonutChart` tal cual. Se agrupan TODAS las instancias del mes
// (pagadas + pendientes), mismo total que el hero.
const categorySlices = computed(() => {
  const byCategory = new Map<string, CategoryTotal>()
  for (const instance of fixedExpensesStore.currentInstances) {
    const categoryId = instance.category_id ?? 'unknown'
    const amount = instance.status === 'paid' && instance.paid_amount !== null
      ? instance.paid_amount
      : (instance.template_amount ?? 0)
    const existing = byCategory.get(categoryId)
    if (existing) {
      existing.amount += amount
    } else {
      byCategory.set(categoryId, {
        id: categoryId,
        name: instance.category_name ?? 'Sin categoría',
        color: instance.category_color,
        amount,
      })
    }
  }
  return buildDonutSlices([...byCategory.values()])
})

// Sección 3.7: lista de gastos fijos del mes (activas + pausadas, merge
// resuelto en el store).
const fixedExpensesRows = computed(() => fixedExpensesStore.rows)

// --- Sheets ---
const isFormSheetOpen = ref(false)
const editingTemplate = ref<FixedExpense | null>(null)
const isPaySheetOpen = ref(false)
const payTarget = ref<PayTarget | null>(null)

function openAddTemplateSheet() {
  editingTemplate.value = null
  isFormSheetOpen.value = true
}

function openEditTemplateSheet(row: FixedExpenseRow) {
  editingTemplate.value = fixedExpensesStore.templates.find(template => template.id === row.templateId) ?? null
  isFormSheetOpen.value = true
}

function openPaySheet(row: FixedExpenseRow) {
  if (!row.instanceId) return
  payTarget.value = {
    instanceId: row.instanceId,
    name: row.name,
    amount: row.amount,
    notes: row.notes,
  }
  isPaySheetOpen.value = true
}

function toggleActive(row: FixedExpenseRow) {
  fixedExpensesStore.toggleActive(row.templateId)
}

function deleteTemplate(templateId: string) {
  fixedExpensesStore.deleteTemplate(templateId)
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <AppHeader title="Gastos fijos">
      <template #actions>
        <!-- Sección 13.5: acceso a Comparación mensual, sin ítem de drawer
             propio (misma lógica que Settings de Deudas → /deudas/personas). -->
        <Button
          variant="ghost"
          size="icon"
          aria-label="Comparación mensual"
          @click="router.push({ name: 'fixed-expenses-comparison' })"
        >
          <Columns3 class="size-5" />
        </Button>
      </template>
    </AppHeader>

    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 pb-28 sm:px-6 lg:px-8">
      <!-- Estado de carga -->
      <template v-if="isInitialLoading">
        <div class="grid grid-cols-2 gap-3">
          <Skeleton class="col-span-2 h-28 w-full rounded-xl" />
          <Skeleton class="h-24 w-full rounded-xl" />
          <Skeleton class="h-24 w-full rounded-xl" />
        </div>
        <Skeleton class="h-48 w-full rounded-xl" />
        <Skeleton class="h-64 w-full rounded-xl" />
      </template>

      <!-- Estado de error -->
      <template v-else-if="loadError">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <AlertCircle class="size-12 text-destructive" />
          <h2 class="text-lg font-semibold">
            No pudimos cargar tus gastos fijos
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

      <!-- Estado vacío total -->
      <template v-else-if="!hasAnyTemplate">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <CalendarSync class="size-12 text-muted-foreground" />
          <h2 class="text-lg font-semibold">
            Todavía no registraste ningún gasto fijo.
          </h2>
          <p class="max-w-xs text-center text-sm text-muted-foreground">
            Cargá el alquiler, un servicio o una suscripción para llevar el control mes a mes.
          </p>
          <Button @click="openAddTemplateSheet">
            Nuevo gasto fijo
          </Button>
        </div>
      </template>

      <template v-else>
        <!-- Sección 3.2-3.5: cards resumen -->
        <div class="grid grid-cols-2 gap-3">
          <!-- Card 1: Total del mes -->
          <Card class="col-span-2">
            <CardHeader class="pb-2">
              <CardDescription>Total del mes · {{ monthLabel }}</CardDescription>
              <CardTitle class="text-3xl font-bold tabular-nums tracking-tight sm:text-4xl">
                <span class="align-top text-sm font-normal text-muted-foreground">$</span>{{ formatAmount(monthTotal) }}
              </CardTitle>
            </CardHeader>
            <div
              v-if="monthDelta"
              class="flex items-center gap-1.5 px-6 pb-4 text-sm"
              :class="monthDelta.direction === 'up' ? 'text-destructive' : 'text-success'"
            >
              <component :is="monthDelta.direction === 'up' ? ArrowUp : ArrowDown" class="size-3.5" />
              <span>{{ monthDelta.percent }}% vs. mes anterior</span>
            </div>
          </Card>

          <!-- Card 2: Progreso -->
          <Card>
            <CardHeader class="pb-2">
              <CardDescription>Este mes</CardDescription>
            </CardHeader>
            <div class="flex flex-col gap-2 px-6 pb-4">
              <p class="text-lg font-semibold tabular-nums">
                {{ paidCount }} de {{ totalCount }} pagados
              </p>
              <div class="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  class="h-full rounded-full transition-[width]"
                  :class="paidCount === totalCount && totalCount > 0 ? 'bg-success' : 'bg-primary'"
                  :style="{ width: `${totalCount ? (paidCount / totalCount) * 100 : 0}%` }"
                />
              </div>
            </div>
          </Card>

          <!-- Card 3: Promedio mensual -->
          <Card>
            <CardHeader class="pb-2">
              <CardDescription>Promedio mensual</CardDescription>
            </CardHeader>
            <div class="px-6 pb-4">
              <p v-if="monthlyAverage !== null" class="text-lg font-semibold tabular-nums">
                ${{ formatAmount(monthlyAverage) }}
              </p>
              <p v-else class="text-sm text-muted-foreground">
                Sin historial suficiente todavía
              </p>
            </div>
          </Card>

          <!-- Card 4: Próximos pagos -->
          <Card class="col-span-2">
            <CardHeader class="pb-2">
              <CardDescription>Próximos pagos</CardDescription>
            </CardHeader>
            <div class="flex flex-col gap-2 px-6 pb-4">
              <p
                class="text-lg font-semibold tabular-nums"
                :class="upcomingCount === 0 ? 'text-success' : ''"
              >
                <template v-if="upcomingCount > 0">
                  {{ upcomingCount }} pendiente{{ upcomingCount === 1 ? '' : 's' }}
                </template>
                <template v-else>
                  ¡Todo pagado este mes!
                </template>
              </p>
              <div
                v-if="upcomingCount > 0"
                class="flex h-8 items-end gap-1"
                role="img"
                :aria-label="upcomingAriaLabel"
              >
                <div
                  v-for="item in upcomingSparkline"
                  :key="item.id"
                  class="w-2 rounded-sm bg-primary/60"
                  :style="{ height: `${item.heightPercent}%` }"
                />
              </div>
              <p v-if="upcomingCount > 0" class="text-xs text-muted-foreground">
                {{ nextPaymentLabel }}
              </p>
            </div>
          </Card>
        </div>

        <!-- Sección 3.6: por categoría -->
        <Card v-if="categorySlices.length > 0">
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Por categoría
            </CardTitle>
          </CardHeader>
          <div class="flex flex-col items-center gap-4 px-6 pb-6 sm:flex-row">
            <CategoryDonutChart :slices="categorySlices" class="size-32 shrink-0" />
            <div class="flex w-full flex-col gap-2">
              <div v-for="slice in categorySlices" :key="slice.id" class="flex items-center gap-2 text-sm">
                <span
                  class="size-2.5 shrink-0 rounded-full"
                  :style="{ background: slice.color ?? 'var(--color-muted-foreground)' }"
                />
                <span class="min-w-0 flex-1 truncate">{{ slice.name }}</span>
                <span class="tabular-nums text-muted-foreground">${{ formatAmount(slice.amount) }}</span>
              </div>
            </div>
          </div>
        </Card>

        <!-- Sección 3.7: lista de gastos fijos del mes -->
        <Card>
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Gastos fijos del mes
            </CardTitle>
          </CardHeader>
          <div class="flex flex-col">
            <template v-for="(item, idx) in fixedExpensesRows" :key="item.templateId">
              <Separator v-if="idx > 0" />
              <div class="flex items-center gap-3 px-4 py-3" :class="{ 'opacity-60': !item.isActive }">
                <span
                  class="flex size-9 shrink-0 items-center justify-center rounded-full"
                  :style="{ background: withAlpha(item.categoryColor, 0.15) ?? 'var(--color-muted)' }"
                >
                  <span
                    class="size-2.5 rounded-full"
                    :style="{ background: item.categoryColor ?? 'var(--color-muted-foreground)' }"
                  />
                </span>

                <div class="flex min-w-0 flex-1 flex-col">
                  <p class="truncate text-sm font-medium">
                    {{ item.name }}
                  </p>
                  <p class="truncate text-xs text-muted-foreground">
                    {{ item.categoryName }} · Día {{ item.paymentDay }}
                  </p>
                </div>

                <div class="flex flex-col items-end gap-1">
                  <p class="text-sm font-semibold tabular-nums">
                    ${{ formatAmount(item.amount) }}
                  </p>
                  <FixedExpenseStatusBadge :status="item.displayStatus" />
                </div>

                <Button
                  v-if="item.isActive && item.status === 'pending'"
                  size="sm"
                  variant="outline"
                  class="shrink-0"
                  @click="openPaySheet(item)"
                >
                  Pagar
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button variant="ghost" size="icon" aria-label="Más acciones">
                      <EllipsisVertical class="size-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem @select="openEditTemplateSheet(item)">
                      <Pencil class="size-4" /> Editar
                    </DropdownMenuItem>
                    <DropdownMenuItem @select="toggleActive(item)">
                      <component :is="item.isActive ? PauseCircle : PlayCircle" class="size-4" />
                      {{ item.isActive ? 'Pausar' : 'Reanudar' }}
                    </DropdownMenuItem>
                    <AlertDialog>
                      <AlertDialogTrigger as-child>
                        <DropdownMenuItem variant="destructive" @select="(e: Event) => e.preventDefault()">
                          <Trash2 class="size-4" /> Eliminar
                        </DropdownMenuItem>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>¿Eliminar "{{ item.name }}"?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Se borra la plantilla y el seguimiento de este mes. Los gastos que ya
                            generaste al marcarla como pagada quedan intactos en tu historial.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction @click="deleteTemplate(item.templateId)">
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
      </template>
    </main>

    <button
      v-if="hasAnyTemplate && !isInitialLoading && !loadError"
      type="button"
      aria-label="Nuevo gasto fijo"
      class="fixed bottom-6 right-4 z-10 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[var(--shadow-elevated)] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:right-6 lg:right-8"
      style="margin-bottom: env(safe-area-inset-bottom)"
      @click="openAddTemplateSheet"
    >
      <Plus class="size-6" />
    </button>

    <FixedExpenseFormSheet v-model:open="isFormSheetOpen" :template="editingTemplate" />
    <MarkFixedExpensePaidSheet v-model:open="isPaySheetOpen" :target="payTarget" />
  </div>
</template>
