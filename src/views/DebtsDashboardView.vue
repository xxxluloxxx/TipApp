<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  HandCoins,
  Plus,
  RotateCcw,
  Settings,
  User,
  Wallet,
} from '@lucide/vue'
import { currentMonthLabel, formatDateOnly, formatExpenseDateHeading } from '@/lib/date'
import { formatAmount } from '@/lib/currency'
import { buildDebtBalanceEvolution } from '@/lib/charts'
import { useAccountsStore } from '@/stores/accounts'
import { useDebtPeopleStore } from '@/stores/debtPeople'
import { useDebtsStore, type DebtMovementWithDebt } from '@/stores/debts'
import DebtFormSheet from '@/components/DebtFormSheet.vue'
import DualTrendChart from '@/components/charts/DualTrendChart.vue'
import AppHeader from '@/components/AppHeader.vue'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

// Sección 3 de debts-ux.md: dashboard de Deudas — dos cards resumen, saldo
// neto, tabs por dirección + historial, resumen rápido del mes, gráfico de
// evolución, FAB de alta.

const router = useRouter()
const debtsStore = useDebtsStore()
const debtPeopleStore = useDebtPeopleStore()
const accountsStore = useAccountsStore()

const isInitialLoading = ref(true)
const loadError = ref(false)

const recentMovements = ref<DebtMovementWithDebt[]>([])
/** Movimientos de los últimos 12 meses (sección 1.3/1.4): reusados tanto
 * para "Resumen rápido" del mes en curso como para "Evolución de saldos" —
 * el mes en curso siempre está contenido en esta ventana. */
const windowMovements = ref<DebtMovementWithDebt[]>([])

function monthStart(offsetMonths: number, reference: Date = new Date()): Date {
  return new Date(reference.getFullYear(), reference.getMonth() + offsetMonths, 1)
}

async function loadAll() {
  loadError.value = false
  isInitialLoading.value = true
  try {
    const windowStart = monthStart(-11)
    const windowEnd = monthStart(1)

    const [debtsOk, balancesOk, peopleOk, accountsOk, recentRes, windowRes] = await Promise.all([
      debtsStore.fetchDebts(),
      debtsStore.fetchBalances(),
      debtPeopleStore.fetchPeople(),
      accountsStore.fetchAccounts(),
      debtsStore.fetchRecentMovements(),
      debtsStore.fetchMovementsInRange(formatDateOnly(windowStart), formatDateOnly(windowEnd)),
    ])

    if (!debtsOk || !balancesOk || !peopleOk || !accountsOk || recentRes === null || windowRes === null) {
      loadError.value = true
      return
    }

    recentMovements.value = recentRes
    windowMovements.value = windowRes
  } finally {
    isInitialLoading.value = false
  }
}

onMounted(loadAll)

const monthLabel = computed(() => currentMonthLabel())
const hasAnyDebt = computed(() => debtsStore.debts.length > 0)

const activeTab = ref<'lent' | 'borrowed' | 'history'>('lent')

// Sección 3.7: subconjunto del mes en curso, recortado de la ventana de 12
// meses ya cargada (sección 1.3) — sin ningún fetch adicional.
const thisMonthMovements = computed(() => {
  const start = formatDateOnly(monthStart(0))
  const end = formatDateOnly(monthStart(1))
  return windowMovements.value.filter(movement => movement.movement_date >= start && movement.movement_date < end)
})

// "Presté este mes"/"Me prestaron este mes": solo `amount > 0` (altas/
// ampliaciones, no abonos que bajarían el número de forma confusa).
const lentThisMonthMovements = computed(() =>
  thisMonthMovements.value.filter(movement => movement.debt.direction === 'lent' && movement.amount > 0),
)
const borrowedThisMonthMovements = computed(() =>
  thisMonthMovements.value.filter(movement => movement.debt.direction === 'borrowed' && movement.amount > 0),
)
const lentThisMonth = computed(() => lentThisMonthMovements.value.reduce((sum, m) => sum + m.amount, 0))
const borrowedThisMonth = computed(() => borrowedThisMonthMovements.value.reduce((sum, m) => sum + m.amount, 0))
const lentMovementsCount = computed(() => lentThisMonthMovements.value.length)
const borrowedMovementsCount = computed(() => borrowedThisMonthMovements.value.length)

