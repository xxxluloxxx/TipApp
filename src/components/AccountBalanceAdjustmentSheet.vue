<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { Loader2 } from '@lucide/vue'
import { todayDateInputValue } from '@/lib/date'
import { formatAmount } from '@/lib/currency'
import { DEFAULT_ACCOUNT_ICON } from '@/lib/accountIcons'
import { useAccountsStore, type Account, type AccountPayload } from '@/stores/accounts'
import { useCategoriesStore } from '@/stores/categories'
import { useExpensesStore } from '@/stores/expenses'
import { useIncomesStore } from '@/stores/incomes'
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

// Sección 5 de account-detail-ux.md: ajuste de saldo con las 2 opciones
// ("Ajustar mediante registro" / "Cambiar saldo inicial"), resuelto con el
// mismo vocabulario ya establecido del proyecto (`Sheet` inferior +
// `radiogroup` de 2 botones planos), no un `Dialog` nuevo. Ambas opciones
// reusan mutaciones ya existentes y 100% optimistas (`addExpense`/`addIncome`/
// `updateAccount`), sin ninguna RPC nueva.

type AdjustmentMode = 'record' | 'initial'

const props = defineProps<{
  open: boolean
  account: Account
  /** Saldo actual leído de `account_balances` (accountsStore.balanceFor). */
  currentBalance: number
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  /** Se emite tras un ajuste guardado (antes de cerrar) para que la vista
   * refresque saldo/gráfico/movimientos con el cambio ya aplicado. */
  saved: []
}>()

const accountsStore = useAccountsStore()
const categoriesStore = useCategoriesStore()
const expensesStore = useExpensesStore()
const incomesStore = useIncomesStore()

const form = reactive({
  mode: 'record' as AdjustmentMode,
  desiredBalance: '',
})
const errors = reactive<{ desiredBalance?: string }>({})
const isSaving = ref(false)

const desiredBalanceInputRef = ref<{ $el?: HTMLElement } | null>(null)

// Sección 5.5: la categoría "Ajuste de saldo" se resuelve por NOMBRE desde
// las categorías default (ya cargadas por la vista en su Promise.all), nunca
// por un id fijo hardcodeado.
const adjustmentCategoryId = computed(
  () => categoriesStore.defaultCategories.find(c => c.name === 'Ajuste de saldo')?.id ?? null,
)

/** Admite negativo (una cuenta puede tener saldo en descubierto), mismo regex
 * que "Saldo inicial" de `AccountFormSheet.vue`. `null` si inválido/vacío. */
function parseSignedAmount(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const normalized = trimmed.replace(',', '.')
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100
}

// Sección 5.2: vista previa de la diferencia, recalculada en cada tecleo.
const diff = computed<number | null>(() => {
  const desired = parseSignedAmount(form.desiredBalance)
  if (desired === null) return null
  return roundCurrency(desired - props.currentBalance)
})

const diffLabel = computed(() => {
  if (diff.value === null) return ''
  if (diff.value === 0) return 'Este ya es el saldo actual — no hay nada para ajustar.'
  const sign = diff.value > 0 ? '+' : '-'
  return `Diferencia: ${sign}$${formatAmount(Math.abs(diff.value))}`
})

const diffTextClass = computed(() => {
  if (diff.value === null || diff.value === 0) return 'text-muted-foreground'
  return diff.value > 0 ? 'text-success' : 'text-destructive'
})

function resetForm() {
  errors.desiredBalance = undefined
  form.mode = 'record'
  // Precargado con el saldo actual (sección 5.2): el usuario típicamente solo
  // corrige un dígito, no reescribe el número completo.
  form.desiredBalance = String(props.currentBalance)
}

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    resetForm()
    nextTick(() => desiredBalanceInputRef.value?.$el?.focus())
  }
})

function handleOpenChange(value: boolean) {
  emit('update:open', value)
}

function preventCloseWhileSaving(event: Event) {
  if (isSaving.value) event.preventDefault()
}

function submitRecordMode(currentDiff: number) {
  // Sección 5.3, opción 1: crear un gasto o ingreso por la diferencia.
  if (currentDiff < 0) {
    if (!adjustmentCategoryId.value) {
      errors.desiredBalance = 'No pudimos preparar el ajuste. Recargá la página e intentá de nuevo.'
      return false
    }
    expensesStore.addExpense({
      amount: Math.abs(currentDiff),
      categoryId: adjustmentCategoryId.value,
      accountId: props.account.id,
      description: null,
      expenseDate: todayDateInputValue(),
      // transaction-time-ux.md: el ajuste de saldo no es un evento con hora que
      // el usuario elija — sin campo de hora en este Sheet, se guarda `null`.
      expenseTime: null,
    })
  } else {
    incomesStore.addIncome({
      amount: currentDiff,
      accountId: props.account.id,
      description: null,
      incomeDate: todayDateInputValue(),
      incomeTime: null,
    })
  }
  return true
}

