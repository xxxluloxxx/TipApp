<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertCircle,
  ArrowRightLeft,
  EllipsisVertical,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from '@lucide/vue'
import { supabase } from '@/lib/supabase'
import { useAccountsStore } from '@/stores/accounts'
import { useCategoriesStore } from '@/stores/categories'
import { useAccountTransfersStore, type AccountTransfer } from '@/stores/accountTransfers'
import {
  addMonths,
  currentMonthLabel,
  formatDateOnly,
  formatExpenseDateHeading,
  startOfMonth,
} from '@/lib/date'
import { formatAmount } from '@/lib/currency'
import AppHeader from '@/components/AppHeader.vue'
import AccountTransferFormSheet from '@/components/AccountTransferFormSheet.vue'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
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
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

// account-transfers-ux.md, secciones 2/3: ruta única `/transferencias`
// (dashboard + listado + alta en la misma pantalla, sin detalle). Listado
// agrupado por fecha calcado del patrón de `TransactionsView.vue`, guard de
// "al menos 2 cuentas" (sección 3.1), Card opcional de comisiones del mes
// (sección 3.2), FAB condicional (sección 3.7). Todas las mutaciones son NO
// optimistas (sección 4.3), resueltas en el store.

const router = useRouter()
const accountsStore = useAccountsStore()
const categoriesStore = useCategoriesStore()
const accountTransfersStore = useAccountTransfersStore()

const isInitialLoading = ref(true)
const loadError = ref(false)

// Sección 3.1: piso funcional de 2 cuentas para poder transferir.
const hasAtLeastTwoAccounts = computed(() => accountsStore.accounts.length >= 2)

async function loadAll() {
  loadError.value = false
  isInitialLoading.value = true
  try {
    const [transfersOk] = await Promise.all([
      accountTransfersStore.fetchAll(),
      accountsStore.fetchAccounts(),
      categoriesStore.fetchCategories(),
    ])
    if (!transfersOk) loadError.value = true
    else await loadCommissionsThisMonth()
  } finally {
    isInitialLoading.value = false
  }
}

// Sección 3.2/1.4: "Comisiones pagadas este mes" se resuelve con una query
// ACOTADA por mes contra `expenses`, filtrada por la categoría "Comisiones
// bancarias" — nunca sumando `accountTransfersStore.transfers` (recortado a
// 200). Card opcional: se oculta por completo si el total es 0.
const commissionsThisMonth = ref(0)
const transfersWithCommissionCount = ref(0)
const monthLabel = currentMonthLabel()

async function loadCommissionsThisMonth() {
  const category = categoriesStore.categories.find(c => c.name === 'Comisiones bancarias')
  if (!category) {
    commissionsThisMonth.value = 0
    transfersWithCommissionCount.value = 0
    return
  }

  const now = new Date()
  const from = formatDateOnly(startOfMonth(now))
  const to = formatDateOnly(addMonths(startOfMonth(now), 1))

  const { data, error } = await supabase
    .from('expenses')
    .select('amount')
    .eq('category_id', category.id)
    .gte('expense_date', from)
    .lt('expense_date', to)

  if (error || !data) {
    commissionsThisMonth.value = 0
    transfersWithCommissionCount.value = 0
    return
  }

  commissionsThisMonth.value = data.reduce((sum, row) => sum + (row.amount ?? 0), 0)
  transfersWithCommissionCount.value = data.length
}

onMounted(loadAll)

// Tras cualquier alta/edición/borrado (el store refetchea la lista) recalculamos
// el stat del mes, que vive fuera del store (query acotada propia de la vista).
watch(() => accountTransfersStore.transfers, () => {
  if (!isInitialLoading.value && !loadError.value) void loadCommissionsThisMonth()
})

const showMainActions = computed(() => !isInitialLoading.value && !loadError.value)
const isEmpty = computed(() => accountTransfersStore.transfers.length === 0)

// Agrupación visual por encabezado de fecha (sección 3.3).
interface TransferGroup { heading: string, items: AccountTransfer[] }
const groupedTransfers = computed<TransferGroup[]>(() => {
  const groups: TransferGroup[] = []
  for (const transfer of accountTransfersStore.transfers) {
    const heading = formatExpenseDateHeading(transfer.transfer_date)
    const last = groups.at(-1)
    if (last && last.heading === heading) {
      last.items.push(transfer)
    } else {
      groups.push({ heading, items: [transfer] })
    }
  }
  return groups
})

