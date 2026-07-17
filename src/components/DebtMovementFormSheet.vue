<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { Loader2 } from '@lucide/vue'
import { isFutureDate, todayDateInputValue } from '@/lib/date'
import { useAccountsStore } from '@/stores/accounts'
import { useDebtsStore, type Debt, type DebtMovementWithDebt } from '@/stores/debts'
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
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

// Sección 7 de debts-ux.md: alta/edición de movimiento sobre un hilo ya
// existente. A diferencia de DebtFormSheet (alta de hilo), acá SÍ se sigue
// el patrón por defecto del proyecto: 100% optimista (sección 7.2, "delta
// seguro" sobre un balance ya confirmado — ver `debtsStore`).

type MovementKind = 'up' | 'down'

const props = withDefaults(defineProps<{
  open: boolean
  /** Hilo dueño del movimiento — siempre requerido, a diferencia de otros
   * Sheets del proyecto acá no tiene sentido un movimiento "sin hilo". */
  debt: Debt | null
  /** Movimiento a editar. `null`/`undefined` = modo alta. */
  movement?: DebtMovementWithDebt | null
  /** Preselección del toggle según qué botón del detalle abrió el Sheet
   * ("Ampliar"/"Abonar", sección 6.3) — siempre editable dentro del Sheet,
   * mismo criterio que "el botón preselecciona, nunca bloquea" ya usado en
   * el resto del proyecto. */
  presetKind?: MovementKind | null
  /** `ref`s locales de la vista a mantener sincronizados (mismo patrón que
   * `cardExpenses.ts`, sección 1 de credit-cards-ux.md: este store tampoco
   * mantiene una lista maestra de movimientos). */
  syncTargets?: Ref<DebtMovementWithDebt[]>[]
}>(), {
  movement: null,
  presetKind: null,
  syncTargets: () => [],
})

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const debtsStore = useDebtsStore()
const accountsStore = useAccountsStore()

const isEditing = computed(() => !!props.movement)
const todayValue = computed(() => todayDateInputValue())

// Sección 7.1: copy dependiente de la dirección del hilo dueño.
const kindLabels = computed(() => {
  const isLent = props.debt?.direction === 'lent'
  return {
    down: isLent ? 'Cobro / me devuelven' : 'Pago / devuelvo',
    up: isLent ? 'Presto más' : 'Me prestan más',
  }
})

const form = reactive({
  kind: 'up' as MovementKind,
  amount: '',
  date: todayDateInputValue(),
  description: '',
  accountId: null as string | null,
})

const errors = reactive<{ amount?: string, date?: string }>({})
const isSaving = ref(false)

const amountInputRef = ref<{ $el?: HTMLElement } | null>(null)
const dateInputRef = ref<HTMLInputElement | null>(null)

function resetForm() {
  errors.amount = undefined
  errors.date = undefined

  if (props.movement) {
    // Sección 7.1: se precarga en los mismos términos "positivo + toggle" en
    // los que originalmente se cargó — el usuario nunca ve el número crudo
    // con signo.
    form.kind = props.movement.amount >= 0 ? 'up' : 'down'
    form.amount = String(Math.abs(props.movement.amount))
    form.date = props.movement.movement_date
    form.description = props.movement.description ?? ''
    form.accountId = props.movement.account_id
  } else {
    form.kind = props.presetKind ?? 'up'
    form.amount = ''
    form.date = todayDateInputValue()
    form.description = ''
    form.accountId = null
  }
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

function focusAmount() {
  amountInputRef.value?.$el?.focus()
}
function focusDate() {
  dateInputRef.value?.focus()
}

function validate(): boolean {
  errors.amount = undefined
  errors.date = undefined

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

function onSubmit() {
  if (!props.debt || !validate()) return

  isSaving.value = true
  try {
    const amount = parseAmount(form.amount)!
    // Sección 7.1: el usuario nunca tipea un número negativo — el toggle
    // decide el signo recién acá, al construir el payload.
    const signedAmount = form.kind === 'down' ? -amount : amount

    const payload = {
      debtId: props.debt.id,
      amount: signedAmount,
      movementDate: form.date,
      description: form.description.trim() ? form.description.trim() : null,
      accountId: form.accountId,
    }

    if (props.movement) {
      debtsStore.updateMovement(props.movement.id, payload, props.syncTargets)
    } else {
      debtsStore.addMovement(payload, props.syncTargets)
    }

    // Sección 7.2: 100% optimista, el Sheet se cierra de inmediato.
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
        <SheetTitle>{{ isEditing ? 'Editar movimiento' : 'Nuevo movimiento' }}</SheetTitle>
      </SheetHeader>

      <form id="debt-movement-form" class="flex flex-col gap-4 px-4" novalidate @submit.prevent="onSubmit">
        <div class="flex flex-col gap-1.5">
          <Label id="tipo-movimiento-label">Tipo de movimiento</Label>
          <div role="radiogroup" aria-labelledby="tipo-movimiento-label" class="flex gap-1 rounded-md bg-muted p-1">
            <button
              type="button"
              role="radio"
              :aria-checked="form.kind === 'down'"
              class="flex-1 rounded-sm px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              :class="form.kind === 'down' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
              :disabled="isSaving"
              @click="form.kind = 'down'"
            >
              {{ kindLabels.down }}
            </button>
            <button
              type="button"
              role="radio"
              :aria-checked="form.kind === 'up'"
              class="flex-1 rounded-sm px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              :class="form.kind === 'up' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
              :disabled="isSaving"
              @click="form.kind = 'up'"
            >
              {{ kindLabels.up }}
            </button>
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="monto-movimiento">Monto</Label>
          <div class="flex items-center gap-1.5">
            <span class="text-sm text-muted-foreground">$</span>
            <Input
              id="monto-movimiento"
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
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="fecha-movimiento">Fecha</Label>
          <input
            id="fecha-movimiento"
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

        <div class="flex flex-col gap-1.5">
          <Label for="descripcion-movimiento">
            Descripción <span class="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <Input
            id="descripcion-movimiento"
            v-model="form.description"
            placeholder="Ej. Transferencia"
            maxlength="200"
            :disabled="isSaving"
          />
        </div>

        <!-- Sección 5.3/7.3: mismo campo, mismo copy literal, reusado tal
        cual desde DebtFormSheet. -->
        <div class="flex flex-col gap-1.5">
          <Label for="cuenta-movimiento">Cuenta (opcional)</Label>
          <Select v-model="form.accountId" :disabled="isSaving">
            <SelectTrigger id="cuenta-movimiento" class="h-11 w-full">
              <SelectValue placeholder="Sin cuenta" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="null">
                Sin cuenta
              </SelectItem>
              <SelectItem v-for="account in accountsStore.accounts" :key="account.id" :value="account.id">
                {{ account.name }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p class="text-xs text-muted-foreground">
            Si vinculás una cuenta, ajustamos su saldo automáticamente por la plata real que sale o entra —
            pero este movimiento <strong class="font-medium text-foreground">no va a aparecer como gasto ni
              ingreso</strong> en tus listados, solo acá en Deudas.
          </p>
        </div>
      </form>

      <SheetFooter>
        <Button type="submit" form="debt-movement-form" class="w-full" :disabled="isSaving">
          <Loader2 v-if="isSaving" class="size-4 animate-spin" />
          {{ isSaving ? 'Guardando…' : (isEditing ? 'Guardar cambios' : 'Guardar movimiento') }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
