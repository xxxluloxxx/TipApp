<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Info, Loader2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { currentMonthLabel, isFutureDate, todayDateInputValue } from '@/lib/date'
import { resolveAccountColor } from '@/lib/colors'
import { useAccountsStore } from '@/stores/accounts'
import { useExpensesStore } from '@/stores/expenses'
import { useIncomesStore } from '@/stores/incomes'
import { useFixedExpensesStore } from '@/stores/fixedExpenses'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { Textarea } from '@/components/ui/textarea'

// Sección 5 de fixed-expenses-ux.md: marcar como pagado. Sheet DISTINTO del de
// alta (acá no se edita la plantilla, se confirma un pago puntual del mes). NO
// optimista (sección 5.2, misma razón que `create_debt`): dependencia atómica
// entre crear el `expenses` real + marcar la instancia, resuelta server-side
// por el RPC `pay_fixed_expense_instance`.

export interface PayTarget {
  instanceId: string
  name: string
  /** Monto de la plantilla (prefill del campo Monto, editable). */
  amount: number
  notes: string | null
}

const props = withDefaults(defineProps<{
  open: boolean
  target?: PayTarget | null
}>(), {
  target: null,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const fixedExpensesStore = useFixedExpensesStore()
const accountsStore = useAccountsStore()
const expensesStore = useExpensesStore()
const incomesStore = useIncomesStore()

const todayValue = computed(() => todayDateInputValue())
const monthLabel = computed(() => currentMonthLabel())
const isDarkNow = computed(() => document.documentElement.classList.contains('dark'))

const form = reactive({
  accountId: '',
  amount: '',
  date: todayDateInputValue(),
  notes: '',
})

const errors = reactive<{ account?: string, amount?: string, date?: string }>({})
const isSaving = ref(false)

const accountTriggerRef = ref<{ $el?: HTMLElement } | null>(null)
const amountInputRef = ref<{ $el?: HTMLElement } | null>(null)
const dateInputRef = ref<HTMLInputElement | null>(null)

// Sección 5.1: default = la cuenta del movimiento más reciente (gasto o
// ingreso) si hay alguna cargada; si no, la cuenta "General"; si tampoco, la
// primera cuenta del usuario. Mismo criterio que `TransactionFormSheet`.
function defaultAccountId(): string {
  const lastExpense = expensesStore.expenses[0]
  const lastIncome = incomesStore.incomes[0]
  const mostRecent = [lastExpense, lastIncome]
    .filter((item): item is NonNullable<typeof item> => !!item)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]

  if (mostRecent) return mostRecent.account_id

  const general = accountsStore.accounts.find(a => a.name === 'General')
  return general?.id ?? accountsStore.accounts[0]?.id ?? ''
}

function resetForm() {
  errors.account = undefined
  errors.amount = undefined
  errors.date = undefined

  form.accountId = defaultAccountId()
  form.amount = props.target ? String(props.target.amount) : ''
  form.date = todayDateInputValue()
  form.notes = props.target?.notes ?? ''
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

function focusAccount() {
  accountTriggerRef.value?.$el?.focus()
}
function focusAmount() {
  amountInputRef.value?.$el?.focus()
}
function focusDate() {
  dateInputRef.value?.focus()
}

function validate(): boolean {
  errors.account = undefined
  errors.amount = undefined
  errors.date = undefined

  if (!form.accountId) {
    errors.account = 'Seleccioná una cuenta.'
    focusAccount()
    return false
  }

  const amount = parseAmount(form.amount)
  if (amount === null || amount <= 0) {
    errors.amount = 'Ingresá un monto mayor a 0.'
    focusAmount()
    return false
  }

  if (!form.date) {
    errors.date = 'Seleccioná una fecha.'
    focusDate()
    return false
  }

  if (isFutureDate(form.date)) {
    errors.date = 'La fecha no puede ser futura.'
    focusDate()
    return false
  }

  return true
}

function handleOpenChange(value: boolean) {
  emit('update:open', value)
}

// Sección 5.2: el Sheet no se puede cerrar (tap fuera / Escape) mientras el
// pago está en vuelo — hay un roundtrip atómico real, como en `DebtFormSheet`.
function preventCloseWhileSaving(event: Event) {
  if (isSaving.value) event.preventDefault()
}

async function onSubmit() {
  if (!props.target || !validate()) return

  isSaving.value = true
  try {
    const result = await fixedExpensesStore.payInstance({
      instanceId: props.target.instanceId,
      accountId: form.accountId,
      amount: parseAmount(form.amount)!,
      expenseDate: form.date,
      description: form.notes.trim() ? form.notes.trim() : null,
    })

    if ('error' in result) {
      toast.error('No pudimos registrar el pago', {
        description: 'Revisá tu conexión e intentá de nuevo.',
      })
      return
    }

    toast.success('Pago registrado', {
      description: `Se registró un gasto por ${props.target.name}.`,
    })
    emit('update:open', false)
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <Sheet :open="props.open" @update:open="handleOpenChange">
    <SheetContent
      side="bottom"
      :show-close-button="!isSaving"
      @escape-key-down="preventCloseWhileSaving"
      @interact-outside="preventCloseWhileSaving"
    >
      <SheetHeader>
        <SheetTitle>Marcar como pagado</SheetTitle>
        <SheetDescription v-if="props.target">
          {{ props.target.name }} · {{ monthLabel }}
        </SheetDescription>
      </SheetHeader>

      <Alert class="mx-4 w-auto">
        <Info class="size-4" />
        <AlertDescription>
          Esto va a registrar un gasto real en Transacciones y Estadísticas, con la cuenta
          y el monto que confirmes acá.
        </AlertDescription>
      </Alert>

      <form id="pay-fixed-expense-form" class="flex flex-col gap-4 px-4" novalidate @submit.prevent="onSubmit">
        <!-- 1. Cuenta (obligatorio) -->
        <div class="flex flex-col gap-1.5">
          <Label for="pay-cuenta">Cuenta</Label>
          <Select v-model="form.accountId" :disabled="isSaving">
            <SelectTrigger id="pay-cuenta" ref="accountTriggerRef" class="h-11 w-full" :aria-invalid="!!errors.account">
              <SelectValue placeholder="Seleccioná una cuenta" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="account in accountsStore.accounts" :key="account.id" :value="account.id">
                <span
                  class="size-2.5 rounded-full"
                  :style="{ background: resolveAccountColor(account.color ?? '#6b7280', isDarkNow) }"
                />
                {{ account.name }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p v-if="errors.account" class="text-xs text-destructive">
            {{ errors.account }}
          </p>
        </div>

        <!-- 2. Monto -->
        <div class="flex flex-col gap-1.5">
          <Label for="pay-monto">Monto</Label>
          <div class="flex items-center gap-1.5">
            <span class="text-sm text-muted-foreground">$</span>
            <Input
              id="pay-monto"
              ref="amountInputRef"
              v-model="form.amount"
              inputmode="decimal"
              type="text"
              placeholder="0"
              class="text-lg font-semibold tabular-nums"
              :disabled="isSaving"
              :aria-invalid="!!errors.amount"
            />
          </div>
          <p v-if="errors.amount" class="text-xs text-destructive">
            {{ errors.amount }}
          </p>
          <p class="text-xs text-muted-foreground">
            Ajustalo si este mes fue distinto (por ejemplo, la factura de luz).
          </p>
        </div>

        <!-- 3. Fecha -->
        <div class="flex flex-col gap-1.5">
          <Label for="pay-fecha">Fecha</Label>
          <input
            id="pay-fecha"
            ref="dateInputRef"
            v-model="form.date"
            type="date"
            :max="todayValue"
            :disabled="isSaving"
            :aria-invalid="!!errors.date"
            class="dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive h-9 w-full rounded-md border bg-transparent px-2.5 py-1 text-base shadow-xs outline-none transition-[color,box-shadow] focus-visible:ring-3 aria-invalid:ring-3 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
          >
          <p v-if="errors.date" class="text-xs text-destructive">
            {{ errors.date }}
          </p>
        </div>

        <!-- 4. Notas -->
        <div class="flex flex-col gap-1.5">
          <Label for="pay-notas">
            Notas <span class="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <Textarea
            id="pay-notas"
            v-model="form.notes"
            placeholder="Ej. Pagado por transferencia"
            maxlength="500"
            :disabled="isSaving"
          />
        </div>
      </form>

      <SheetFooter>
        <Button type="submit" form="pay-fixed-expense-form" class="w-full" :disabled="isSaving">
          <Loader2 v-if="isSaving" class="size-4 animate-spin" />
          {{ isSaving ? 'Guardando…' : 'Marcar como pagado' }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