function accountName(id: string): string {
  return accountsStore.accountById(id)?.name ?? 'Cuenta'
}
function accountColor(id: string): string {
  return accountsStore.accountById(id)?.color ?? '#6b7280'
}

// Estado del Sheet de alta/edición.
const isSheetOpen = ref(false)
const editingTransfer = ref<AccountTransfer | null>(null)

function openAddSheet() {
  editingTransfer.value = null
  isSheetOpen.value = true
}
function openEditSheet(transfer: AccountTransfer) {
  editingTransfer.value = transfer
  isSheetOpen.value = true
}

// Borrado NO optimista (sección 4.3): AlertDialog controlado, permanece en
// "Eliminando…" hasta la respuesta real. El botón de confirmación es un
// `<Button>` común (no `AlertDialogAction`) para evitar el auto-cierre de
// Reka mientras el roundtrip está en vuelo.
const isDeleteDialogOpen = ref(false)
const transferToDelete = ref<AccountTransfer | null>(null)
const isDeleting = ref(false)

function requestDelete(transfer: AccountTransfer) {
  transferToDelete.value = transfer
  isDeleteDialogOpen.value = true
}

function onDeleteDialogChange(open: boolean) {
  if (isDeleting.value) return
  isDeleteDialogOpen.value = open
  if (!open) transferToDelete.value = null
}

