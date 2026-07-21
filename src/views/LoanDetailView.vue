<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertCircle,
  CirclePlus,
  EllipsisVertical,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  User,
} from '@lucide/vue'
import { currentMonthLabel, formatDateChip, parseDateOnly } from '@/lib/date'
import { formatAmount } from '@/lib/currency'
import { readableTextColor } from '@/lib/colors'
import { useDebtPeopleStore } from '@/stores/debtPeople'
import {
  useLoansStore,
  type LoanDebtorItem,
  type LoanInstallment,
  type LoanInstallmentDisplayStatus,
} from '@/stores/loans'
import AppHeader from '@/components/AppHeader.vue'
import LoanFormSheet from '@/components/LoanFormSheet.vue'
import LoanDebtorFormSheet from '@/components/LoanDebtorFormSheet.vue'
import LoanDebtorPaymentFormSheet from '@/components/LoanDebtorPaymentFormSheet.vue'
import LoanStatusBadge from '@/components/LoanStatusBadge.vue'
import LoanInstallmentStatusBadge from '@/components/LoanInstallmentStatusBadge.vue'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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

// Sección 5 de loans-ux.md: detalle de un préstamo con tabs Resumen/Cuotas/
// Personas. Vista de "segundo nivel" (vuelve a /prestamos, sin botón Volver —
// el drawer es la única navegación hacia atrás). Fetch propio (deep-link).

const route = useRoute()
const router = useRouter()
const loansStore = useLoansStore()
const debtPeopleStore = useDebtPeopleStore()

const loanId = computed(() => String(route.params.id))
const loan = computed(() => loansStore.loanItemById(loanId.value))
const progressRow = computed(() => loansStore.progress.find(p => p.loan_id === loanId.value) ?? null)
const installments = computed(() => loansStore.installments)

const isInitialLoading = ref(true)
const loadError = ref(false)
const activeTab = ref<'summary' | 'installments' | 'people'>('summary')

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

    if (!progressOk || !summaryOk || !debtorsOk || !peopleOk || !loan.value) {
      loadError.value = true
      return
    }

    const installmentsOk = await loansStore.fetchInstallments(loanId.value)
    if (!installmentsOk) {
      loadError.value = true
    }
  } finally {
    isInitialLoading.value = false
  }
}

onMounted(loadAll)

// --- Derivaciones de cliente (trivial, sobre datos ya seguros) ---

function daysRemaining(dateOnly: string | null): number {
  if (!dateOnly) return 0
  const due = parseDateOnly(dateOnly)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((due.getTime() - today.getTime()) / 86_400_000)
}

// Sección 5.3: estado visual por cuota individual. `has_overdue` de la vista
// responde "¿tiene ALGUNA atrasada?"; esto responde "¿es ESTA la atrasada?".
function installmentDisplayStatus(installment: LoanInstallment): LoanInstallmentDisplayStatus {
  if (installment.status === 'paid') return 'paid'
  const due = parseDateOnly(installment.due_date)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return due.getTime() < today.getTime() ? 'overdue' : 'pending'
}

function monthYearLabel(dateOnly: string): string {
  return currentMonthLabel(parseDateOnly(dateOnly))
}

function toggleInstallment(installment: LoanInstallment) {
  loansStore.toggleInstallment(installment)
}

// --- Sheets ---
const isLoanSheetOpen = ref(false)
function openEditLoanSheet() {
  isLoanSheetOpen.value = true
}

const isDebtorSheetOpen = ref(false)
function openAddDebtorSheet() {
  isDebtorSheetOpen.value = true
}

const isPaymentSheetOpen = ref(false)
const paymentDebtor = ref<LoanDebtorItem | null>(null)
function openRegisterPaymentSheet(debtor: LoanDebtorItem) {
  paymentDebtor.value = debtor
  isPaymentSheetOpen.value = true
}

function removeDebtor(loanDebtorId: string) {
  loansStore.removeDebtor(loanDebtorId)
}

