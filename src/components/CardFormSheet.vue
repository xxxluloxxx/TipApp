<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Check, Loader2 } from '@lucide/vue'
import { COLOR_SWATCHES, readableTextColor } from '@/lib/colors'
import { useCreditCardsStore, type CreditCard } from '@/stores/creditCards'
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

// Sección 6.2 de credit-cards-ux.md: alta/edición de tarjeta, 100% optimista
// (a diferencia de CategoryFormSheet) porque no hay ningún índice único
// conocido sobre `credit_cards.name`.

const props = defineProps<{
  open: boolean
  /** Tarjeta a editar. `null`/`undefined` = modo alta. */
  card?: CreditCard | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const creditCardsStore = useCreditCardsStore()

const isEditing = computed(() => !!props.card)

const form = reactive({
  name: '',
  lastFourDigits: '',
  color: null as string | null,
  monthlyLimit: '',
  statementCutoffDay: '',
  paymentDueDay: '',
})

const errors = reactive<{
  name?: string
  lastFourDigits?: string
  color?: string
  monthlyLimit?: string
  statementCutoffDay?: string
  paymentDueDay?: string
}>({})
const isSaving = ref(false)

const nameInputRef = ref<{ $el?: HTMLElement } | null>(null)

function resetForm() {
  errors.name = undefined
  errors.lastFourDigits = undefined
  errors.color = undefined
  errors.monthlyLimit = undefined
  errors.statementCutoffDay = undefined
  errors.paymentDueDay = undefined

  if (props.card) {
    form.name = props.card.name
    form.lastFourDigits = props.card.last_four_digits ?? ''
    form.color = COLOR_SWATCHES.some(swatch => swatch.hex === props.card?.color) ? props.card.color : null
    form.monthlyLimit = props.card.suggested_monthly_limit !== null ? String(props.card.suggested_monthly_limit) : ''
    form.statementCutoffDay = props.card.statement_cutoff_day !== null ? String(props.card.statement_cutoff_day) : ''
    form.paymentDueDay = props.card.payment_due_day !== null ? String(props.card.payment_due_day) : ''
  } else {
    form.name = ''
    form.lastFourDigits = ''
    form.color = null
    form.monthlyLimit = ''
    form.statementCutoffDay = ''
    form.paymentDueDay = ''
  }
}

watch(() => props.open, (isOpen) => {
  if (isOpen) resetForm()
})

// Solo dígitos, máximo 4 (constraint de BD: `^[0-9]{4}$`).
watch(() => form.lastFourDigits, (value) => {
  const digitsOnly = value.replace(/\D/g, '').slice(0, 4)
  if (digitsOnly !== value) form.lastFourDigits = digitsOnly
})

function focusName() {
  nameInputRef.value?.$el?.focus()
}

function parseMonthlyLimit(raw: string): number | null | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const normalized = trimmed.replace(',', '.')
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return undefined
  const value = Number(normalized)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

// Sección 12.5: día del mes opcional (1-31). Mismo criterio que
// `parsePaymentDay` de FixedExpenseFormSheet, adaptado a "opcional" — la única
// diferencia real es que acá un campo vacío es válido, no un error.
type OptionalDayResult = { value: number | null } | { error: true }

function parseOptionalDayOfMonth(raw: string): OptionalDayResult {
  const trimmed = raw.trim()
  if (trimmed === '') return { value: null }
  if (!/^\d+$/.test(trimmed)) return { error: true }
  const value = Number(trimmed)
  if (!Number.isInteger(value) || value < 1 || value > 31) return { error: true }
  return { value }
}

function validate(): boolean {
  errors.name = undefined
  errors.lastFourDigits = undefined
  errors.color = undefined
  errors.monthlyLimit = undefined
  errors.statementCutoffDay = undefined
  errors.paymentDueDay = undefined
  let ok = true

  if (!form.name.trim()) {
    errors.name = 'Ingresá un nombre para la tarjeta.'
    ok = false
  }

  if (!/^\d{4}$/.test(form.lastFourDigits)) {
    errors.lastFourDigits = 'Ingresá los 4 últimos dígitos.'
    ok = false
  }

  if (!form.color) {
    errors.color = 'Elegí un color para la tarjeta.'
    ok = false
  }

  const limit = parseMonthlyLimit(form.monthlyLimit)
  if (limit === undefined) {
    errors.monthlyLimit = 'Ingresá un monto mayor a 0, o dejalo vacío.'
    ok = false
  }

  if ('error' in parseOptionalDayOfMonth(form.statementCutoffDay)) {
    errors.statementCutoffDay = 'Ingresá un día entre 1 y 31.'
    ok = false
  }

  if ('error' in parseOptionalDayOfMonth(form.paymentDueDay)) {
    errors.paymentDueDay = 'Ingresá un día entre 1 y 31.'
    ok = false
  }

  return ok
}

function handleOpenChange(value: boolean) {
  emit('update:open', value)
}

function onSubmit() {
  if (!validate()) {
    if (errors.name) focusName()
    return
  }

  isSaving.value = true
  try {
    // `validate()` ya garantizó que ambos parseos no son `{ error }`, así que
    // acá el fallback `null` solo cubre el estrechamiento de tipo.
    const cutoffResult = parseOptionalDayOfMonth(form.statementCutoffDay)
    const paymentResult = parseOptionalDayOfMonth(form.paymentDueDay)

    const payload = {
      name: form.name.trim(),
      lastFourDigits: form.lastFourDigits,
      color: form.color!,
      suggestedMonthlyLimit: parseMonthlyLimit(form.monthlyLimit) ?? null,
      statementCutoffDay: 'value' in cutoffResult ? cutoffResult.value : null,
      paymentDueDay: 'value' in paymentResult ? paymentResult.value : null,
    }

    // El store ya se encarga del toast de éxito/error (optimista, sección
    // 6.2) — acá solo se decide qué mutación disparar.
    if (props.card) {
      creditCardsStore.updateCard(props.card.id, payload)
    } else {
      creditCardsStore.addCard(payload)
    }

    // Sección 6.2: 100% optimista, el Sheet se cierra de inmediato (mismo
    // criterio que ExpenseFormSheet).
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
        <SheetTitle>{{ isEditing ? 'Editar tarjeta' : 'Nueva tarjeta' }}</SheetTitle>
        <SheetDescription v-if="!isEditing">
          Completá los datos de tu tarjeta.
        </SheetDescription>
      </SheetHeader>

      <form id="card-form" class="flex flex-col gap-4 px-4" novalidate @submit.prevent="onSubmit">
        <div class="flex flex-col gap-1.5">
          <Label for="nombre-tarjeta">Nombre</Label>
          <Input
            id="nombre-tarjeta"
            ref="nameInputRef"
            v-model="form.name"
            placeholder="Ej. Visa Signature"
            maxlength="40"
            :disabled="isSaving"
            :aria-invalid="!!errors.name"
          />
          <p v-if="errors.name" class="text-xs text-destructive">
            {{ errors.name }}
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="ultimos-digitos">Últimos 4 dígitos</Label>
          <Input
            id="ultimos-digitos"
            v-model="form.lastFourDigits"
            inputmode="numeric"
            placeholder="1234"
            maxlength="4"
            :disabled="isSaving"
            :aria-invalid="!!errors.lastFourDigits"
          />
          <p v-if="errors.lastFourDigits" class="text-xs text-destructive">
            {{ errors.lastFourDigits }}
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label id="color-tarjeta-label">Color</Label>
          <div id="color-tarjeta" role="group" aria-labelledby="color-tarjeta-label" class="flex flex-wrap gap-3">
            <button
              v-for="swatch in COLOR_SWATCHES"
              :key="swatch.hex"
              type="button"
              class="relative flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :class="{ 'ring-2 ring-offset-2 ring-ring': form.color === swatch.hex }"
              :style="{ background: swatch.hex }"
              :aria-pressed="form.color === swatch.hex"
              :aria-label="swatch.label"
              :disabled="isSaving"
              @click="form.color = swatch.hex"
            >
              <Check
                v-if="form.color === swatch.hex"
                class="size-5"
                :style="{ color: readableTextColor(swatch.hex) }"
              />
            </button>
          </div>
          <p v-if="errors.color" class="text-sm text-destructive">
            {{ errors.color }}
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="limite-sugerido">
            Límite mensual sugerido <span class="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <div class="flex items-center gap-1.5">
            <span class="text-sm text-muted-foreground">$</span>
            <Input
              id="limite-sugerido"
              v-model="form.monthlyLimit"
              inputmode="decimal"
              type="text"
              placeholder="0"
              :disabled="isSaving"
              :aria-invalid="!!errors.monthlyLimit"
            />
          </div>
          <p class="text-xs text-muted-foreground">
            Es solo una referencia para vos, no afecta el límite real de tu tarjeta.
          </p>
          <p v-if="errors.monthlyLimit" class="text-xs text-destructive">
            {{ errors.monthlyLimit }}
          </p>
        </div>

        <!-- Sección 12.5: día de corte (opcional) -->
        <div class="flex flex-col gap-1.5">
          <Label for="tarjeta-corte">Día de corte <span class="font-normal text-muted-foreground">(opcional)</span></Label>
          <Input
            id="tarjeta-corte"
            v-model="form.statementCutoffDay"
            inputmode="numeric"
            type="text"
            placeholder="Ej. 15"
            class="text-base tabular-nums"
            :disabled="isSaving"
            :aria-invalid="!!errors.statementCutoffDay"
          />
          <p v-if="errors.statementCutoffDay" class="text-xs text-destructive">
            {{ errors.statementCutoffDay }}
          </p>
          <p class="text-xs text-muted-foreground">
            Día del mes en que cierra el resumen de esta tarjeta.
          </p>
        </div>

        <!-- Sección 12.5: día de pago (opcional) -->
        <div class="flex flex-col gap-1.5">
          <Label for="tarjeta-pago">Día de pago <span class="font-normal text-muted-foreground">(opcional)</span></Label>
          <Input
            id="tarjeta-pago"
            v-model="form.paymentDueDay"
            inputmode="numeric"
            type="text"
            placeholder="Ej. 25"
            class="text-base tabular-nums"
            :disabled="isSaving"
            :aria-invalid="!!errors.paymentDueDay"
          />
          <p v-if="errors.paymentDueDay" class="text-xs text-destructive">
            {{ errors.paymentDueDay }}
          </p>
          <p class="text-xs text-muted-foreground">
            Día límite para pagar el resumen antes del vencimiento.
          </p>
        </div>
      </form>

      <SheetFooter>
        <Button type="submit" form="card-form" class="w-full" :disabled="isSaving">
          <Loader2 v-if="isSaving" class="size-4 animate-spin" />
          {{ isSaving ? 'Guardando…' : (isEditing ? 'Guardar cambios' : 'Guardar tarjeta') }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
