<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Loader2 } from '@lucide/vue'
import { isFutureDate, todayDateInputValue } from '@/lib/date'
import { resolveAccountColor } from '@/lib/colors'
import { useAccountsStore } from '@/stores/accounts'
import { useCategoriesStore } from '@/stores/categories'
import { useExpensesStore, type ExpenseWithCategory } from '@/stores/expenses'
import { useIncomesStore, type IncomeWithAccount } from '@/stores/incomes'
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

// Renombrado desde `ExpenseFormSheet.vue` (accounts-income-ux.md sección
// 7.1): un único Sheet extendido con un toggle Gasto/Ingreso, en vez de un
// `IncomeFormSheet.vue` separado — `incomes` es simétrica a `expenses` salvo
// por la categoría, así que reusar evita duplicar ~80% del formulario.

export type TransactionType = 'expense' | 'income'

const props = defineProps<{
  open: boolean
  /** Transacción a editar. `null`/`undefined` = modo alta. Discriminada por
   * `kind` para que este único Sheet pueda editar tanto un gasto como un
   * ingreso sin dos props separadas ambiguas. */
  transaction?:
    | { kind: 'expense', expense: ExpenseWithCategory }
    | { kind: 'income', income: IncomeWithAccount }
    | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const expensesStore = useExpensesStore()
const incomesStore = useIncomesStore()
const categoriesStore = useCategoriesStore()
const accountsStore = useAccountsStore()

const isEditing = computed(() => !!props.transaction)
const todayValue = computed(() => todayDateInputValue())

const isDarkNow = computed(() => document.documentElement.classList.contains('dark'))

const form = reactive({
  type: 'expense' as TransactionType,
  amount: '',
  accountId: '',
  categoryId: '',
  date: todayDateInputValue(),
  description: '',
})

const errors = reactive<{ amount?: string, account?: string, category?: string, date?: string }>({})
const isSaving = ref(false)

const amountInputRef = ref<{ $el?: HTMLElement } | null>(null)
const accountTriggerRef = ref<{ $el?: HTMLElement } | null>(null)
const categoryTriggerRef = ref<{ $el?: HTMLElement } | null>(null)
const dateInputRef = ref<HTMLInputElement | null>(null)

// Sección 8.2: default de Cuenta = la del movimiento (gasto o ingreso) más
// reciente ya registrado por el usuario; si todavía no registró ninguno,
// cae a la cuenta "General"; si tampoco existiera (no debería pasar, sección
// 6.5), a la primera cuenta disponible.
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
  errors.amount = undefined
  errors.account = undefined
  errors.category = undefined
  errors.date = undefined

  if (props.transaction?.kind === 'expense') {
    const expense = props.transaction.expense
    form.type = 'expense'
    form.amount = String(expense.amount)
    form.accountId = expense.account_id
    form.categoryId = expense.category_id
    form.date = expense.expense_date
    form.description = expense.description ?? ''
  } else if (props.transaction?.kind === 'income') {
    const income = props.transaction.income
    form.type = 'income'
    form.amount = String(income.amount)
    form.accountId = income.account_id
    form.categoryId = ''
    form.date = income.income_date
    form.description = income.description ?? ''
  } else {
    // Modo alta (sección 7.3): "Gasto" es siempre el default del toggle, sin
    // importar qué tipo se haya cargado la última vez.
    form.type = 'expense'
    form.amount = ''
    form.accountId = defaultAccountId()
    form.categoryId = ''
    form.date = todayDateInputValue()
    form.description = ''
  }
}

// Precarga el form cada vez que el Sheet se abre (alta con valores por
// defecto, o edición con los valores de la transacción seleccionada).
watch(() => props.open, (isOpen) => {
  if (isOpen) resetForm()
})

// Sección 7.3: al cambiar a "Ingreso" se descarta la categoría ya elegida
// (no queda "fantasma" guardada por error).
watch(() => form.type, (type) => {
  if (type === 'income') form.categoryId = ''
})

