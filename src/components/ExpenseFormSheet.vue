<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Loader2 } from '@lucide/vue'
import { isFutureDate, todayDateInputValue } from '@/lib/date'
import { useExpensesStore, type ExpenseWithCategory } from '@/stores/expenses'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
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

const props = defineProps<{
  open: boolean
  /** Gasto a editar. `null`/`undefined` = modo alta (sección 3 vs 3.9). */
  expense?: ExpenseWithCategory | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const expensesStore = useExpensesStore()

const isEditing = computed(() => !!props.expense)
const todayValue = computed(() => todayDateInputValue())

const form = reactive({
  amount: '',
  categoryId: '',
  date: todayDateInputValue(),
  description: '',
})

const errors = reactive<{ amount?: string, category?: string, date?: string }>({})
const isSaving = ref(false)

const amountInputRef = ref<{ $el?: HTMLElement } | null>(null)
const categoryTriggerRef = ref<{ $el?: HTMLElement } | null>(null)
const dateInputRef = ref<HTMLInputElement | null>(null)

function resetForm() {
  errors.amount = undefined
  errors.category = undefined
  errors.date = undefined

  if (props.expense) {
    form.amount = String(props.expense.amount)
    form.categoryId = props.expense.category_id
    form.date = props.expense.expense_date
    form.description = props.expense.description ?? ''
  } else {
    form.amount = ''
    form.categoryId = ''
    form.date = todayDateInputValue()
    form.description = ''
  }
}

// Precarga el form cada vez que el Sheet se abre (alta con valores por
// defecto, o edición con los valores del gasto seleccionado).
watch(() => props.open, (isOpen) => {
  if (isOpen) resetForm()
})

function parseAmount(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  // Acepta "," o "." como separador decimal (no separador de miles). No
  // está detallado en el doc de UX más allá de "numérico, > 0"; esta es la
  // interpretación más simple y suficiente para un campo de monto.
  const normalized = trimmed.replace(',', '.')
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

function focusAmount() {
  amountInputRef.value?.$el?.focus()
}
function focusCategory() {
  categoryTriggerRef.value?.$el?.focus()
}
function focusDate() {
  dateInputRef.value?.focus()
}

// Orden fijo de validación (sección 3.6): monto -> categoría -> fecha,
// mostrando y enfocando solo el primer error encontrado.
function validate(): boolean {
  errors.amount = undefined
  errors.category = undefined
  errors.date = undefined

  const amount = parseAmount(form.amount)
  if (amount === null || amount <= 0) {
    errors.amount = 'Ingresá un monto mayor a 0.'
    focusAmount()
    return false
  }

  if (!form.categoryId) {
    errors.category = 'Seleccioná una categoría.'
    focusCategory()
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

// Sección 3.7: el Sheet no se puede cerrar (tap fuera / Escape) mientras se
// guarda. En la práctica, dado que la mutación optimista es síncrona
// (sección 3.8), esta ventana es instantánea; queda igual como salvaguarda
// explícita.
function preventCloseWhileSaving(event: Event) {
  if (isSaving.value) event.preventDefault()
}

function onSubmit() {
  if (!validate()) return

  isSaving.value = true
  try {
    const amount = parseAmount(form.amount)!
    const payload = {
      amount,
      categoryId: form.categoryId,
      description: form.description.trim() ? form.description.trim() : null,
      expenseDate: form.date,
    }

    if (props.expense) {
      expensesStore.updateExpense(props.expense.id, payload)
    } else {
      expensesStore.addExpense(payload)
    }

    // El Sheet se cierra inmediatamente (sección 3.8, punto 2): la
    // confirmación/rollback contra Supabase sigue en segundo plano.
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
          Completá los datos del gasto.
        </SheetDescription>
      </SheetHeader>

      <form id="expense-form" class="flex flex-col gap-4 px-4" novalidate @submit.prevent="onSubmit">
        <div class="flex flex-col gap-1.5">
          <Label for="monto">Monto</Label>
          <div class="flex items-center gap-1.5">
            <span class="text-sm text-muted-foreground">$</span>
            <Input
              id="monto"
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
          <Label for="categoria">Categoría</Label>
          <Select v-model="form.categoryId" :disabled="isSaving">
            <SelectTrigger
              id="categoria"
              ref="categoryTriggerRef"
              class="h-11 w-full"
              :aria-invalid="!!errors.category"
            >
              <SelectValue placeholder="Seleccioná una categoría" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Categorías</SelectLabel>
                <SelectItem
                  v-for="category in expensesStore.defaultCategories"
                  :key="category.id"
                  :value="category.id"
                >
                  <span
                    class="size-2.5 rounded-full"
                    :style="{ background: category.color ?? 'var(--color-muted-foreground)' }"
                  />
                  {{ category.name }}
                </SelectItem>
              </SelectGroup>

              <template v-if="expensesStore.customCategories.length">
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Mis categorías</SelectLabel>
                  <SelectItem
                    v-for="category in expensesStore.customCategories"
                    :key="category.id"
                    :value="category.id"
                  >
                    <span
                      class="size-2.5 rounded-full"
                      :style="{ background: category.color ?? 'var(--color-muted-foreground)' }"
                    />
                    {{ category.name }}
                  </SelectItem>
                </SelectGroup>
              </template>
            </SelectContent>
          </Select>
          <p v-if="errors.category" class="text-xs text-destructive">
            {{ errors.category }}
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="fecha">Fecha</Label>
          <input
            id="fecha"
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
          <Label for="descripcion">
            Descripción <span class="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <Input
            id="descripcion"
            v-model="form.description"
            placeholder="Ej. Almuerzo con el equipo"
            maxlength="200"
            :disabled="isSaving"
          />
        </div>
      </form>

      <SheetFooter>
        <Button type="submit" form="expense-form" class="w-full" :disabled="isSaving">
          <Loader2 v-if="isSaving" class="size-4 animate-spin" />
          {{ isSaving ? 'Guardando…' : (isEditing ? 'Guardar cambios' : 'Guardar gasto') }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
