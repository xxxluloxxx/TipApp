<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AlertCircle, Landmark, Plus, RotateCcw, Users } from '@lucide/vue'
import { formatDateChip } from '@/lib/date'
import { formatAmount } from '@/lib/currency'
import { useDebtPeopleStore } from '@/stores/debtPeople'
import { useLoansStore } from '@/stores/loans'
import AppHeader from '@/components/AppHeader.vue'
import LoanFormSheet from '@/components/LoanFormSheet.vue'
import LoanStatusBadge from '@/components/LoanStatusBadge.vue'
import LoanProgressRing from '@/components/charts/LoanProgressRing.vue'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

// Sección 4 de loans-ux.md: lista de préstamos — card resumen global "Total
// que debo recibir", tabs Activos/Historial (derivados de `is_completed`) y
// FAB de alta. Una fila por préstamo con su progreso (ring) y mini-resumen de
// personas deudoras.

const router = useRouter()
const loansStore = useLoansStore()
const debtPeopleStore = useDebtPeopleStore()

const isInitialLoading = ref(true)
const loadError = ref(false)
const activeTab = ref<'active' | 'history'>('active')

async function loadAll() {
  loadError.value = false
  isInitialLoading.value = true
  try {
    const [progressOk, summaryOk, debtorsOk, peopleOk] = await Promise.all([
      loansStore.fetchProgress(),
      loansStore.fetchSummary(),
      loansStore.fetchDebtorBalances(),
      debtPeopleStore.fetchPeople(),
    ])
    if (!progressOk || !summaryOk || !debtorsOk || !peopleOk) {
      loadError.value = true
    }
  } finally {
    isInitialLoading.value = false
  }
}

onMounted(loadAll)

const isSheetOpen = ref(false)
function openAddLoanSheet() {
  isSheetOpen.value = true
}