function submitInitialBalanceMode(currentDiff: number) {
  // Sección 5.3, opción 2: corregir `initial_balance` (lineal con coef. 1
  // sobre `account_balances.balance`), sin crear ningún movimiento.
  const payload: AccountPayload = {
    name: props.account.name,
    color: props.account.color ?? '',
    icon: props.account.icon ?? DEFAULT_ACCOUNT_ICON,
    initialBalance: props.account.initial_balance + currentDiff,
    transferCommission: props.account.transfer_commission,
  }
  accountsStore.updateAccount(props.account.id, payload)
  return true
}

function onSubmit() {
  errors.desiredBalance = undefined

  const currentDiff = diff.value
  if (currentDiff === null) {
    errors.desiredBalance = 'Ingresá un saldo válido.'
    return
  }
  // Sección 5.4: guard `diff === 0` (el botón ya está deshabilitado, backstop).
  if (currentDiff === 0) return

  isSaving.value = true
  try {
    const ok = form.mode === 'record'
      ? submitRecordMode(currentDiff)
      : submitInitialBalanceMode(currentDiff)

    if (!ok) return

    // Ambas mutaciones son optimistas (cierran de inmediato). Avisamos a la
    // vista para que refresque, y cerramos.
    emit('saved')
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
        <SheetTitle>Ajustar saldo</SheetTitle>
        <SheetDescription>
          Saldo actual: <span class="font-medium text-foreground">${{ formatAmount(props.currentBalance) }}</span>
        </SheetDescription>
      </SheetHeader>

      <form id="balance-adjustment-form" class="flex flex-col gap-4 px-4" novalidate @submit.prevent="onSubmit">
        <!-- 1. Tipo de ajuste -->
        <div class="flex flex-col gap-1.5">
          <Label id="tipo-ajuste-label">¿Cómo querés ajustarlo?</Label>
          <div role="radiogroup" aria-labelledby="tipo-ajuste-label" class="flex flex-col gap-2">
            <button
              type="button"
              role="radio"
              :aria-checked="form.mode === 'record'"
              class="flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :class="form.mode === 'record' ? 'border-primary bg-primary/5' : 'border-border'"
              :disabled="isSaving"
              @click="form.mode = 'record'"
            >
              <span class="text-sm font-medium">Ajustar mediante registro</span>
              <span class="text-xs text-muted-foreground">
                Creamos un gasto o ingreso por la diferencia, fechado hoy. Se guarda en tu historial.
              </span>
            </button>
            <button
              type="button"
              role="radio"
              :aria-checked="form.mode === 'initial'"
              class="flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :class="form.mode === 'initial' ? 'border-primary bg-primary/5' : 'border-border'"
              :disabled="isSaving"
              @click="form.mode = 'initial'"
            >
              <span class="text-sm font-medium">Cambiar saldo inicial</span>
              <span class="text-xs text-muted-foreground">
                Corregimos el saldo inicial de la cuenta. No se crea ningún movimiento nuevo.
              </span>
            </button>
          </div>
        </div>

        <!-- 2. Nuevo saldo -->
        <div class="flex flex-col gap-1.5">
          <Label for="nuevo-saldo">Saldo deseado</Label>
          <div class="flex items-center gap-1.5">
            <span class="text-sm text-muted-foreground">$</span>
            <Input
              id="nuevo-saldo"
              ref="desiredBalanceInputRef"
              v-model="form.desiredBalance"
              inputmode="decimal"
              type="text"
              placeholder="0"
              class="text-lg font-semibold tabular-nums"
              :disabled="isSaving"
              :aria-invalid="!!errors.desiredBalance"
            />
          </div>
          <p v-if="errors.desiredBalance" class="text-xs text-destructive">
            {{ errors.desiredBalance }}
          </p>
          <p v-else-if="diff !== null" class="text-xs" :class="diffTextClass">
            {{ diffLabel }}
          </p>
        </div>
      </form>

      <SheetFooter>
        <Button type="submit" form="balance-adjustment-form" class="w-full" :disabled="isSaving || diff === 0">
          <Loader2 v-if="isSaving" class="size-4 animate-spin" />
          {{ isSaving ? 'Guardando…' : 'Guardar ajuste' }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
