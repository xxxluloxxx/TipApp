<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { Loader2 } from '@lucide/vue'
import { isFutureDate, todayDateInputValue } from '@/lib/date'
import { formatAmount } from '@/lib/currency'
import { useCreditCardsStore } from '@/stores/creditCards'
import { useCardPeopleStore } from '@/stores/cardPeople'
import { useCardExpensesStore, type CardExpenseWithRelations } from '@/stores/cardExpenses'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
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

// Sección 5 de credit-cards-ux.md: Sheet inferior de alta/edición de gasto de
// tarjeta, 100% optimista (sección 5.4) — mismo patrón que ExpenseFormSheet.

/** Sentinel de "Sin persona asignada" (sección 5.1, punto 2): los `Select`
 * de shadcn-vue/Reka UI requieren un `value` string, no aceptan `null`. */
const NO_PERSON_VALUE = 'none'

const props = withDefaults(defineProps<{
  open: boolean
  /** Gasto a editar. `null`/`undefined` = modo alta. */
  expense?: CardExpenseWithRelations | null
  /** Tarjeta preseleccionada (contexto de detalle de tarjeta / filtro
   * vigente de Transacciones, sección 3.3/4.5), siempre editable. */
  presetCardId?: string | null
  /** Persona preseleccionada (filtro vigente de Transacciones, sección 3.3). */
  presetPersonId?: string | null
  /** `ref`s locales de la vista que deben mantenerse sincronizados con la
   * mutación optimista (sección 1 de credit-cards-ux.md: este store no
   * mantiene una lista maestra, cada vista es dueña de la suya). */
  syncTargets?: Ref<CardExpenseWithRelations[]>[]
}>(), {
  expense: null,
  presetCardId: null,
  presetPersonId: null,
  syncTargets: () => [],
})

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const creditCardsStore = useCreditCardsStore()
const cardPeopleStore = useCardPeopleStore()
const cardExpensesStore = useCardExpensesStore()

const isEditing = computed(() => !!props.expense)
const todayValue = computed(() => todayDateInputValue())

const form = reactive({
  cardId: '',
  personId: NO_PERSON_VALUE,
  description: '',
  date: todayDateInputValue(),
  amount: '',
  hasInstallments: false,
  installmentNumber: '',
  installmentTotal: '',
  notes: '',
})

const errors = reactive<{
  card?: string
  amount?: string
  date?: string
  installments?: string
}>({})
const isSaving = ref(false)

const cardTriggerRef = ref<{ $el?: HTMLElement } | null>(null)
const amountInputRef = ref<{ $el?: HTMLElement } | null>(null)
const dateInputRef = ref<HTMLInputElement | null>(null)

function resetForm() {
  errors.card = undefined
  errors.amount = undefined
  errors.date = undefined
  errors.installments = undefined

  if (props.expense) {
    const e = props.expense
    form.cardId = e.card_id
    form.personId = e.person_id ?? NO_PERSON_VALUE
    form.description = e.description ?? ''
    form.date = e.expense_date
    form.amount = String(e.amount)
    form.hasInstallments = e.installment_number !== null && e.installment_total !== null
    form.installmentNumber = e.installment_number !== null ? String(e.installment_number) : ''
    form.installmentTotal = e.installment_total !== null ? String(e.installment_total) : ''
    form.notes = e.notes ?? ''
  } else {
    form.cardId = props.presetCardId ?? ''
    form.personId = props.presetPersonId ?? NO_PERSON_VALUE
    form.description = ''
    form.date = todayDateInputValue()
    form.amount = ''
    form.hasInstallments = false
    form.installmentNumber = ''
    form.installmentTotal = ''
    form.notes = ''
  }
}

watch(() => props.open, (isOpen) => {
  if (isOpen) resetForm()
})

// Sección 5.2: al desactivar el toggle, los valores se descartan (no quedan
// "fantasma" en un estado oculto que se guarde por error).
watch(() => form.hasInstallments, (value) => {
  if (!value) {
    form.installmentNumber = ''
    form.installmentTotal = ''
  }
})

