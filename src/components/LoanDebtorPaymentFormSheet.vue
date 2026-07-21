<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { isFutureDate, todayDateInputValue } from '@/lib/date'
import { useLoansStore, type LoanDebtorItem } from '@/stores/loans'
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

const todayValue = computed(() => todayDateInputValue())

const form = reactive({
  amount: '',
  date: todayDateInputValue(),
})
const errors = reactive<{ amount?: string, date?: string }>({})

const dateInputRef = ref<HTMLInputElement | null>(null)

function resetForm() {
  errors.amount = undefined
  errors.date = undefined
  form.amount = ''
  form.date = todayDateInputValue()
}

watch(() => props.open, (isOpen) => {
  if (isOpen) resetForm()
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

function onSubmit() {
  if (!validate() || !props.debtor) return

  loansStore.registerPayment({
    loanDebtorId: props.debtor.loanDebtorId,
    amount: parseAmount(form.amount)!,
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
          <Label for="monto-pago">Monto</Label>
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
        <Button type="submit" form="loan-payment-form" class="w-full">
          Registrar pago
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
