<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { isFutureDate, todayDateInputValue } from '@/lib/date'
import { useLoansStore, type LoanDebtorItem } from '@/stores/loans'
import { formatAmount } from '@/lib/currency'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAccountsStore } from '@/stores/accounts'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
const accountsStore = useAccountsStore()
// Lo que le debo a esta persona (dentro de Préstamos): permite compensar parte
// del pago contra eso (record_loan_debtor_payment).
const counterDebtRemaining = computed(() => props.debtor?.counterDebtRemaining ?? 0)
const isSaving = ref(false)

const todayValue = computed(() => todayDateInputValue())

const form = reactive({
  amount: '',
  offset: '',
  accountId: '',
  date: todayDateInputValue(),
})
const errors = reactive<{ amount?: string, offset?: string, date?: string, accountId?: string }>({})

// Efectivo que realmente entra = total - compensado.
const cashAmount = computed(() => {
  const total = parseAmount(form.amount) ?? 0
  const offset = form.offset.trim() ? (parseAmount(form.offset) ?? 0) : 0
  return Math.max(total - offset, 0)
})

const dateInputRef = ref<HTMLInputElement | null>(null)

function resetForm() {
  errors.amount = undefined
  errors.date = undefined
  errors.offset = undefined
  form.amount = ''
  form.offset = ''
  errors.accountId = undefined
  form.accountId = accountsStore.accounts[0]?.id ?? ''
  form.date = todayDateInputValue()
}

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    resetForm()
    if (accountsStore.accounts.length === 0) {
      void accountsStore.fetchAccounts().then(() => {
        if (!form.accountId) form.accountId = accountsStore.accounts[0]?.id ?? ''
      })
    }
  }
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
  if (offset > counterDebtRemaining.value) {
    errors.offset = `Le debés $${formatAmount(counterDebtRemaining.value)}; no podés compensar más.`
    return false
  }
  if (cashAmount.value > 0 && !form.accountId) {
    errors.accountId = 'Elegí la cuenta donde entra el efectivo.'
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

  // NO optimista: ingreso (efectivo) + pago + compensación en un solo RPC atómico.
  isSaving.value = true
  try {
    const cash = total - offset
    const result = await loansStore.registerPaymentWithOffset({
      loanDebtorId: props.debtor.loanDebtorId,
      cash,
      offset,
      paymentDate: form.date,
      accountId: cash > 0 ? form.accountId : null,
    })
    if ('error' in result) {
      toast.error('No pudimos registrar el pago', {
        description: 'Revisá tu conexión e intentá de nuevo.',
      })
      return
    }
    toast.success('Pago registrado', {
      description: [
        cash > 0 ? `Ingresaron $${formatAmount(cash)} a tu cuenta.` : '',
        offset > 0 ? `Se descontaron $${formatAmount(offset)} de lo que le debés.` : '',
      ].filter(Boolean).join(' '),
    })
    emit('update:open', false)
  } finally {
    isSaving.value = false
  }
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

        <div v-if="counterDebtRemaining > 0" class="flex flex-col gap-1.5">
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
            Le debés ${{ formatAmount(counterDebtRemaining) }}. Esta parte no entra como efectivo: se descuenta de esa deuda.
          </p>
        </div>

        <div v-if="cashAmount > 0" class="flex flex-col gap-1.5">
          <Label for="cuenta-pago">Cuenta donde entra ${{ formatAmount(cashAmount) }}</Label>
          <Select v-model="form.accountId">
            <SelectTrigger id="cuenta-pago" class="h-11 w-full" :aria-invalid="!!errors.accountId">
              <SelectValue placeholder="Seleccioná una cuenta" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="account in accountsStore.accounts" :key="account.id" :value="account.id">
                {{ account.name }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p v-if="errors.accountId" class="text-xs text-destructive">
            {{ errors.accountId }}
          </p>
          <p class="text-xs text-muted-foreground">Se registra como un ingreso en esa cuenta.</p>
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