// Sección 5.2 (referencia visual): badge "N/T" en vivo junto a los inputs de
// cuota, y resumen de tarjeta/persona/valor antes de guardar — mismo dato que
// ya se persiste (installment_number/installment_total), solo se refleja acá
// también mientras se completa el formulario.
const installmentPreviewLabel = computed(() => {
  if (!form.hasInstallments) return null
  const current = Number(form.installmentNumber)
  const total = Number(form.installmentTotal)
  if (!Number.isInteger(current) || !Number.isInteger(total) || current < 1 || total < 1) return null
  return `${current}/${total}`
})

const selectedCardName = computed(() => creditCardsStore.cardById(form.cardId)?.name ?? null)
const selectedPersonName = computed(() => (
  form.personId !== NO_PERSON_VALUE ? (cardPeopleStore.personById(form.personId)?.name ?? null) : null
))
const summaryAmount = computed(() => parseAmount(form.amount))

function parseAmount(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const normalized = trimmed.replace(',', '.')
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

function focusCard() {
  cardTriggerRef.value?.$el?.focus()
}
function focusAmount() {
  amountInputRef.value?.$el?.focus()
}
function focusDate() {
  dateInputRef.value?.focus()
}

function validate(): boolean {
  errors.card = undefined
  errors.amount = undefined
  errors.date = undefined
  errors.installments = undefined

  if (!form.cardId) {
    errors.card = 'Seleccioná una tarjeta.'
    focusCard()
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

  if (form.hasInstallments) {
    const current = Number(form.installmentNumber)
    const total = Number(form.installmentTotal)
    const valid = Number.isInteger(current) && Number.isInteger(total) && current >= 1 && total >= 1 && current <= total
    if (!valid) {
      errors.installments = 'Revisá el número de cuota (debe ser menor o igual al total).'
      return false
    }
  }

  return true
}

function handleOpenChange(value: boolean) {
  emit('update:open', value)
}

function preventCloseWhileSaving(event: Event) {
  if (isSaving.value) event.preventDefault()
}

function onSubmit() {
  if (!validate()) return

  isSaving.value = true
  try {
    const amount = parseAmount(form.amount)!
    const payload = {
      cardId: form.cardId,
      personId: form.personId === NO_PERSON_VALUE ? null : form.personId,
      description: form.description.trim() ? form.description.trim() : null,
      expenseDate: form.date,
      amount,
      installmentNumber: form.hasInstallments ? Number(form.installmentNumber) : null,
      installmentTotal: form.hasInstallments ? Number(form.installmentTotal) : null,
      notes: form.notes.trim() ? form.notes.trim() : null,
    }

    if (props.expense) {
      cardExpensesStore.updateExpense(props.expense.id, payload, props.syncTargets)
    } else {
      cardExpensesStore.addExpense(payload, props.syncTargets)
    }

    // Sección 5.4: 100% optimista, el Sheet se cierra de inmediato.
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
        <SheetTitle>{{ isEditing ? 'Editar gasto' : 'Nuevo gasto' }}</SheetTitle>
        <SheetDescription v-if="!isEditing">
          Completá los datos del gasto de tarjeta.
        </SheetDescription>
      </SheetHeader>

      <form id="card-expense-form" class="flex flex-col gap-4 px-4" novalidate @submit.prevent="onSubmit">
        <div class="flex flex-col gap-1.5">
          <Label for="tarjeta-gasto">Tarjeta</Label>
          <Select v-model="form.cardId" :disabled="isSaving">
            <SelectTrigger
              id="tarjeta-gasto"
              ref="cardTriggerRef"
              class="h-11 w-full"
              :aria-invalid="!!errors.card"
            >
              <SelectValue placeholder="Seleccioná una tarjeta" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="card in creditCardsStore.cards" :key="card.id" :value="card.id">
                {{ card.name }} •••• {{ card.last_four_digits }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p v-if="errors.card" class="text-xs text-destructive">
            {{ errors.card }}
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="persona-gasto">Persona <span class="font-normal text-muted-foreground">(opcional)</span></Label>
          <Select v-model="form.personId" :disabled="isSaving">
            <SelectTrigger id="persona-gasto" class="h-11 w-full">
              <SelectValue placeholder="Sin persona asignada" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="NO_PERSON_VALUE">
                Sin persona asignada
              </SelectItem>
              <SelectItem v-for="person in cardPeopleStore.people" :key="person.id" :value="person.id">
                {{ person.name }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="descripcion-gasto">
            Descripción <span class="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <Input
            id="descripcion-gasto"
            v-model="form.description"
            placeholder="Ej. Concierto en el Movistar Arena"
            maxlength="200"
            :disabled="isSaving"
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="fecha-gasto">Fecha</Label>
          <input
            id="fecha-gasto"
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
          <Label for="monto-gasto">Valor</Label>
          <div class="flex items-center gap-1.5">
            <span class="text-sm text-muted-foreground">$</span>
            <Input
              id="monto-gasto"
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

        <div class="flex items-center justify-between gap-3">
          <Label for="cuotas-toggle">Cuotas</Label>
          <Switch id="cuotas-toggle" v-model="form.hasInstallments" :disabled="isSaving" />
        </div>

        <div v-if="form.hasInstallments" class="flex items-end gap-2">
          <div class="flex flex-1 flex-col gap-1.5">
            <Label for="cuota-actual">Cuota actual</Label>
            <Input id="cuota-actual" v-model="form.installmentNumber" type="number" min="1" :disabled="isSaving" />
          </div>
          <span class="pb-2.5 text-sm text-muted-foreground">de</span>
          <div class="flex flex-1 flex-col gap-1.5">
            <Label for="cuotas-totales">Cuotas totales</Label>
            <Input id="cuotas-totales" v-model="form.installmentTotal" type="number" min="1" :disabled="isSaving" />
          </div>
          <span
            v-if="installmentPreviewLabel"
            class="mb-2.5 shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary tabular-nums"
          >
            {{ installmentPreviewLabel }}
          </span>
        </div>
        <p v-if="errors.installments" class="text-xs text-destructive">
          {{ errors.installments }}
        </p>

        <div class="flex flex-col gap-1.5">
          <Label for="notas-gasto">Notas <span class="font-normal text-muted-foreground">(opcional)</span></Label>
          <Textarea
            id="notas-gasto"
            v-model="form.notes"
            rows="2"
            maxlength="280"
            placeholder="Ej. Concierto en el Movistar Arena"
            :disabled="isSaving"
          />
        </div>
      </form>

      <!-- Resumen: mismo dato que ya se completó arriba, repetido en forma
      compacta justo antes de confirmar (referencia visual del mockup). -->
      <div v-if="selectedCardName || summaryAmount" class="mx-4 flex items-center justify-between gap-4 rounded-lg bg-muted px-4 py-3 text-sm">
        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-muted-foreground">Tarjeta</span>
          <span class="font-medium">{{ selectedCardName ?? '—' }}</span>
        </div>
        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-muted-foreground">Persona</span>
          <span class="font-medium">{{ selectedPersonName ?? 'Sin persona' }}</span>
        </div>
        <div class="flex flex-col items-end gap-0.5">
          <span class="text-xs text-muted-foreground">Valor</span>
          <span class="font-semibold tabular-nums">${{ formatAmount(summaryAmount ?? 0) }}</span>
        </div>
      </div>

      <SheetFooter>
        <Button type="submit" form="card-expense-form" class="w-full" :disabled="isSaving">
          <Loader2 v-if="isSaving" class="size-4 animate-spin" />
          {{ isSaving ? 'Guardando…' : (isEditing ? 'Guardar cambios' : 'Guardar gasto') }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