async function confirmDelete() {
  if (!transferToDelete.value) return
  isDeleting.value = true
  const ok = await accountTransfersStore.deleteTransfer(transferToDelete.value.id)
  isDeleting.value = false
  if (ok) {
    isDeleteDialogOpen.value = false
    transferToDelete.value = null
  }
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <AppHeader title="Transferencias" />

    <main class="mx-auto flex max-w-md flex-col gap-6 px-4 py-6 pb-28 sm:px-6 lg:px-8">
      <!-- Estado de carga -->
      <template v-if="isInitialLoading">
        <div class="flex flex-col gap-3">
          <Card v-for="i in 4" :key="i" class="p-4 sm:p-6">
            <div class="flex items-center justify-between gap-3">
              <div class="flex flex-col gap-2">
                <Skeleton class="h-4 w-40" />
                <Skeleton class="h-4 w-24" />
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
            No pudimos cargar tus transferencias
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

      <!-- Estado vacío A: menos de 2 cuentas (sección 3.6 variante A) -->
      <template v-else-if="!hasAtLeastTwoAccounts">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <ArrowRightLeft class="size-12 text-muted-foreground" />
          <h2 class="text-lg font-semibold">
            Necesitás al menos 2 cuentas
          </h2>
          <p class="max-w-xs text-center text-sm text-muted-foreground">
            Para transferir plata entre cuentas, primero necesitás tener dos o más creadas.
          </p>
          <Button @click="router.push({ name: 'accounts', query: { new: '1' } })">
            Crear otra cuenta
          </Button>
        </div>
      </template>

      <!-- Estado vacío B: 2+ cuentas, sin transferencias (sección 3.6 variante B) -->
      <template v-else-if="isEmpty">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <ArrowRightLeft class="size-12 text-muted-foreground" />
          <h2 class="text-lg font-semibold">
            Todavía no hiciste ninguna transferencia
          </h2>
          <p class="max-w-xs text-center text-sm text-muted-foreground">
            Mové plata entre tus cuentas cuando lo necesites, con o sin comisión.
          </p>
          <Button @click="openAddSheet">
            Nueva transferencia
          </Button>
        </div>
      </template>

      <!-- Con datos -->
      <template v-else>
        <!-- Card opcional de comisiones del mes (sección 3.2) -->
        <Card v-if="commissionsThisMonth > 0">
          <CardHeader>
            <CardTitle class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Comisiones pagadas · {{ monthLabel }}
            </CardTitle>
          </CardHeader>
          <div class="px-4 pb-4 sm:px-6 sm:pb-6">
            <p class="text-2xl font-bold tabular-nums tracking-tight">
              ${{ formatAmount(commissionsThisMonth) }}
            </p>
            <p class="text-xs text-muted-foreground">
              {{ transfersWithCommissionCount }} transferencia{{ transfersWithCommissionCount === 1 ? '' : 's' }} con comisión
            </p>
          </div>
        </Card>

        <!-- Listado agrupado por fecha (sección 3.3) -->
        <section class="flex flex-col gap-3">
          <template v-for="(group, idx) in groupedTransfers" :key="`${group.heading}-${idx}`">
            <Separator v-if="idx > 0" />
            <span class="text-xs font-medium text-muted-foreground">{{ group.heading }}</span>

            <Card
              v-for="transfer in group.items"
              :key="transfer.id"
              class="p-4 sm:p-6"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="flex min-w-0 flex-col gap-2">
                  <div class="flex items-center gap-2 text-sm">
                    <span class="flex min-w-0 items-center gap-1.5 truncate font-medium">
                      <span
                        class="size-2.5 shrink-0 rounded-full"
                        :style="{ backgroundColor: accountColor(transfer.from_account_id) }"
                      />
                      <span class="truncate">{{ accountName(transfer.from_account_id) }}</span>
                    </span>
                    <ArrowRightLeft class="size-3.5 shrink-0 text-muted-foreground" />
                    <span class="flex min-w-0 items-center gap-1.5 truncate font-medium">
                      <span
                        class="size-2.5 shrink-0 rounded-full"
                        :style="{ backgroundColor: accountColor(transfer.to_account_id) }"
                      />
                      <span class="truncate">{{ accountName(transfer.to_account_id) }}</span>
                    </span>
                  </div>
                  <p v-if="transfer.description" class="truncate text-xs text-muted-foreground">
                    {{ transfer.description }}
                  </p>
                  <p v-if="transfer.commission_amount > 0" class="text-xs text-muted-foreground">
                    Comisión: ${{ formatAmount(transfer.commission_amount) }}
                  </p>
                </div>

                <div class="flex shrink-0 items-center gap-1">
                  <p class="text-sm font-semibold tabular-nums">
                    ${{ formatAmount(transfer.amount) }}
                  </p>
                  <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                      <Button variant="ghost" size="icon" aria-label="Más acciones para esta transferencia">
                        <EllipsisVertical class="size-5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem @select="openEditSheet(transfer)">
                        <Pencil class="size-4" />
                        Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" @select="requestDelete(transfer)">
                        <Trash2 class="size-4" />
                        Eliminar
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </Card>
          </template>
        </section>
      </template>
    </main>

    <!-- FAB: sólo con 2+ cuentas (sección 3.7) -->
    <Button
      v-if="showMainActions && hasAtLeastTwoAccounts"
      size="icon"
      class="fixed right-4 h-14 w-14 rounded-full shadow-[var(--shadow-elevated)] sm:right-6"
      style="bottom: calc(1.5rem + env(safe-area-inset-bottom))"
      aria-label="Nueva transferencia"
      @click="openAddSheet"
    >
      <Plus class="size-6" />
    </Button>

    <AccountTransferFormSheet v-model:open="isSheetOpen" :transfer="editingTransfer" />

    <!-- Confirmación de borrado, controlada, no optimista (sección 4.3) -->
    <AlertDialog :open="isDeleteDialogOpen" @update:open="onDeleteDialogChange">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar esta transferencia?</AlertDialogTitle>
          <AlertDialogDescription v-if="transferToDelete">
            Se va a revertir el movimiento entre "{{ accountName(transferToDelete.from_account_id) }}" y
            "{{ accountName(transferToDelete.to_account_id) }}"<span v-if="transferToDelete.commission_amount > 0">, y se va a eliminar el gasto de comisión asociado</span>.
            Esta acción no se puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="isDeleting">
            Cancelar
          </AlertDialogCancel>
          <Button variant="destructive" :disabled="isDeleting" @click="confirmDelete">
            <Loader2 v-if="isDeleting" class="size-4 animate-spin" />
            {{ isDeleting ? 'Eliminando…' : 'Eliminar' }}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
