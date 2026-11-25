<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ArrowDown, ArrowUp, Delete } from '@lucide/vue'
import { backspace, evaluate, hasOperator, pressKey } from '@/lib/calcExpression'
import { formatAmount } from '@/lib/currency'
import type { CalcEntry, CalcEntryKind } from '@/stores/calcDrafts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'

// Movimiento de un borrador: Ingreso/Gasto + descripción + monto con teclado
// propio que admite sumas y restas (ej. 1200 − 180 + 5,5). Sin categorías.
const props = defineProps<{ open: boolean, entry: CalcEntry | null }>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  submit: [payload: { kind: CalcEntryKind, description: string, amount: number }]
}>()

const form = reactive({ kind: 'expense' as CalcEntryKind, description: '', expr: '' })
const error = ref('')
const isSaving = ref(false)

watch(() => props.open, (isOpen) => {
  if (!isOpen) return
  error.value = ''
  isSaving.value = false
  if (props.entry) {
    form.kind = props.entry.kind as CalcEntryKind
    form.description = props.entry.description
    form.expr = String(props.entry.amount).replace('.', ',')
  } else {
    form.kind = 'expense'
    form.description = ''
    form.expr = ''
  }
})

const result = computed(() => evaluate(form.expr))
const showResult = computed(() => hasOperator(form.expr) && result.value !== null)

function press(key: string) {
  error.value = ''
  form.expr = pressKey(form.expr, key)
}

function onSubmit() {
  const amount = result.value
  if (amount === null || amount <= 0) {
    error.value = 'Ingresá un monto mayor a 0.'
    return
  }
  isSaving.value = true
  emit('submit', { kind: form.kind, description: form.description.trim(), amount })
}

const digitRows = [['7', '8', '9'], ['4', '5', '6'], ['1', '2', '3']]
const keyClass = 'h-12 rounded-lg bg-muted text-xl font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
</script>

<template>
  <Sheet :open="props.open" @update:open="emit('update:open', $event)">
    <SheetContent side="bottom" class="max-h-[95svh] overflow-y-auto">
      <SheetHeader>
        <SheetTitle>{{ entry ? 'Editar movimiento' : 'Nuevo movimiento' }}</SheetTitle>
      </SheetHeader>

      <form id="calc-entry-form" class="flex flex-col gap-3 px-4" novalidate @submit.prevent="onSubmit">
        <div role="radiogroup" aria-label="Tipo" class="grid grid-cols-2 gap-2">
          <button
            type="button" role="radio" :aria-checked="form.kind === 'income'"
            class="flex h-11 items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors"
            :class="form.kind === 'income' ? 'border-success bg-success/10 text-success' : 'border-border text-muted-foreground'"
            @click="form.kind = 'income'"
          >
            <ArrowUp class="size-4" /> Ingreso
          </button>
          <button
            type="button" role="radio" :aria-checked="form.kind === 'expense'"
            class="flex h-11 items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors"
            :class="form.kind === 'expense' ? 'border-destructive bg-destructive/10 text-destructive' : 'border-border text-muted-foreground'"
            @click="form.kind = 'expense'"
          >
            <ArrowDown class="size-4" /> Gasto
          </button>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="calc-desc">Descripción <span class="font-normal text-muted-foreground">(opcional)</span></Label>
          <Input id="calc-desc" v-model="form.description" maxlength="120" placeholder="Ej. Supermercado" />
        </div>

        <div class="flex flex-col gap-1.5">
          <Label>Monto</Label>
          <div class="flex min-h-14 items-center justify-end gap-2 rounded-lg border px-3 py-2" :class="error ? 'border-destructive' : 'border-input'">
            <div class="min-w-0 flex-1 text-right">
              <p class="truncate text-2xl font-semibold tabular-nums">{{ form.expr || '0' }}</p>
              <p v-if="showResult" class="text-xs text-muted-foreground">= ${{ formatAmount(result!) }}</p>
            </div>
            <button type="button" class="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground" aria-label="Borrar" @click="form.expr = backspace(form.expr)">
              <Delete class="size-6" />
            </button>
          </div>
          <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
        </div>

        <div class="grid grid-cols-4 gap-2">
          <template v-for="(row, i) in digitRows" :key="i">
            <button v-for="k in row" :key="k" type="button" :class="keyClass" @click="press(k)">{{ k }}</button>
            <button
              type="button"
              class="h-12 rounded-lg text-2xl font-semibold text-white transition-opacity hover:opacity-90"
              :class="i === 0 ? 'bg-destructive' : i === 1 ? 'bg-success' : 'invisible'"
              :aria-label="i === 0 ? 'Restar' : 'Sumar'"
              :tabindex="i === 2 ? -1 : 0"
              @click="press(i === 0 ? '−' : '+')"
            >
              {{ i === 0 ? '−' : '+' }}
            </button>
          </template>
          <button type="button" :class="[keyClass, 'col-span-2']" @click="press('0')">0</button>
          <button type="button" :class="keyClass" @click="press(',')">,</button>
        </div>
      </form>

      <SheetFooter>
        <Button type="submit" form="calc-entry-form" class="w-full" :disabled="isSaving">
          {{ isSaving ? 'Guardando…' : entry ? 'Guardar' : 'Agregar' }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