function goToLoan(loanId: string) {
  router.push({ name: 'loan-detail', params: { id: loanId } })
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <AppHeader title="Préstamos" />

    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 pb-28 sm:px-6 lg:px-8">
      <!-- Carga -->
      <template v-if="isInitialLoading">
        <Skeleton class="h-24 w-full rounded-xl" />
        <Skeleton class="h-10 w-full rounded-lg" />
        <Skeleton class="h-56 w-full rounded-xl" />
        <Skeleton class="h-56 w-full rounded-xl" />
      </template>

      <!-- Error -->
      <template v-else-if="loadError">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <AlertCircle class="size-12 text-destructive" />
          <h2 class="text-lg font-semibold">
            No pudimos cargar tus préstamos
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

      <!-- Vacío total -->
      <template v-else-if="loansStore.loanItems.length === 0">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <Landmark class="size-12 text-muted-foreground" />
          <h2 class="text-lg font-semibold">
            Todavía no registraste ningún préstamo.
          </h2>
          <p class="max-w-xs text-center text-sm text-muted-foreground">
            Llevá el control de tu préstamo en cuotas y de quién te debe una parte.
          </p>
          <Button @click="openAddLoanSheet">
            Nuevo préstamo
          </Button>
        </div>
      </template>

      <template v-else>
        <!-- Sección 4.2: card resumen global (se oculta si no hay nada por recibir) -->
        <Card v-if="loansStore.totalReceivableRemaining > 0" class="border-success/30 bg-success/5">
          <CardHeader class="pb-2">
            <CardDescription class="text-success">
              Total que debo recibir
            </CardDescription>
          </CardHeader>
          <div class="grid grid-cols-2 gap-3 px-6 pb-4">
            <div class="flex flex-col gap-0.5">
              <p class="text-lg font-semibold tabular-nums">
                ${{ formatAmount(loansStore.totalReceived) }}
              </p>
              <p class="text-xs text-muted-foreground">
                Recibido
              </p>
            </div>
            <div class="flex flex-col gap-0.5">
              <p class="text-lg font-semibold tabular-nums text-success">
                ${{ formatAmount(loansStore.totalReceivableRemaining) }}
              </p>
              <p class="text-xs text-muted-foreground">
                Falta por recibir
              </p>
            </div>
          </div>
        </Card>

        <!-- Sección 4.3: tabs Activos / Historial -->
        <Tabs v-model="activeTab" default-value="active">
          <TabsList class="grid w-full grid-cols-2">
            <TabsTrigger value="active">
              Activos
            </TabsTrigger>
            <TabsTrigger value="history">
              Historial
            </TabsTrigger>
          </TabsList>

          <TabsContent value="active" class="flex flex-col gap-4 pt-4">
            <p
              v-if="loansStore.activeLoans.length === 0"
              class="py-8 text-center text-sm text-muted-foreground"
            >
              No tenés préstamos activos.
            </p>
            <Card
              v-for="loan in loansStore.activeLoans"
              :key="loan.loanId"
              class="cursor-pointer transition-colors hover:bg-accent/50"
              role="button"
              tabindex="0"
              @click="goToLoan(loan.loanId)"
              @keydown.enter="goToLoan(loan.loanId)"
            >
              <CardHeader class="gap-1 pb-2">
                <div class="flex items-start justify-between gap-2">
                  <div class="flex min-w-0 flex-col">
                    <CardTitle class="truncate text-base font-semibold">
                      {{ loan.name }}
                    </CardTitle>
                    <CardDescription v-if="loan.description" class="truncate">
                      {{ loan.description }}
                    </CardDescription>
                  </div>
                  <LoanStatusBadge :status="loan.badgeStatus" />
                </div>
              </CardHeader>

              <div class="grid grid-cols-2 gap-3 px-6 pb-3 text-sm sm:grid-cols-4">
                <div class="flex flex-col gap-0.5">
                  <p class="text-xs text-muted-foreground">
                    Total del préstamo
                  </p>
                  <p class="font-medium tabular-nums">
                    ${{ formatAmount(loan.totalAmount) }}
                  </p>
                </div>
                <div class="flex flex-col gap-0.5">
                  <p class="text-xs text-muted-foreground">
                    Cuota mensual
                  </p>
                  <p class="font-medium tabular-nums">
                    ${{ formatAmount(loan.monthlyPayment) }}
                  </p>
                </div>
                <div class="flex flex-col gap-0.5">
                  <p class="text-xs text-muted-foreground">
                    Inicio
                  </p>
                  <p class="font-medium">
                    {{ formatDateChip(loan.startDate) }}
                  </p>
                </div>
                <div class="flex flex-col gap-0.5">
                  <p class="text-xs text-muted-foreground">
                    Fin estimado
                  </p>
                  <p class="font-medium">
                    {{ loan.estimatedEndDate ? formatDateChip(loan.estimatedEndDate) : '—' }}
                  </p>
                </div>
              </div>

              <Separator />

              <div class="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center">
                <LoanProgressRing :percent="loan.percentComplete" :size="72" />
                <div class="flex flex-1 flex-col gap-1">
                  <p class="text-sm font-medium">
                    Progreso general
                  </p>
                  <p class="text-xs text-muted-foreground">
                    Cuotas pagadas {{ loan.paidCount }} de {{ loan.totalCount }}
                  </p>
                  <div class="flex items-center gap-3 text-xs">
                    <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-success" /> Pagado: ${{ formatAmount(loan.paidAmount) }}</span>
                    <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-muted-foreground/40" /> Falta: ${{ formatAmount(loan.remainingAmount) }}</span>
                  </div>
                </div>
              </div>

              <div
                v-if="loan.debtorsCount > 0"
                class="flex items-center gap-2 border-t border-border px-6 py-3 text-xs text-muted-foreground"
              >
                <Users class="size-3.5" />
                Recibido ${{ formatAmount(loan.debtorsReceived) }} de ${{ formatAmount(loan.debtorsTotal) }} entre {{ loan.debtorsCount }} persona{{ loan.debtorsCount === 1 ? '' : 's' }}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="history" class="flex flex-col gap-4 pt-4">
            <p
              v-if="loansStore.historyLoans.length === 0"
              class="py-8 text-center text-sm text-muted-foreground"
            >
              Todavía no completaste ningún préstamo.
            </p>
            <Card
              v-for="loan in loansStore.historyLoans"
              :key="loan.loanId"
              class="cursor-pointer transition-colors hover:bg-accent/50"
              role="button"
              tabindex="0"
              @click="goToLoan(loan.loanId)"
              @keydown.enter="goToLoan(loan.loanId)"
            >
              <CardHeader class="gap-1 pb-2">
                <div class="flex items-start justify-between gap-2">
                  <div class="flex min-w-0 flex-col">
                    <CardTitle class="truncate text-base font-semibold">
                      {{ loan.name }}
                    </CardTitle>
                    <CardDescription v-if="loan.description" class="truncate">
                      {{ loan.description }}
                    </CardDescription>
                  </div>
                  <LoanStatusBadge :status="loan.badgeStatus" />
                </div>
              </CardHeader>

              <div class="grid grid-cols-2 gap-3 px-6 pb-3 text-sm sm:grid-cols-4">
                <div class="flex flex-col gap-0.5">
                  <p class="text-xs text-muted-foreground">
                    Total del préstamo
                  </p>
                  <p class="font-medium tabular-nums">
                    ${{ formatAmount(loan.totalAmount) }}
                  </p>
                </div>
                <div class="flex flex-col gap-0.5">
                  <p class="text-xs text-muted-foreground">
                    Cuota mensual
                  </p>
                  <p class="font-medium tabular-nums">
                    ${{ formatAmount(loan.monthlyPayment) }}
                  </p>
                </div>
                <div class="flex flex-col gap-0.5">
                  <p class="text-xs text-muted-foreground">
                    Inicio
                  </p>
                  <p class="font-medium">
                    {{ formatDateChip(loan.startDate) }}
                  </p>
                </div>
                <div class="flex flex-col gap-0.5">
                  <p class="text-xs text-muted-foreground">
                    Fin estimado
                  </p>
                  <p class="font-medium">
                    {{ loan.estimatedEndDate ? formatDateChip(loan.estimatedEndDate) : '—' }}
                  </p>
                </div>
              </div>

              <Separator />

              <div class="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center">
                <LoanProgressRing :percent="loan.percentComplete" :size="72" />
                <div class="flex flex-1 flex-col gap-1">
                  <p class="text-sm font-medium">
                    Progreso general
                  </p>
                  <p class="text-xs text-muted-foreground">
                    Cuotas pagadas {{ loan.paidCount }} de {{ loan.totalCount }}
                  </p>
                  <div class="flex items-center gap-3 text-xs">
                    <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-success" /> Pagado: ${{ formatAmount(loan.paidAmount) }}</span>
                    <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-muted-foreground/40" /> Falta: ${{ formatAmount(loan.remainingAmount) }}</span>
                  </div>
                </div>
              </div>

              <div
                v-if="loan.debtorsCount > 0"
                class="flex items-center gap-2 border-t border-border px-6 py-3 text-xs text-muted-foreground"
              >
                <Users class="size-3.5" />
                Recibido ${{ formatAmount(loan.debtorsReceived) }} de ${{ formatAmount(loan.debtorsTotal) }} entre {{ loan.debtorsCount }} persona{{ loan.debtorsCount === 1 ? '' : 's' }}
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </template>
    </main>

    <button
      v-if="!isInitialLoading && !loadError && loansStore.loanItems.length > 0"
      type="button"
      aria-label="Nuevo préstamo"
      class="fixed bottom-6 right-4 z-10 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[var(--shadow-elevated)] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:right-6 lg:right-8"
      style="margin-bottom: env(safe-area-inset-bottom)"
      @click="openAddLoanSheet"
    >
      <Plus class="size-6" />
    </button>

    <LoanFormSheet v-model:open="isSheetOpen" :loan="null" />
  </div>
</template>