// Sección 1.4: los totales por dirección ya agregados (sección 1.2) son
// suficientes como entrada de `buildDebtBalanceEvolution` — la función solo
// necesita el total por dirección, no el detalle por hilo.
const balanceEvolutionPoints = computed(() => buildDebtBalanceEvolution(
  [
    { direction: 'lent', balance: debtsStore.totalLentBalance },
    { direction: 'borrowed', balance: debtsStore.totalBorrowedBalance },
  ],
  windowMovements.value.map(movement => ({
    amount: movement.amount,
    movementDate: movement.movement_date,
    direction: movement.debt.direction,
  })),
))
const hasBalanceEvolution = computed(() =>
  balanceEvolutionPoints.value.some(point => point.lent !== 0 || point.borrowed !== 0),
)

function personNameFor(movement: DebtMovementWithDebt): string {
  return debtPeopleStore.personById(movement.debt.person_id)?.name ?? 'Persona'
}
function accountNameFor(movement: DebtMovementWithDebt): string | null {
  if (!movement.account_id) return null
  return accountsStore.accountById(movement.account_id)?.name ?? null
}

// Sección 3.6: verbo explícito según dirección + signo, nunca solo el
// ícono/color de dirección.
function movementVerb(movement: DebtMovementWithDebt): string {
  const isLent = movement.debt.direction === 'lent'
  if (isLent) return movement.amount > 0 ? 'Prestaste más' : 'Te devolvieron'
  return movement.amount > 0 ? 'Te prestaron más' : 'Pagaste'
}

