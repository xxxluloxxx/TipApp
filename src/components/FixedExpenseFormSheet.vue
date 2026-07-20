<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { CalendarSync, Loader2 } from '@lucide/vue'
import { useCategoriesStore } from '@/stores/categories'
import { useFixedExpensesStore, type FixedExpense } from '@/stores/fixedExpenses'
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
import { Textarea } from '@/components/ui/textarea'

// Sección 4 de fixed-expenses-ux.md: alta/edición de una plantilla de gasto
// fijo. 100% optimista (sección 4.2), mismo patrón que `AccountFormSheet`/
// `CardFormSheet` — sin restricción de unicidad server-only conocida sobre
// `fixed_expenses.name`. `is_active` nunca aparece acá (se maneja desde el
// menú "⋮" Pausar/Reanudar, sección 4.1/7).

const props = withDefaults(defineProps<{
  open: boolean
  /** Plantilla a editar. `null`/`undefined` = modo alta. */
  template?: FixedExpense | null
}>(), {
  template: null,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const fixedExpensesStore = useFixedExpensesStore()
const categoriesStore = useCategoriesStore()

const isEditing = computed(() => !!props.template)

const form = reactive({
  name: '',
  amount: '',
  categoryId: '',
  paymentDay: '',
  notes: '',
})

const errors = reactive<{ name?: string, amount?: string, category?: string, paymentDay?: string }>({})
const isSaving = ref(false)

const nameInputRef = ref<{ $el?: HTMLElement } | null>(null)
const amountInputRef = ref<{ $el?: HTMLElement } | null>(null)
const categoryTriggerRef = ref<{ $el?: HTMLElement } | null>(null)
const paymentDayInputRef = ref<{ $el?: HTMLElement } | null>(null)

function resetForm() {
  errors.name = undefined
  errors.amount = undefined
  errors.category = undefined
  errors.paymentDay = undefined

  if (props.template) {
    form.name = props.template.name
    form.amount = String(props.template.amount)
    form.categoryId = props.template.category_id
    form.paymentDay = String(props.template.payment_day)
    form.notes = props.template.notes ?? ''
  } else {
    form.name = ''
    form.amount = ''
    form.categoryId = ''
    form.paymentDay = ''
    form.notes = ''
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

function parsePaymentDay(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isInteger(value) && value >= 1 && value <= 31 ? value : null
}

function focusName() {
  nameInputRef.value?.$el?.focus()
}
function focusAmount() {
  amountInputRef.value?.$el?.focus()
}
function focusCategory() {
  categoryTriggerRef.value?.$el?.focus()
}
function focusPaymentDay() {
  paymentDayInputRef.value?.$el?.focus()
}

function validate(): boolean {
  errors.name = undefined
  errors.amount = undefined
  errors.category = undefined
  errors.paymentDay = undefined

  if (!form.name.trim()) {
    errors.name = 'Ingresá un nombre.'
    focusName()
    return false
  }

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

  const paymentDay = parsePaymentDay(form.paymentDay)
  if (paymentDay === null) {
    errors.paymentDay = 'Ingresá un día entre 1 y 31.'
    focusPaymentDay()
    return false
  }

  return true
}

function handleOpenChange(value: boolean) {
  emit('update:open', value)
}

function onSubmit() {
  if (!validate()) return

  isSaving.value = true
  try {
    const payload = {
      name: form.name.trim(),
      amount: parseAmount(form.amount)!,
      categoryId: form.categoryId,
      paymentDay: parsePaymentDay(form.paymentDay)!,
      notes: form.notes.trim() ? form.notes.trim() : null,
    }

    if (props.template) {
      fixedExpensesStore.updateTemplate(props.template.id, payload)
    } else {
      fixedExpensesStore.addTemplate(payload)
    }

    // 100% optimista (sección 4.2): el Sheet se cierra al instante, la
    // confirmación/rollback contra Supabase sigue en segundo plano.
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
        <SheetTitle>{{ isEditing ? 'Editar gasto fijo' : 'Nuevo gasto fijo' }}</SheetTitle>
        <SheetDescription v-if="!isEditing">
          Se repite todos los meses. Vas a poder marcarlo como pagado cada vez que corresponda.
        </SheetDescription>
      </SheetHeader>

      <form id="fixed-expense-form" class="flex flex-col gap-4 px-4" novalidate @submit.prevent="onSubmit">
        <!-- 1. Nombre -->
        <div class="flex flex-col gap-1.5">
          <Label for="fixed-nombre">Nombre</Label>
          <Input
            id="fixed-nombre"
            ref="nameInputRef"
            v-model="form.name"
            placeholder="Ej. Alquiler, Netflix"
            maxlength="60"
            class="text-base"
            :disabled="isSaving"
            :aria-invalid="!!errors.name"
          />
          <p v-if="errors.name" class="text-xs text-destructive">
            {{ errors.name }}
          </p>
        </div>

        <!-- 2. Monto -->
        <div class="flex flex-col gap-1.5">
          <Label for="fixed-monto">Monto</Label>
          <div class="flex items-center gap-1.5">
            <span class="text-sm text-muted-foreground">$</span>
            <Input
              id="fixed-monto"
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
            Podés ajustarlo cada mes al marcarlo como pagado, por si varía (como luz o gas).
          </p>
        </div>

        <!-- 3. Categoría -->
        <div class="flex flex-col gap-1.5">
          <Label for="fixed-categoria">Categoría</Label>
          <Select v-model="form.categoryId" :disabled="isSaving">
            <SelectTrigger id="fixed-categoria" ref="categoryTriggerRef" class="h-11 w-full" :aria-invalid="!!errors.category">
              <SelectValue placeholder="Seleccioná una categoría" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Categorías</SelectLabel>
                <SelectItem
                  v-for="category in categoriesStore.defaultCategories"
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

              <template v-if="categoriesStore.customCategories.length">
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Mis categorías</SelectLabel>
                  <SelectItem
                    v-for="category in categoriesStore.customCategories"
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

        <!-- 4. Día de pago -->
        <div class="flex flex-col gap-1.5">
          <Label for="fixed-dia">Día de pago</Label>
          <Input
            id="fixed-dia"
            ref="paymentDayInputRef"
            v-model="form.paymentDay"
            inputmode="numeric"
            type="number"
            min="1"
            max="31"
            placeholder="Ej. 10"
            class="text-base tabular-nums"
            :disabled="isSaving"
            :aria-invalid="!!errors.paymentDay"
          />
          <p v-if="errors.paymentDay" class="text-xs text-destructive">
            {{ errors.paymentDay }}
          </p>
          <p class="text-xs text-muted-foreground">
            Día del mes en que normalmente pagás este gasto. Si el mes no tiene ese día
            (ej. 31 en febrero), tomamos el último día disponible.
          </p>
        </div>

        <!-- 5. Frecuencia (no editable en v1) -->
        <div class="flex flex-col gap-1.5">
          <Label>Frecuencia</Label>
          <div class="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarSync class="size-4" />
            Mensual
          </div>
        </div>

        <!-- 6. Notas -->
        <div class="flex flex-col gap-1.5">
          <Label for="fixed-notas">
            Notas <span class="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <Textarea
            id="fixed-notas"
            v-model="form.notes"
            placeholder="Ej. Débito automático de la tarjeta"
            maxlength="500"
            :disabled="isSaving"
          />
        </div>
      </form>

      <SheetFooter>
        <Button type="submit" form="fixed-expense-form" class="w-full" :disabled="isSaving">
          <Loader2 v-if="isSaving" class="size-4 animate-spin" />
          {{ isEditing ? 'Guardar cambios' : 'Guardar gasto fijo' }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
