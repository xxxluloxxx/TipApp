<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Loader2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { formatDateChip, isFutureDate, todayDateInputValue } from '@/lib/date'
import { formatAmount } from '@/lib/currency'
import { useLoansStore, type LoanProgress } from '@/stores/loans'
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

// Sección 8.1 de loans-ux.md: mismo Sheet para alta y edición.
// - Alta (props.loan = null): 6 campos, guardado NO optimista vía RPC atómica
//   `create_loan` (genera el cronograma completo server-side).
// - Edición (props.loan set): solo Nombre/Descripción/Cuota mensual editables;
//   Monto total/Fecha de inicio/Plazo quedan `disabled` (ya generaron el
//   cronograma real, cambiarlos lo dejaría inconsistente). 100% optimista.

const props = withDefaults(defineProps<{
  open: boolean
  /** Préstamo a editar (fila de `loan_progress`). `null` = modo alta. */
  loan?: LoanProgress | null
}>(), {
  loan: null,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const router = useRouter()
const loansStore = useLoansStore()

const isEditing = computed(() => !!props.loan)
const todayValue = computed(() => todayDateInputValue())

const form = reactive({
  name: '',
  description: '',
  totalAmount: '',
  monthlyInstallment: '',
  startDate: todayDateInputValue(),
  termMonths: '',
})

const errors = reactive<{
  name?: string
  totalAmount?: string
  monthlyInstallment?: string
  startDate?: string
  termMonths?: string
}>({})
const isSaving = ref(false)

function resetForm() {
  errors.name = undefined
  errors.totalAmount = undefined
  errors.monthlyInstallment = undefined
  errors.startDate = undefined
  errors.termMonths = undefined

  if (props.loan) {
    form.name = props.loan.name ?? ''
    form.description = props.loan.description ?? ''
    form.totalAmount = String(props.loan.total_amount ?? '')
    form.monthlyInstallment = String(props.loan.monthly_installment_amount ?? '')
    form.startDate = props.loan.start_date ?? todayDateInputValue()
    form.termMonths = String(props.loan.term_months ?? '')
  } else {
    form.name = ''
    form.description = ''
    form.totalAmount = ''
    form.monthlyInstallment = ''
    form.startDate = todayDateInputValue()
    form.termMonths = ''
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

function parseTerm(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isInteger(value) && value >= 1 ? value : null
}

function validate(): boolean {
  errors.name = undefined
  errors.totalAmount = undefined
  errors.monthlyInstallment = undefined
  errors.startDate = undefined
  errors.termMonths = undefined

  if (!form.name.trim()) {
    errors.name = 'Ingresá un nombre.'
    return false
  }

  const monthly = parseAmount(form.monthlyInstallment)
  if (monthly === null || monthly <= 0) {
    errors.monthlyInstallment = 'Ingresá una cuota mayor a 0.'
    return false
  }

  if (!isEditing.value) {
    const total = parseAmount(form.totalAmount)
    if (total === null || total <= 0) {
      errors.totalAmount = 'Ingresá un monto mayor a 0.'
      return false
    }
    if (!form.startDate) {
      errors.startDate = 'Seleccioná una fecha.'
      return false
    }
    // Sección 8.1: admite fechas pasadas sin límite; la única restricción es
    // que no sea futura.
    if (isFutureDate(form.startDate)) {
      errors.startDate = 'La fecha no puede ser futura.'
      return false
    }
    const term = parseTerm(form.termMonths)
    if (term === null) {
      errors.termMonths = 'Ingresá una cantidad de cuotas (1 o más).'
      return false
    }
  }

  return true
}

function handleOpenChange(value: boolean) {
  emit('update:open', value)
}

// Sección 1.5: no se puede cerrar mientras la RPC de alta está en vuelo (hay
// un roundtrip real, a diferencia de la edición optimista).
function preventCloseWhileSaving(event: Event) {
  if (isSaving.value) event.preventDefault()
}

async function onSubmit() {
  if (!validate()) return

  isSaving.value = true
  try {
    if (isEditing.value) {
      loansStore.updateLoan(props.loan!.loan_id!, {
        name: form.name.trim(),
        description: form.description.trim() ? form.description.trim() : null,
        monthlyInstallmentAmount: parseAmount(form.monthlyInstallment)!,
      })
      emit('update:open', false)
      return
    }

    const result = await loansStore.createLoan({
      name: form.name.trim(),
      totalAmount: parseAmount(form.totalAmount)!,
      monthlyInstallmentAmount: parseAmount(form.monthlyInstallment)!,
      startDate: form.startDate,
      termMonths: parseTerm(form.termMonths)!,
      description: form.description.trim() ? form.description.trim() : null,
    })

    if ('error' in result) {
      toast.error('No se pudo guardar el préstamo', {
        description: 'Revisá tu conexión e intentá de nuevo.',
      })
      return
    }

    toast.success('Préstamo creado')
    emit('update:open', false)
    router.push({ name: 'loan-detail', params: { id: result.loanId } })
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
        <SheetTitle>{{ isEditing ? 'Editar préstamo' : 'Nuevo préstamo' }}</SheetTitle>
        <SheetDescription v-if="!isEditing">
          Registrá tu préstamo para llevar el control de las cuotas. No afecta el
          saldo de tus cuentas ni tus transacciones.
        </SheetDescription>
      </SheetHeader>

      <form id="loan-form" class="flex flex-col gap-4 px-4" novalidate @submit.prevent="onSubmit">
        <div class="flex flex-col gap-1.5">
          <Label for="nombre-prestamo">Nombre</Label>
          <Input
            id="nombre-prestamo"
            v-model="form.name"
            placeholder="Ej. Préstamo Personal"
            maxlength="60"
            :disabled="isSaving"
            :aria-invalid="!!errors.name"
          />
          <p v-if="errors.name" class="text-xs text-destructive">
            {{ errors.name }}
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="descripcion-prestamo">
            Descripción <span class="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <Input
            id="descripcion-prestamo"
            v-model="form.description"
            placeholder="Ej. Descuento por nómina"
            maxlength="100"
            :disabled="isSaving"
          />
          <p class="text-xs text-muted-foreground">
            Por ejemplo, "Descuento por nómina" o el banco que lo otorgó.
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="total-prestamo">Monto total</Label>
          <div class="flex items-center gap-1.5">
            <span class="text-sm text-muted-foreground">$</span>
            <Input
              id="total-prestamo"
              v-model="form.totalAmount"
              inputmode="decimal"
              type="text"
              placeholder="0"
              class="text-lg font-semibold tabular-nums"
              :disabled="isSaving || isEditing"
              :aria-invalid="!!errors.totalAmount"
            />
          </div>
          <p v-if="isEditing" class="text-xs text-muted-foreground">
            No se puede modificar: ya generó el cronograma de cuotas.
          </p>
          <p v-if="errors.totalAmount" class="text-xs text-destructive">
            {{ errors.totalAmount }}
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="cuota-prestamo">Cuota mensual</Label>
          <div class="flex items-center gap-1.5">
            <span class="text-sm text-muted-foreground">$</span>
            <Input
              id="cuota-prestamo"
              v-model="form.monthlyInstallment"
              inputmode="decimal"
              type="text"
              placeholder="0"
              class="text-lg font-semibold tabular-nums"
              :disabled="isSaving"
              :aria-invalid="!!errors.monthlyInstallment"
            />
          </div>
          <p v-if="errors.monthlyInstallment" class="text-xs text-destructive">
            {{ errors.monthlyInstallment }}
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="inicio-prestamo">Fecha de inicio</Label>
          <input
            id="inicio-prestamo"
            v-model="form.startDate"
            type="date"
            :max="todayValue"
            :disabled="isSaving || isEditing"
            :aria-invalid="!!errors.startDate"
            class="dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive h-9 w-full rounded-md border bg-transparent px-2.5 py-1 text-base shadow-xs outline-none transition-[color,box-shadow] focus-visible:ring-3 aria-invalid:ring-3 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
          >
          <p v-if="isEditing" class="text-xs text-muted-foreground">
            No se puede modificar: ya generó el cronograma de cuotas.
          </p>
          <p v-if="errors.startDate" class="text-xs text-destructive">
            {{ errors.startDate }}
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="plazo-prestamo">Plazo en meses</Label>
          <Input
            id="plazo-prestamo"
            v-model="form.termMonths"
            inputmode="numeric"
            type="text"
            min="1"
            placeholder="12"
            class="tabular-nums"
            :disabled="isSaving || isEditing"
            :aria-invalid="!!errors.termMonths"
          />
          <p v-if="isEditing" class="text-xs text-muted-foreground">
            No se puede modificar: ya generó el cronograma de cuotas.
          </p>
          <p v-else class="text-xs text-muted-foreground">
            Cantidad total de cuotas del préstamo. Se generan todas las cuotas del cronograma al guardar.
          </p>
          <p v-if="errors.termMonths" class="text-xs text-destructive">
            {{ errors.termMonths }}
          </p>
        </div>

        <p v-if="isEditing && props.loan?.estimated_end_date" class="text-xs text-muted-foreground">
          Fin estimado: {{ formatDateChip(props.loan.estimated_end_date) }} ·
          {{ formatAmount(props.loan.total_amount ?? 0) }} en {{ props.loan.term_months }} cuotas.
        </p>
      </form>

      <SheetFooter>
        <Button type="submit" form="loan-form" class="w-full" :disabled="isSaving">
          <Loader2 v-if="isSaving" class="size-4 animate-spin" />
          {{ isSaving ? 'Guardando…' : (isEditing ? 'Guardar cambios' : 'Guardar préstamo') }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