// Sheet de alta (sección 5) — sección 3.9/3.10: FAB y estado vacío abren
// exactamente el mismo Sheet, sin ruta intermedia.
const isDebtSheetOpen = ref(false)
function openAddDebt() {
  isDebtSheetOpen.value = true
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <AppHeader title="Deudas">
      <template #actions>
        <Button variant="ghost" size="icon" aria-label="Gestionar personas" @click="router.push({ name: 'debt-people' })">
          <Settings class="size-5" />
        </Button>
      </template>
    </AppHeader>

    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 pb-28 sm:px-6 lg:px-8">
      <!-- Estado de carga -->
      <template v-if="isInitialLoading">
        <div class="grid grid-cols-2 gap-3">
          <Skeleton class="h-24 w-full rounded-xl" />
          <Skeleton class="h-24 w-full rounded-xl" />
        </div>
        <Skeleton class="h-16 w-full rounded-xl" />
        <Skeleton class="h-64 w-full rounded-xl" />
        <Skeleton class="h-32 w-full rounded-xl" />
        <Skeleton class="h-40 w-full rounded-xl" />
      </template>

      <!-- Estado de error -->
      <template v-else-if="loadError">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <AlertCircle class="size-12 text-destructive" />
          <h2 class="text-lg font-semibold">
            No pudimos cargar tus deudas
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
      <template v-else-if="!hasAnyDebt">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <HandCoins class="size-12 text-muted-foreground" />
          <h2 class="text-lg font-semibold">
            Todavía no registraste ningún préstamo.
          </h2>
          <p class="max-w-xs text-center text-sm text-muted-foreground">
            Registrá a quién le prestaste plata o quién te prestó a vos.
          </p>
          <Button @click="openAddDebt">
            Nueva deuda
          </Button>
        </div>
      </template>

      <template v-else>
        <!-- Sección 3.2: cards resumen -->
        <div class="grid grid-cols-2 gap-3">
          <Card class="border-success/30 bg-success/5">
            <CardHeader class="pb-2">
              <div class="flex items-start justify-between gap-2">
                <CardDescription class="text-success">
                  Yo presté
                </CardDescription>
                <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
                  <ArrowUpRight class="size-4" />
                </span>
              </div>
            </CardHeader>
            <div class="px-6 pb-4">
              <p class="text-2xl font-bold tabular-nums tracking-tight">
                ${{ formatAmount(debtsStore.totalLentBalance) }}
              </p>
              <p class="text-xs text-muted-foreground">
                Total pendiente por cobrar
              </p>
            </div>
          </Card>

          <Card class="border-destructive/30 bg-destructive/5">
            <CardHeader class="pb-2">
              <div class="flex items-start justify-between gap-2">
                <CardDescription class="text-destructive">
                  Me prestaron
                </CardDescription>
                <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
                  <ArrowDownRight class="size-4" />
                </span>
              </div>
            </CardHeader>
            <div class="px-6 pb-4">
              <p class="text-2xl font-bold tabular-nums tracking-tight">
                ${{ formatAmount(debtsStore.totalBorrowedBalance) }}
              </p>
              <p class="text-xs text-muted-foreground">
                Total pendiente por pagar
              </p>
            </div>
          </Card>
        </div>

        <!-- Sección 3.3: saldo neto -->
        <Card>
          <div class="flex items-center justify-between px-6 py-4">
            <div class="flex flex-col gap-0.5">
              <p class="text-sm font-medium">
                Saldo neto
              </p>
              <p class="text-xs text-muted-foreground">
                Lo que me deben − lo que debo
              </p>
            </div>
            <p
              class="text-xl font-bold tabular-nums"
              :class="debtsStore.netBalance >= 0 ? 'text-success' : 'text-destructive'"
            >
              {{ debtsStore.netBalance >= 0 ? '+' : '-' }}${{ formatAmount(Math.abs(debtsStore.netBalance)) }}
            </p>
          </div>
        </Card>

        <!-- Sección 3.4-3.6: tabs -->
        <Tabs v-model="activeTab" default-value="lent">
          <TabsList class="grid w-full grid-cols-3">
            <TabsTrigger value="lent">
              Yo presté
            </TabsTrigger>
            <TabsTrigger value="borrowed">
              Me prestaron
            </TabsTrigger>
            <TabsTrigger value="history">
              Historial
            </TabsTrigger>
          </TabsList>

          <TabsContent value="lent">
            <Card class="mt-3">
              <div v-if="debtsStore.lentDebts.length === 0" class="px-4 py-8 text-center text-sm text-muted-foreground">
                Todavía no le prestaste plata a nadie.
              </div>
              <div v-else class="flex flex-col">
                <template v-for="(debt, idx) in debtsStore.lentDebts" :key="debt.id">
                  <Separator v-if="idx > 0" />
                  <button
                    type="button"
                    class="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    @click="router.push({ name: 'debt-detail', params: { id: debt.id } })"
                  >
                    <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                      <User class="size-4 text-muted-foreground" />
                    </span>
                    <div class="flex min-w-0 flex-1 flex-col">
                      <p class="truncate text-sm font-medium">
                        {{ debt.personName }}
                      </p>
                      <p v-if="debt.description" class="truncate text-xs text-muted-foreground">
                        {{ debt.description }}
                      </p>
                    </div>
                    <div class="flex flex-col items-end gap-0.5">
                      <p class="text-sm font-semibold tabular-nums">
                        ${{ formatAmount(Math.abs(debt.balance)) }}
                      </p>
                      <Badge :variant="debt.balance > 0 ? 'outline' : 'secondary'" class="text-[10px]">
                        {{ debt.balance > 0 ? 'Pendiente' : 'Saldada' }}
                      </Badge>
                    </div>
                  </button>
                </template>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="borrowed">
            <Card class="mt-3">
              <div v-if="debtsStore.borrowedDebts.length === 0" class="px-4 py-8 text-center text-sm text-muted-foreground">
                Todavía no te prestaron plata.
              </div>
              <div v-else class="flex flex-col">
                <template v-for="(debt, idx) in debtsStore.borrowedDebts" :key="debt.id">
                  <Separator v-if="idx > 0" />
                  <button
                    type="button"
                    class="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    @click="router.push({ name: 'debt-detail', params: { id: debt.id } })"
                  >
                    <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                      <User class="size-4 text-muted-foreground" />
                    </span>
                    <div class="flex min-w-0 flex-1 flex-col">
                      <p class="truncate text-sm font-medium">
                        {{ debt.personName }}
                      </p>
                      <p v-if="debt.description" class="truncate text-xs text-muted-foreground">
                        {{ debt.description }}
                      </p>
                    </div>
                    <div class="flex flex-col items-end gap-0.5">
                      <p class="text-sm font-semibold tabular-nums">
                        ${{ formatAmount(Math.abs(debt.balance)) }}
                      </p>
                      <Badge :variant="debt.balance > 0 ? 'outline' : 'secondary'" class="text-[10px]">
                        {{ debt.balance > 0 ? 'Pendiente' : 'Saldada' }}
                      </Badge>
                    </div>
                  </button>
                </template>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <Card class="mt-3">
              <div v-if="recentMovements.length === 0" class="px-4 py-8 text-center text-sm text-muted-foreground">
                Todavía no registraste ningún movimiento.
              </div>
              <div v-else class="flex flex-col">
                <template v-for="(mov, idx) in recentMovements" :key="mov.id">
                  <Separator v-if="idx > 0" />
                  <button
                    type="button"
                    class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    @click="router.push({ name: 'debt-detail', params: { id: mov.debt_id } })"
                  >
                    <span
                      class="flex size-9 shrink-0 items-center justify-center rounded-full"
                      :class="mov.debt.direction === 'lent' ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive'"
                    >
                      <component :is="mov.debt.direction === 'lent' ? ArrowUpRight : ArrowDownRight" class="size-4" />
                    </span>
                    <div class="flex min-w-0 flex-1 flex-col">
                      <p class="truncate text-sm font-medium">
                        {{ movementVerb(mov) }} · {{ personNameFor(mov) }}
                      </p>
                      <p class="truncate text-xs text-muted-foreground">
                        {{ formatExpenseDateHeading(mov.movement_date) }}
                        <span v-if="accountNameFor(mov)">· <Wallet class="inline size-3" /> {{ accountNameFor(mov) }}</span>
                      </p>
                    </div>
                    <p class="shrink-0 text-sm font-semibold tabular-nums">
                      {{ mov.amount >= 0 ? '+' : '-' }}${{ formatAmount(Math.abs(mov.amount)) }}
                    </p>
                  </button>
                </template>
              </div>
            </Card>
          </TabsContent>
        </Tabs>

        <!-- Sección 3.7: resumen rápido del mes -->
        <Card>
          <CardHeader>
            <CardTitle class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Resumen rápido · {{ monthLabel }}
            </CardTitle>
          </CardHeader>
          <div class="grid grid-cols-2 gap-3 px-4 pb-4 sm:px-6 sm:pb-6">
            <div class="flex flex-col gap-1 rounded-lg border border-border p-3">
              <div class="flex items-center gap-1.5 text-success">
                <ArrowUpRight class="size-4" />
                <span class="text-xs font-medium">Presté este mes</span>
              </div>
              <p class="text-lg font-semibold tabular-nums">
                ${{ formatAmount(lentThisMonth) }}
              </p>
              <p class="text-xs text-muted-foreground">
                {{ lentMovementsCount }} movimiento{{ lentMovementsCount === 1 ? '' : 's' }}
              </p>
            </div>
            <div class="flex flex-col gap-1 rounded-lg border border-border p-3">
              <div class="flex items-center gap-1.5 text-destructive">
                <ArrowDownRight class="size-4" />
                <span class="text-xs font-medium">Me prestaron este mes</span>
              </div>
              <p class="text-lg font-semibold tabular-nums">
                ${{ formatAmount(borrowedThisMonth) }}
              </p>
              <p class="text-xs text-muted-foreground">
                {{ borrowedMovementsCount }} movimiento{{ borrowedMovementsCount === 1 ? '' : 's' }}
              </p>
            </div>
          </div>
        </Card>

        <!-- Sección 3.8: evolución de saldos -->
        <Card v-if="hasBalanceEvolution">
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Evolución de saldos
            </CardTitle>
            <CardDescription>Últimos 12 meses</CardDescription>
          </CardHeader>
          <div class="flex flex-col gap-3 px-4 pb-6 sm:px-6">
            <div class="flex items-center gap-4 text-xs text-muted-foreground">
              <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-success" /> Yo presté</span>
              <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-destructive" /> Me prestaron</span>
            </div>
            <DualTrendChart
              :points="balanceEvolutionPoints"
              :height="120"
              ariaLabel="Evolución del saldo prestado y recibido, últimos 12 meses"
            />
          </div>
        </Card>
      </template>
    </main>

    <Button
      v-if="hasAnyDebt"
      size="icon"
      class="fixed right-4 h-14 w-14 rounded-full shadow-[var(--shadow-elevated)] sm:right-6"
      style="bottom: calc(1.5rem + env(safe-area-inset-bottom))"
      aria-label="Nueva deuda"
      @click="openAddDebt"
    >
      <Plus class="size-6" />
    </Button>

    <DebtFormSheet v-model:open="isDebtSheetOpen" />
  </div>
</template>
