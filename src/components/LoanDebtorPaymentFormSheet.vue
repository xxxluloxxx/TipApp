<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { isFutureDate, todayDateInputValue } from '@/lib/date'
import { useLoansStore, type LoanDebtorItem } from '@/stores/loans'
import { useDebtsStore } from '@/stores/debts'
import { formatAmount } from '@/lib/currency'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

// Sección 8.3 de loans-ux.md: registrar un pago recibido de una persona. Sin
// prefill de monto (puede pagar cualquier parcial). Guardado optimista con
// "delta seguro" sobre el saldo ya confirmado. Sin guard de sobrepago (mismo
// criterio ya aceptado en Deudas).

const props = defineProps<{
  open: boolean
  debtor: LoanDebtorItem | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const loansStore = useLoansStore()
const debtsStore = useDebtsStore()

// Deuda mía con esta persona (direction 'borrowed', saldo > 0): habilita
// compensar parte del pago contra ella (record_loan_debtor_payment).
const offsetDebt = computed(() =>
  props.debtor
    ? debtsStore.borrowedDebts.find(d => d.personId === props.debtor!.debtPersonId && d.balance > 0) ?? null
    : null,
)
const isSaving = ref(false)

const todayValue = computed(() => todayDateInputValue())

const form = reactive({
  amount: '',
  offset: '',
  date: todayDateInputValue(),
})
const errors = reactive<{ amount?: string, offset?: string, date?: string }>({})

const dateInputRef = ref<HTMLInputElement | null>(null)

function resetForm() {
  errors.amount = undefined
  errors.date = undefined
  errors.offset = undefined
  form.amount = ''
  form.offset = ''
  form.date = todayDateInputValue()
}

watch(() => props.open, (isOpen) => {
  if (!isOpen) return
  resetForm()
  void debtsStore.fetchDebts().then(ok => ok && debtsStore.fetchBalances())
})

function parseAmount(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const normalized = trimmed.replace(',', '.')
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

function validate(): boolean {
  errors.amount = undefined
  errors.date = undefined

  const amount = parseAmount(form.amount)
  if (amount === null || amount <= 0) {
    errors.amount = 'Ingresá un monto mayor a 0.'
    return false
  }
  const offset = form.offset.trim() ? parseAmount(form.offset) : 0
  if (offset === null || offset < 0 || offset > amount) {
    errors.offset = 'Ingresá un monto entre 0 y el total del pago.'
    return false
  }
  if (offset > 0 && !offsetDebt.value) {
    errors.offset = 'No tenés una deuda con esta persona para compensar.'
    return false
  }
  if (!form.date) {
    errors.date = 'Seleccioná una fecha.'
    return false
  }
  if (isFutureDate(form.date)) {
    errors.date = 'La fecha no puede ser futura.'
    return false
  }
  return true
}

function handleOpenChange(value: boolean) {
  emit('update:open', value)
}

async function onSubmit() {
  if (!validate() || !props.debtor) return

  const total = parseAmount(form.amount)!
  const offset = form.offset.trim() ? parseAmount(form.offset)! : 0

  if (offset > 0 && offsetDebt.value) {
    // NO optimista: pago + abono en Deudas en un solo RPC atómico.
    isSaving.value = true
    try {
      const result = await loansStore.registerPaymentWithOffset({
        loanDebtorId: props.debtor.loanDebtorId,
        cash: total - offset,
        offset,
        debtId: offsetDebt.value.id,
        paymentDate: form.date,
      })
      if ('error' in result) {
        toast.error('No pudimos registrar el pago', {
          description: 'Revisá tu conexión e intentá de nuevo.',
        })
        return
      }
      toast.success('Pago registrado', {
        description: `Se abonaron ${'$' + formatAmount(offset)} a tu deuda.`,
      })
      emit('update:open', false)
    } finally {
      isSaving.value = false
    }
    return
  }

  loansStore.registerPayment({
    loanDebtorId: props.debtor.loanDebtorId,
    amount: total,
    paymentDate: form.date,
  })
  emit('update:open', false)
}
</script>

<template>
  <Sheet :open="props.open" @update:open="handleOpenChange">
    <SheetContent side="bottom">
      <SheetHeader>
        <SheetTitle>Registrar pago recibido</SheetTitle>
        <SheetDescription>{{ debtor?.person.name }} · este préstamo</SheetDescription>
      </SheetHeader>

      <form id="loan-payment-form" class="flex flex-col gap-4 px-4" novalidate @submit.prevent="onSubmit">
        <div class="flex flex-col gap-1.5">
          <Label for="monto-pago">Monto total del pago</Label>
          <div class="flex items-center gap-1.5">
            <span class="text-sm text-muted-foreground">$</span>
            <Input
              id="monto-pago"
              v-model="form.amount"
              inputmode="decimal"
              type="text"
              placeholder="0"
              class="text-lg font-semibold tabular-nums"
              :aria-invalid="!!errors.amount"
            />
          </div>
          <p v-if="errors.amount" class="text-xs text-destructive">
            {{ errors.amount }}
          </p>
        </div>

        <div v-if="offsetDebt" class="flex flex-col gap-1.5">
          <Label for="monto-compensado">
            Compensado con lo que le debo <span class="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <div class="flex items-center gap-1.5">
            <span class="text-sm text-muted-foreground">$</span>
            <Input
              id="monto-compensado"
              v-model="form.offset"
              inputmode="decimal"
              type="text"
              placeholder="0"
              class="tabular-nums"
              :aria-invalid="!!errors.offset"
            />
          </div>
          <p v-if="errors.offset" class="text-xs text-destructive">
            {{ errors.offset }}
          </p>
          <p class="text-xs text-muted-foreground">
            Le debés ${{ formatAmount(offsetDebt.balance) }}. Esta parte no entra como efectivo: se abona a esa deuda.
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="fecha-pago">Fecha</Label>
          <input
            id="fecha-pago"
            ref="dateInputRef"
            v-model="form.date"
            type="date"
            :max="todayValue"
            :aria-invalid="!!errors.date"
            class="dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive h-9 w-full rounded-md border bg-transparent px-2.5 py-1 text-base shadow-xs outline-none transition-[color,box-shadow] focus-visible:ring-3 aria-invalid:ring-3 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
          >
          <p v-if="errors.date" class="text-xs text-destructive">
            {{ errors.date }}
          </p>
        </div>
      </form>

      <SheetFooter>
        <Button type="submit" form="loan-payment-form" class="w-full" :disabled="isSaving">
          {{ isSaving ? 'Guardando…' : 'Registrar pago' }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