function deleteLoanAndGoBack() {
  loansStore.deleteLoan(loanId.value)
  router.push({ name: 'loans' })
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <AppHeader :title="loan?.name ?? 'Préstamo'">
      <template #actions>
        <DropdownMenu v-if="loan">
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon" aria-label="Más acciones">
              <EllipsisVertical class="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem @select="openEditLoanSheet">
              <Pencil class="size-4" /> Editar préstamo
            </DropdownMenuItem>
            <AlertDialog>
              <AlertDialogTrigger as-child>
                <DropdownMenuItem variant="destructive" @select="(e: Event) => e.preventDefault()">
                  <Trash2 class="size-4" /> Eliminar préstamo
                </DropdownMenuItem>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Eliminar "{{ loan?.name }}"?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Se borran el préstamo, su cronograma de cuotas y el registro de
                    las personas asociadas, incluidos los pagos que les registraste.
                    Esta acción no se puede deshacer.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction @click="deleteLoanAndGoBack">
                    Eliminar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </DropdownMenuContent>
        </DropdownMenu>
      </template>
    </AppHeader>

    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <!-- Carga -->
      <template v-if="isInitialLoading">
        <Skeleton class="h-10 w-full rounded-lg" />
        <Skeleton class="h-40 w-full rounded-xl" />
        <Skeleton class="h-40 w-full rounded-xl" />
      </template>

      <!-- Error / préstamo inexistente o ajeno -->
      <template v-else-if="loadError || !loan">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <AlertCircle class="size-12 text-destructive" />
          <h2 class="text-lg font-semibold">
            No pudimos cargar este préstamo
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

      <template v-else>
        <Tabs v-model="activeTab" default-value="summary">
          <TabsList class="grid w-full grid-cols-3">
            <TabsTrigger value="summary">
              Resumen
            </TabsTrigger>
            <TabsTrigger value="installments">
              Cuotas
            </TabsTrigger>
            <TabsTrigger value="people">
              Personas
            </TabsTrigger>
          </TabsList>

          <!-- Sección 5.2: Resumen -->
          <TabsContent value="summary" class="flex flex-col gap-4 pt-4">
            <div class="flex items-center justify-between">
              <LoanStatusBadge :status="loan.badgeStatus" />
            </div>

            <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Card size="sm">
                <CardHeader class="pb-1">
                  <CardDescription>Total</CardDescription>
                </CardHeader>
                <div class="px-4 pb-3">
                  <p class="font-semibold tabular-nums">
                    ${{ formatAmount(loan.totalAmount) }}
                  </p>
                </div>
              </Card>
              <Card size="sm">
                <CardHeader class="pb-1">
                  <CardDescription>Cuota mensual</CardDescription>
                </CardHeader>
                <div class="px-4 pb-3">
                  <p class="font-semibold tabular-nums">
                    ${{ formatAmount(loan.monthlyPayment) }}
                  </p>
                </div>
              </Card>
              <Card size="sm">
                <CardHeader class="pb-1">
                  <CardDescription>Inicio</CardDescription>
                </CardHeader>
                <div class="px-4 pb-3">
                  <p class="font-semibold">
                    {{ formatDateChip(loan.startDate) }}
                  </p>
                </div>
              </Card>
              <Card size="sm">
                <CardHeader class="pb-1">
                  <CardDescription>Fin estimado</CardDescription>
                </CardHeader>
                <div class="px-4 pb-3">
                  <p class="font-semibold">
                    {{ loan.estimatedEndDate ? formatDateChip(loan.estimatedEndDate) : '—' }}
                  </p>
                </div>
              </Card>
            </div>

            <Card>
              <CardHeader class="pb-2">
                <CardTitle class="text-base font-semibold">
                  Progreso
                </CardTitle>
              </CardHeader>
              <div class="flex flex-col gap-2 px-6 pb-4">
                <div class="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    class="h-full rounded-full bg-success transition-[width]"
                    :style="{ width: `${loan.percentComplete}%` }"
                  />
                </div>
                <p class="text-xs text-muted-foreground">
                  {{ loan.paidCount }} de {{ loan.totalCount }} cuotas pagadas ({{ Math.round(loan.percentComplete) }}%)
                </p>
              </div>
            </Card>

            <Card v-if="!loan.isCompleted && loan.nextInstallmentNumber !== null">
              <CardHeader class="pb-2">
                <CardTitle class="text-base font-semibold">
                  Próxima cuota
                </CardTitle>
              </CardHeader>
              <div class="flex items-center justify-between px-6 pb-4">
                <div class="flex flex-col gap-0.5">
                  <p class="text-sm font-medium">
                    Cuota {{ loan.nextInstallmentNumber }} de {{ loan.totalCount }}
                  </p>
                  <p class="text-xs text-muted-foreground">
                    {{ loan.nextInstallmentDueDate ? formatDateChip(loan.nextInstallmentDueDate) : '—' }}
                  </p>
                </div>
                <div class="flex flex-col items-end gap-0.5">
                  <p class="text-lg font-semibold tabular-nums">
                    ${{ formatAmount(loan.nextInstallmentAmount ?? 0) }}
                  </p>
                  <p
                    class="text-xs"
                    :class="daysRemaining(loan.nextInstallmentDueDate) < 0 ? 'text-destructive' : 'text-muted-foreground'"
                  >
                    {{ daysRemaining(loan.nextInstallmentDueDate) >= 0
                      ? `Faltan ${daysRemaining(loan.nextInstallmentDueDate)} días`
                      : `Vencida hace ${Math.abs(daysRemaining(loan.nextInstallmentDueDate))} días` }}
                  </p>
                </div>
              </div>
            </Card>

            <Card v-if="loan.debtorsCount > 0">
              <CardHeader class="flex-row items-center justify-between pb-2">
                <CardTitle class="text-base font-semibold">
                  Personas que me deben
                </CardTitle>
                <Button variant="ghost" size="sm" @click="activeTab = 'people'">
                  Ver todas
                </Button>
              </CardHeader>
              <div class="flex flex-col">
                <template v-for="(debtor, idx) in loan.debtorsPreview" :key="debtor.loanDebtorId">
                  <Separator v-if="idx > 0" />
                  <div class="flex items-center gap-3 px-6 py-3">
                    <span
                      class="flex size-9 shrink-0 items-center justify-center rounded-full"
                      :style="{ backgroundColor: debtor.person.color ?? 'hsl(var(--muted))' }"
                    >
                      <User class="size-4" :style="{ color: readableTextColor(debtor.person.color) }" />
                    </span>
                    <div class="flex min-w-0 flex-1 flex-col">
                      <p class="truncate text-sm font-medium">
                        {{ debtor.person.name }}
                      </p>
                      <p class="text-xs text-muted-foreground">
                        ${{ formatAmount(debtor.balanceRemaining) }} pendiente
                      </p>
                    </div>
                  </div>
                </template>
              </div>
            </Card>
          </TabsContent>

          <!-- Sección 5.3: Cuotas -->
          <TabsContent value="installments" class="pt-4">
            <p
              v-if="installments.length === 0"
              class="py-8 text-center text-sm text-muted-foreground"
            >
              No hay cuotas generadas para este préstamo.
            </p>
            <div v-else class="flex flex-col">
              <template v-for="(installment, idx) in installments" :key="installment.id">
                <Separator v-if="idx > 0" />
                <button
                  type="button"
                  class="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  @click="toggleInstallment(installment)"
                >
                  <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium tabular-nums">
                    {{ installment.installment_number }}
                  </span>
                  <div class="flex min-w-0 flex-1 flex-col">
                    <p class="text-sm font-medium capitalize">
                      {{ monthYearLabel(installment.due_date) }}
                    </p>
                    <p class="text-xs text-muted-foreground">
                      {{ formatDateChip(installment.due_date) }}
                    </p>
                  </div>
                  <p class="shrink-0 text-sm font-semibold tabular-nums">
                    ${{ formatAmount(installment.amount) }}
                  </p>
                  <LoanInstallmentStatusBadge :status="installmentDisplayStatus(installment)" />
                </button>
              </template>
            </div>
          </TabsContent>

          <!-- Sección 5.4: Personas -->
          <TabsContent value="people" class="flex flex-col gap-3 pt-4">
            <p
              v-if="loan.debtors.length === 0"
              class="py-8 text-center text-sm text-muted-foreground"
            >
              Todavía no le asignaste este préstamo a ninguna persona.
            </p>
            <div v-else class="flex flex-col">
              <template v-for="(debtor, idx) in loan.debtors" :key="debtor.loanDebtorId">
                <Separator v-if="idx > 0" />
                <div class="flex flex-col gap-2 px-4 py-3">
                  <div class="flex items-center justify-between gap-3">
                    <div class="flex items-center gap-3">
                      <span
                        class="flex size-9 shrink-0 items-center justify-center rounded-full"
                        :style="{ backgroundColor: debtor.person.color ?? 'hsl(var(--muted))' }"
                      >
                        <User class="size-4" :style="{ color: readableTextColor(debtor.person.color) }" />
                      </span>
                      <div class="flex min-w-0 flex-col">
                        <p class="truncate text-sm font-medium">
                          {{ debtor.person.name }}
                        </p>
                        <p class="text-xs text-muted-foreground">
                          Le corresponden ${{ formatAmount(debtor.amountAssigned) }}
                        </p>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger as-child>
                        <Button variant="ghost" size="icon" aria-label="Más acciones">
                          <EllipsisVertical class="size-5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem @select="openRegisterPaymentSheet(debtor)">
                          <CirclePlus class="size-4" /> Registrar pago recibido
                        </DropdownMenuItem>
                        <AlertDialog>
                          <AlertDialogTrigger as-child>
                            <DropdownMenuItem
                              variant="destructive"
                              :disabled="debtor.hasPayments"
                              @select="(e: Event) => e.preventDefault()"
                            >
                              <Trash2 class="size-4" /> Quitar del préstamo
                            </DropdownMenuItem>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>¿Quitar a "{{ debtor.person.name }}" de este préstamo?</AlertDialogTitle>
                              <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction @click="removeDebtor(debtor.loanDebtorId)">
                                Quitar
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div class="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      class="h-full rounded-full bg-success transition-[width]"
                      :style="{ width: `${debtor.amountAssigned > 0 ? Math.min((debtor.amountReceived / debtor.amountAssigned) * 100, 100) : 0}%` }"
                    />
                  </div>
                  <div class="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Recibido ${{ formatAmount(debtor.amountReceived) }} de ${{ formatAmount(debtor.amountAssigned) }}</span>
                    <span v-if="debtor.lastPaymentDate">Último pago: {{ formatDateChip(debtor.lastPaymentDate) }}</span>
                    <span v-else>Sin pagos todavía</span>
                  </div>
                </div>
              </template>
            </div>

            <Button variant="outline" class="w-full" @click="openAddDebtorSheet">
              <Plus class="size-4" /> Agregar persona
            </Button>
          </TabsContent>
        </Tabs>
      </template>
    </main>

    <LoanFormSheet v-model:open="isLoanSheetOpen" :loan="progressRow" />
    <LoanDebtorFormSheet
      v-if="loan"
      v-model:open="isDebtorSheetOpen"
      :loan-id="loanId"
      :existing-person-ids="loan.debtors.map(d => d.debtPersonId)"
      :loan-total-amount="loan.totalAmount"
      :assigned-total="loan.debtorsTotal"
    />
    <LoanDebtorPaymentFormSheet v-model:open="isPaymentSheetOpen" :debtor="paymentDebtor" />
  </div>
</template>
