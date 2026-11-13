<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AlertCircle, Check, ChevronDown, Loader2, PiggyBank, Plus, RotateCcw, Trash2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import AppHeader from '@/components/AppHeader.vue'
import SavingsPlanFormSheet from '@/components/SavingsPlanFormSheet.vue'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { formatAmount } from '@/lib/currency'
import { formatExpenseDateHeading, nowTimeInputValue, todayDateInputValue } from '@/lib/date'
import { useAccountsStore } from '@/stores/accounts'
import { useSavingsPlansStore, type SavingsInstallment, type SavingsPlan } from '@/stores/savingsPlans'

// Ahorro programado: cuotas mensuales que mueven plata de una cuenta a otra.
// Cada cuota se confirma a mano y genera una transferencia real.

const accountsStore = useAccountsStore()
const store = useSavingsPlansStore()

const isLoading = ref(true)
const loadError = ref(false)
const formOpen = ref(false)
const expandedId = ref<string | null>(null)
const payingId = ref<string | null>(null)
const planToDelete = ref<SavingsPlan | null>(null)
const isDeleting = ref(false)

const hasAtLeastTwoAccounts = computed(() => accountsStore.accounts.length >= 2)

async function loadAll() {
  loadError.value = false
  isLoading.value = true
  try {
    const [ok] = await Promise.all([store.fetchAll(), accountsStore.fetchAccounts()])
    if (!ok) loadError.value = true
  } finally {
    isLoading.value = false
  }
}
onMounted(loadAll)

const accountName = (id: string) => accountsStore.accounts.find(a => a.id === id)?.name ?? '-'

function isOverdue(due: string): boolean {
  return due < todayDateInputValue()
}

function progressOf(plan: SavingsPlan) {
  const p = store.progress[plan.id]
  return {
    done: p?.done_count ?? 0,
    total: p?.total_count ?? plan.term_months,
    saved: p?.saved_amount ?? 0,
    totalAmount: p?.total_amount ?? plan.amount * plan.term_months,
    next: p?.next_due_date ?? null,
  }
}

async function toggle(plan: SavingsPlan) {
  if (expandedId.value === plan.id) {
    expandedId.value = null
    return
  }
  expandedId.value = plan.id
  if (!store.installments[plan.id]) await store.fetchInstallments(plan.id)
}

async function pay(installment: SavingsInstallment) {
  payingId.value = installment.id
  try {
    // Se registra con la fecha y hora de hoy: es cuando el usuario confirma
    // el movimiento, y así aparece entre los recientes de la cuenta.
    const ok = await store.payInstallment(installment, todayDateInputValue(), nowTimeInputValue())
    if (ok) toast.success('Cuota registrada', { description: 'Se creó la transferencia entre las dos cuentas.' })
    else toast.error('No se pudo registrar la cuota', { description: 'Revisa tu conexión e intenta de nuevo.' })
  } finally {
    payingId.value = null
  }
}

async function markDone(installment: SavingsInstallment) {
  payingId.value = installment.id
  try {
    const ok = await store.markInstallmentDone(installment)
    if (ok) toast.success('Cuota marcada como hecha', { description: 'No se tocaron los saldos de tus cuentas.' })
    else toast.error('No se pudo marcar la cuota', { description: 'Revisa tu conexión e intenta de nuevo.' })
  } finally {
    payingId.value = null
  }
}

async function confirmDelete() {
  if (!planToDelete.value) return
  isDeleting.value = true
  try {
    const ok = await store.deletePlan(planToDelete.value.id)
    if (ok) {
      toast.success('Ahorro eliminado')
      planToDelete.value = null
    } else {
      toast.error('No se pudo eliminar el ahorro')
    }
  } finally {
    isDeleting.value = false
  }
}
</script>

