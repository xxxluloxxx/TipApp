<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertCircle,
  ArrowLeft,
  EllipsisVertical,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Wallet,
} from '@lucide/vue'
import { formatExpenseDateHeading } from '@/lib/date'
import { formatAmount } from '@/lib/currency'
import { useAccountsStore } from '@/stores/accounts'
import { useDebtPeopleStore } from '@/stores/debtPeople'
import { useDebtsStore, type DebtMovementWithDebt } from '@/stores/debts'
import DebtFormSheet from '@/components/DebtFormSheet.vue'
import DebtMovementFormSheet from '@/components/DebtMovementFormSheet.vue'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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

// Sección 6 de debts-ux.md: detalle de un hilo de deuda. Vista de "segundo
// nivel" (vuelve a /deudas, no a Home), fetch propio (deep-link directo,
// mismo criterio que CardDetailView.vue).

const route = useRoute()
const router = useRouter()
const debtsStore = useDebtsStore()
const debtPeopleStore = useDebtPeopleStore()
const accountsStore = useAccountsStore()

const debtId = computed(() => String(route.params.id))
const debt = computed(() => debtsStore.debtById(debtId.value))
const summary = computed(() => debtsStore.summaryById(debtId.value))

const isInitialLoading = ref(true)
const loadError = ref(false)
const movements = ref<DebtMovementWithDebt[]>([])

async function loadAll() {
  loadError.value = false
  isInitialLoading.value = true
  try {
    const [debtsOk, balancesOk, peopleOk, accountsOk] = await Promise.all([
      debtsStore.fetchDebts(),
      debtsStore.fetchBalances(),
      debtPeopleStore.fetchPeople(),
      accountsStore.fetchAccounts(),
    ])

    if (!debtsOk || !balancesOk || !peopleOk || !accountsOk || !debt.value) {
      loadError.value = true
      return
    }

    // Sección 1.3/6.2: ledger completo de este hilo, sin filtro de fecha.
    const movementsRes = await debtsStore.fetchMovementsForDebt(debtId.value)
    if (movementsRes === null) {
      loadError.value = true
      return
    }
    movements.value = movementsRes
  } finally {
    isInitialLoading.value = false
  }
}

onMounted(loadAll)

function accountNameFor(movement: DebtMovementWithDebt): string | null {
  if (!movement.account_id) return null
  return accountsStore.accountById(movement.account_id)?.name ?? null
}

// Sección 6.2: verbo explícito según dirección + signo (todos los
// movimientos de este listado comparten la misma dirección — la del hilo).
function movementVerb(movement: DebtMovementWithDebt): string {
  const isLent = debt.value?.direction === 'lent'
  if (isLent) return movement.amount > 0 ? 'Prestaste más' : 'Te devolvieron'
  return movement.amount > 0 ? 'Te prestaron más' : 'Pagaste'
}

// Definido acá, no inline en el template: un `ref` referenciado por su
// nombre dentro de una expresión de template se auto-desenvuelve, mismo
// comentario que CardDetailView.vue/CardTransactionsView.vue.
const movementSyncTargets = [movements]

// Sheet de movimiento (sección 6.3/7).
const isMovementSheetOpen = ref(false)
const editingMovement = ref<DebtMovementWithDebt | null>(null)
const movementPresetKind = ref<'up' | 'down' | null>(null)

function openMovementSheet(kind: 'up' | 'down') {
  editingMovement.value = null
  movementPresetKind.value = kind
  isMovementSheetOpen.value = true
}
function openEditMovement(movement: DebtMovementWithDebt) {
  editingMovement.value = movement
  movementPresetKind.value = null
  isMovementSheetOpen.value = true
}

// Sheet de edición de cabecera (sección 6.5).
const isDebtSheetOpen = ref(false)
function openEditDebt() {
  isDebtSheetOpen.value = true
}

