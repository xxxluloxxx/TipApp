<script setup lang="ts">
import { reactive, watch } from 'vue'
import { formatAmount } from '@/lib/currency'
import { useLoansStore } from '@/stores/loans'
import type { Tables } from '@/types/database.types'
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

// Editar el monto de UNA cuota puntual (p. ej. un mes en que el seguro cobra
// distinto). No toca el resto del cronograma ni la cuota mensual del préstamo.
// Guardado optimista, mismo patrón que marcar una cuota pagada.

const props = defineProps<{
  open: boolean
  installment: Tables<'loan_installments'> | null
  /** Etiqueta del mes (p. ej. "noviembre 2026"). */
  periodLabel: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const loansStore = useLoansStore()

const form = reactive({ amount: '' })
const errors = reactive<{ amount?: string }>({})

watch(() => props.open, (isOpen) => {
  if (!isOpen) return
  errors.amount = undefined
  form.amount = props.installment ? String(props.installment.amount) : ''
})

function parseAmount(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const normalized = trimmed.replace(',', '.')
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

function onSubmit() {
  errors.amount = undefined
  const amount = parseAmount(form.amount)
  if (amount === null || amount <= 0) {
    errors.amount = 'Ingresá un monto mayor a 0.'
    return
  }
  if (!props.installment) return

  loansStore.updateInstallmentAmount(props.installment, amount)
  emit('update:open', false)
}
</script>

<template>
  <Sheet :open="props.open" @update:open="emit('update:open', $event)">
    <SheetContent side="bottom">
      <SheetHeader>
        <SheetTitle>Editar cuota {{ installment?.installment_number }}</SheetTitle>
        <SheetDescription>
          {{ periodLabel }} · hoy ${{ formatAmount(installment?.amount ?? 0) }}. Solo cambia esta cuota.
        </SheetDescription>
      </SheetHeader>

      <form id="loan-installment-amount-form" class="flex flex-col gap-4 px-4" novalidate @submit.prevent="onSubmit">
        <div class="flex flex-col gap-1.5">
          <Label for="monto-cuota">Monto de esta cuota</Label>
          <div class="flex items-center gap-1.5">
            <span class="text-sm text-muted-foreground">$</span>
            <Input
              id="monto-cuota"
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
      </form>

      <SheetFooter>
        <Button type="submit" form="loan-installment-amount-form" class="w-full">
          Guardar
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