function parseAmount(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  // Acepta "," o "." como separador decimal (no separador de miles).
  const normalized = trimmed.replace(',', '.')
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

function focusAmount() {
  amountInputRef.value?.$el?.focus()
}
function focusAccount() {
  accountTriggerRef.value?.$el?.focus()
}
function focusCategory() {
  categoryTriggerRef.value?.$el?.focus()
}
function focusDate() {
  dateInputRef.value?.focus()
}

// Orden fijo de validación (sección 7.3): monto -> cuenta -> categoría (si
// aplica) -> fecha, mostrando y enfocando solo el primer error encontrado.
function validate(): boolean {
  errors.amount = undefined
  errors.account = undefined
  errors.category = undefined
  errors.date = undefined

  const amount = parseAmount(form.amount)
  if (amount === null || amount <= 0) {
    errors.amount = 'Ingresá un monto mayor a 0.'
    focusAmount()
    return false
  }

  if (!form.accountId) {
    errors.account = 'Seleccioná una cuenta.'
    focusAccount()
    return false
  }

  if (form.type === 'expense' && !form.categoryId) {
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

// Sección 3.7 de expenses-mvp-ux.md (reusado tal cual): el Sheet no se puede
// cerrar (tap fuera / Escape) mientras se guarda.
function preventCloseWhileSaving(event: Event) {
  if (isSaving.value) event.preventDefault()
}

const sheetTitle = computed(() => {
  if (isEditing.value) return form.type === 'income' ? 'Editar ingreso' : 'Editar gasto'
  return form.type === 'income' ? 'Nuevo ingreso' : 'Nuevo gasto'
})

function onSubmit() {
  if (!validate()) return

  isSaving.value = true
  try {
    const amount = parseAmount(form.amount)!
    const description = form.description.trim() ? form.description.trim() : null

    if (form.type === 'expense') {
      const payload = {
        amount,
        categoryId: form.categoryId,
        accountId: form.accountId,
        description,
        expenseDate: form.date,
      }
      if (props.transaction?.kind === 'expense') {
        expensesStore.updateExpense(props.transaction.expense.id, payload)
      } else {
        expensesStore.addExpense(payload)
      }
    } else {
      const payload = {
        amount,
        accountId: form.accountId,
        description,
        incomeDate: form.date,
      }
      if (props.transaction?.kind === 'income') {
        incomesStore.updateIncome(props.transaction.income.id, payload)
      } else {
        incomesStore.addIncome(payload)
      }
    }

    // El Sheet se cierra inmediatamente (sección 7.3: sigue 100% optimista):
    // la confirmación/rollback contra Supabase sigue en segundo plano.
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
        <SheetTitle>{{ sheetTitle }}</SheetTitle>
        <SheetDescription v-if="!isEditing">
          Completá los datos del movimiento.
        </SheetDescription>
      </SheetHeader>

      <form id="transaction-form" class="flex flex-col gap-4 px-4" novalidate @submit.prevent="onSubmit">
        <!-- 1. Tipo: Gasto / Ingreso (sección 7.3) -->
        <div class="flex flex-col gap-1.5">
          <Label id="tipo-transaccion-label">Tipo</Label>
          <div role="radiogroup" aria-labelledby="tipo-transaccion-label" class="flex gap-1 rounded-md bg-muted p-1">
            <button
              type="button"
              role="radio"
              :aria-checked="form.type === 'expense'"
              class="flex-1 rounded-sm px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :class="form.type === 'expense' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
              :disabled="isEditing || isSaving"
              @click="form.type = 'expense'"
            >
              Gasto
            </button>
            <button
              type="button"
              role="radio"
              :aria-checked="form.type === 'income'"
              class="flex-1 rounded-sm px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :class="form.type === 'income' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
              :disabled="isEditing || isSaving"
              @click="form.type = 'income'"
            >
              Ingreso
            </button>
          </div>
        </div>

        <!-- 2. Monto -->
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

        <!-- 3. Cuenta (sección 8) -->
        <div class="flex flex-col gap-1.5">
          <Label for="cuenta">Cuenta</Label>
          <Select v-model="form.accountId" :disabled="isSaving">
            <SelectTrigger id="cuenta" ref="accountTriggerRef" class="h-11 w-full" :aria-invalid="!!errors.account">
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

        <!-- 4. Categoría — solo si es gasto -->
        <div v-if="form.type === 'expense'" class="flex flex-col gap-1.5">
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

        <!-- 5. Fecha -->
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

        <!-- 6. Descripción -->
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
        <Button type="submit" form="transaction-form" class="w-full" :disabled="isSaving">
          <Loader2 v-if="isSaving" class="size-4 animate-spin" />
          {{ isSaving ? 'Guardando…' : (isEditing ? 'Guardar cambios' : 'Guardar movimiento') }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