// Sección 6.5: sin guard de conteo, optimista, navega de vuelta a /deudas al
// confirmar.
function confirmDeleteDebt() {
  if (!debt.value) return
  debtsStore.deleteDebt(debt.value.id, movements.value)
  router.push({ name: 'debts' })
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <header class="flex items-center gap-3 border-b border-border px-4 py-4 sm:px-6 lg:px-8">
      <Button variant="ghost" size="icon" aria-label="Volver" @click="router.push({ name: 'debts' })">
        <ArrowLeft class="size-5" />
      </Button>
      <h1 class="flex-1 truncate text-xl font-semibold">
        {{ summary?.personName ?? 'Deuda' }}
      </h1>
      <DropdownMenu v-if="debt">
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="icon" aria-label="Opciones de la deuda">
            <EllipsisVertical class="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem @select="openEditDebt">
            <Pencil class="size-4" />
            Editar deuda
          </DropdownMenuItem>
          <AlertDialog>
            <AlertDialogTrigger as-child>
              <DropdownMenuItem variant="destructive" @select="(e: Event) => e.preventDefault()">
                <Trash2 class="size-4" />
                Eliminar deuda
              </DropdownMenuItem>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar esta deuda?</AlertDialogTitle>
                <AlertDialogDescription>
                  Se van a eliminar también sus {{ movements.length }} movimiento{{ movements.length === 1 ? '' : 's' }}.
                  Esta acción no se puede deshacer.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction @click="confirmDeleteDebt">
                  Eliminar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>

    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <!-- Estado de carga -->
      <template v-if="isInitialLoading">
        <Skeleton class="h-36 w-full rounded-xl" />
        <Skeleton class="h-64 w-full rounded-xl" />
      </template>

      <!-- Estado de error -->
      <template v-else-if="loadError">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <AlertCircle class="size-12 text-destructive" />
          <h2 class="text-lg font-semibold">
            No pudimos cargar esta deuda
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

      <template v-else-if="debt && summary">
        <!-- Sección 6.1: hero -->
        <Card>
          <CardHeader>
            <div class="flex items-start justify-between gap-2">
              <div class="flex flex-col gap-1">
                <CardDescription>{{ debt.direction === 'lent' ? 'Le presté a' : 'Me prestó' }}</CardDescription>
                <CardTitle class="text-xl font-semibold">
                  {{ summary.personName }}
                </CardTitle>
                <p v-if="debt.description" class="text-sm text-muted-foreground">
                  {{ debt.description }}
                </p>
              </div>
              <Badge :variant="summary.balance > 0 ? 'outline' : 'secondary'">
                {{ summary.balance > 0 ? 'Pendiente' : 'Saldada' }}
              </Badge>
            </div>

            <p class="mt-4 text-3xl font-bold tabular-nums tracking-tight sm:text-4xl">
              <span class="align-top text-sm font-normal text-muted-foreground">$</span>{{ formatAmount(Math.abs(summary.balance)) }}
            </p>
          </CardHeader>
        </Card>

        <!-- Sección 6.2: ledger de movimientos -->
        <Card>
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Movimientos
            </CardTitle>
          </CardHeader>

          <p v-if="movements.length === 0" class="px-6 pb-4 text-sm text-muted-foreground">
            Todavía no hay movimientos en este hilo.
          </p>
          <div v-else class="flex flex-col">
            <template v-for="(mov, idx) in movements" :key="mov.id">
              <Separator v-if="idx > 0" />
              <div class="flex items-center gap-3 px-4 py-3" :class="{ 'opacity-70': mov._pending }">
                <div class="flex min-w-0 flex-1 flex-col">
                  <p class="truncate text-sm font-medium">
                    {{ movementVerb(mov) }}
                  </p>
                  <p class="truncate text-xs text-muted-foreground">
                    {{ formatExpenseDateHeading(mov.movement_date) }}
                    <span v-if="mov.description"> · {{ mov.description }}</span>
                  </p>
                  <p v-if="mov.account_id" class="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <Wallet class="size-3" /> {{ accountNameFor(mov) }}
                  </p>
                </div>
                <p
                  class="shrink-0 text-sm font-semibold tabular-nums"
                  :class="mov.amount >= 0 ? 'text-foreground' : 'text-muted-foreground'"
                >
                  {{ mov.amount >= 0 ? '+' : '-' }}${{ formatAmount(Math.abs(mov.amount)) }}
                </p>
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button variant="ghost" size="icon" aria-label="Más acciones">
                      <EllipsisVertical class="size-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem @select="openEditMovement(mov)">
                      <Pencil class="size-4" />
                      Editar
                    </DropdownMenuItem>
                    <AlertDialog>
                      <AlertDialogTrigger as-child>
                        <DropdownMenuItem
                          variant="destructive"
                          :disabled="movements.length <= 1"
                          @select="(e: Event) => e.preventDefault()"
                        >
                          <Trash2 class="size-4" />
                          Eliminar
                        </DropdownMenuItem>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>¿Eliminar este movimiento?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Esta acción no se puede deshacer.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction @click="debtsStore.deleteMovement(debt!.id, mov.id, movementSyncTargets)">
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

    <!-- Sección 6.3: acciones -->
    <div v-if="!isInitialLoading && !loadError && debt" class="flex gap-3 px-4 pb-6 sm:px-6 lg:px-8">
      <Button variant="outline" class="flex-1" @click="openMovementSheet('down')">
        {{ debt.direction === 'lent' ? 'Cobrar / me devuelven' : 'Pagar / devolver' }}
      </Button>
      <Button class="flex-1" @click="openMovementSheet('up')">
        <Plus class="size-4" />
        {{ debt.direction === 'lent' ? 'Prestar más' : 'Me prestan más' }}
      </Button>
    </div>

    <DebtFormSheet v-model:open="isDebtSheetOpen" :debt="debt" />
    <DebtMovementFormSheet
      v-model:open="isMovementSheetOpen"
      :debt="debt ?? null"
      :movement="editingMovement"
      :preset-kind="movementPresetKind"
      :sync-targets="movementSyncTargets"
    />
  </div>
</template>