<template>
  <div class="min-h-svh bg-background">
    <AppHeader title="Ahorro programado" />

    <main class="mx-auto flex max-w-md flex-col gap-4 px-4 py-6 pb-28 sm:px-6 lg:px-8">
      <template v-if="isLoading">
        <Card v-for="i in 2" :key="i" class="p-4"><Skeleton class="h-16 w-full" /></Card>
      </template>

      <div v-else-if="loadError" class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <AlertCircle class="size-12 text-destructive" />
        <h2 class="text-lg font-semibold">No pudimos cargar tus ahorros</h2>
        <Button variant="outline" @click="loadAll"><RotateCcw class="size-4" /> Reintentar</Button>
      </div>

      <div v-else-if="!hasAtLeastTwoAccounts" class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <PiggyBank class="size-12 text-muted-foreground" />
        <h2 class="text-lg font-semibold">Necesitas al menos 2 cuentas</h2>
        <p class="max-w-xs text-sm text-muted-foreground">Crea la cuenta de ahorro (la que no puedes tocar) para poder programar el ahorro.</p>
      </div>

      <div v-else-if="store.plans.length === 0" class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <PiggyBank class="size-12 text-muted-foreground" />
        <h2 class="text-lg font-semibold">Aún no tienes ahorros programados</h2>
        <p class="max-w-xs text-sm text-muted-foreground">Registra el ahorro que te descuentan cada mes de una cuenta hacia otra.</p>
        <Button @click="formOpen = true">Nuevo ahorro</Button>
      </div>

      <template v-else>
        <Card v-for="plan in store.plans" :key="plan.id" class="p-4">
          <div class="flex flex-col gap-3">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="truncate font-semibold">{{ plan.name }}</p>
                <p class="truncate text-xs text-muted-foreground">
                  {{ accountName(plan.from_account_id) }} → {{ accountName(plan.to_account_id) }}
                </p>
                <p class="text-xs text-muted-foreground">
                  ${{ formatAmount(plan.amount) }} · día {{ plan.day_of_month }} · {{ plan.term_months }} meses
                </p>
              </div>
              <Button variant="ghost" size="icon" aria-label="Eliminar ahorro" @click="planToDelete = plan">
                <Trash2 class="size-4" />
              </Button>
            </div>

            <div class="flex flex-col gap-1">
              <div class="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  class="h-full rounded-full bg-primary"
                  :style="{ width: `${Math.round((progressOf(plan).done / Math.max(progressOf(plan).total, 1)) * 100)}%` }"
                />
              </div>
              <div class="flex justify-between text-xs text-muted-foreground">
                <span>${{ formatAmount(progressOf(plan).saved) }} de ${{ formatAmount(progressOf(plan).totalAmount) }}</span>
                <span>{{ progressOf(plan).done }}/{{ progressOf(plan).total }} cuotas</span>
              </div>
              <p v-if="progressOf(plan).next" class="text-xs" :class="isOverdue(progressOf(plan).next!) ? 'font-medium text-destructive' : 'text-muted-foreground'">
                {{ isOverdue(progressOf(plan).next!) ? 'Cuota vencida: ' : 'Próxima cuota: ' }}{{ formatExpenseDateHeading(progressOf(plan).next!) }}
              </p>
              <p v-else class="text-xs font-medium text-success">Ahorro completado</p>
            </div>

            <Button variant="outline" size="sm" class="w-full" @click="toggle(plan)">
              {{ expandedId === plan.id ? 'Ocultar cuotas' : 'Ver cuotas' }}
              <ChevronDown class="size-4 transition-transform" :class="{ 'rotate-180': expandedId === plan.id }" />
            </Button>

            <div v-if="expandedId === plan.id" class="flex flex-col">
              <Skeleton v-if="!store.installments[plan.id]" class="h-24 w-full" />
              <template v-else>
                <template v-for="(inst, idx) in store.installments[plan.id]" :key="inst.id">
                  <Separator v-if="idx > 0" />
                  <div class="flex items-center gap-3 py-2">
                    <div class="flex min-w-0 flex-1 flex-col">
                      <p class="text-sm font-medium">Cuota {{ inst.installment_number }} · ${{ formatAmount(inst.amount) }}</p>
                      <p class="text-xs" :class="inst.status === 'pending' && isOverdue(inst.due_date) ? 'font-medium text-destructive' : 'text-muted-foreground'">
                        {{ formatExpenseDateHeading(inst.due_date) }}
                        <template v-if="inst.status === 'pending' && isOverdue(inst.due_date)"> · Vencida</template>
                      </p>
                    </div>
                    <span v-if="inst.status === 'done'" class="flex items-center gap-1 text-xs font-medium text-success">
                      <Check class="size-4" /> Hecha
                    </span>
                    <div v-else class="flex shrink-0 items-center gap-1.5">
                      <Button
                        v-if="isOverdue(inst.due_date)"
                        variant="ghost"
                        size="sm"
                        :disabled="payingId !== null"
                        title="Ya me la descontaron antes: marcar sin tocar los saldos"
                        @click="markDone(inst)"
                      >
                        Ya descontada
                      </Button>
                      <Button size="sm" :disabled="payingId !== null" @click="pay(inst)">
                        <Loader2 v-if="payingId === inst.id" class="size-4 animate-spin" />
                        Registrar
                      </Button>
                    </div>
                  </div>
                </template>
              </template>
            </div>
          </div>
        </Card>
      </template>
    </main>

    <Button
      v-if="!isLoading && !loadError && hasAtLeastTwoAccounts && store.plans.length > 0"
      size="icon"
      class="fixed right-4 h-14 w-14 rounded-full shadow-[var(--shadow-elevated)] sm:right-6"
      style="bottom: calc(4.5rem + env(safe-area-inset-bottom))"
      aria-label="Nuevo ahorro programado"
      @click="formOpen = true"
    >
      <Plus class="size-6" />
    </Button>

    <SavingsPlanFormSheet v-model:open="formOpen" />

    <AlertDialog :open="!!planToDelete" @update:open="(v: boolean) => { if (!v && !isDeleting) planToDelete = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar este ahorro?</AlertDialogTitle>
          <AlertDialogDescription>
            Se borra el plan y sus cuotas pendientes. Las transferencias ya registradas se conservan.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="isDeleting">Cancelar</AlertDialogCancel>
          <Button variant="destructive" :disabled="isDeleting" @click="confirmDelete">
            <Loader2 v-if="isDeleting" class="size-4 animate-spin" />
            {{ isDeleting ? 'Eliminando…' : 'Eliminar' }}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
