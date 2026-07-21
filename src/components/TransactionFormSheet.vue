<script setup lang="ts">
import { computed, reactive, ref, watch, type ComponentPublicInstance } from 'vue'
import {
  Check,
  ChevronDown,
  CircleArrowDown,
  CircleArrowUp,
  Delete,
  Loader2,
  StickyNote,
} from '@lucide/vue'
import { formatDateChip, isFutureDate, todayDateInputValue } from '@/lib/date'
import { readableTextColor, resolveAccountColor, withAlpha } from '@/lib/colors'
import { formatAmount } from '@/lib/currency'
import { resolveAccountIcon } from '@/lib/accountIcons'
import { useAccountsStore } from '@/stores/accounts'
import { useCategoriesStore } from '@/stores/categories'
import { useExpensesStore, type ExpenseWithCategory } from '@/stores/expenses'
import { useIncomesStore, type IncomeWithAccount } from '@/stores/incomes'
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

// Renombrado desde `ExpenseFormSheet.vue` (accounts-income-ux.md sección
// 7.1): un único Sheet extendido con un toggle Gasto/Ingreso, en vez de un
// `IncomeFormSheet.vue` separado — `incomes` es simétrica a `expenses` salvo
// por la categoría, así que reusar evita duplicar ~80% del formulario.
//
// Sección 14: rediseño "calculadora" del layout (tabs → panel coloreado por
// cuenta → slot de error único → teclado numérico → chips de categoría/cuenta
// → nota). La lógica de negocio (`form`/`errors`/`validate()`/`onSubmit()`/
// `resetForm()`, mismo orden de validación, mismo optimistic update) NO cambia
// — solo cambia cómo se ingresan/muestran los mismos 5 campos de siempre.

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
  /** account-detail-ux.md sección 7.5: cuenta a preseleccionar en modo alta
   * (AccountDetailView). Ignorado en modo edición (`transaction` ya trae su
   * propia `account_id`). Es solo un DEFAULT, no bloquea la selección de
   * Cuenta — el usuario puede seguir cambiándola. Retrocompatible: los
   * call-sites que no la pasan siguen cayendo a `defaultAccountId()`. */
  presetAccountId?: string | null
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

// Sección 14.8: la nota (= Descripción) arranca colapsada en alta, expandida
// si ya hay contenido guardado (edición) — set en `resetForm`.
const noteExpanded = ref(false)

const amountInputRef = ref<HTMLInputElement | null>(null)
const dateInputRef = ref<HTMLInputElement | null>(null)

// Sección 14.5/14.7/14.9: los chips de categoría/cuenta son la nueva "fila de
// selección" — se guardan sus elementos por id (function ref) para que
// `focusCategory()`/`focusAccount()` puedan enfocar el chip seleccionado (o el
// primero) sin depender del orden del array de refs de un `v-for`.
const categoryChipEls = new Map<string, HTMLButtonElement>()
const accountChipEls = new Map<string, HTMLButtonElement>()

function setCategoryChipRef(id: string) {
  return (el: Element | ComponentPublicInstance | null) => {
    if (el) categoryChipEls.set(id, el as HTMLButtonElement)
    else categoryChipEls.delete(id)
  }
}
function setAccountChipRef(id: string) {
  return (el: Element | ComponentPublicInstance | null) => {
    if (el) accountChipEls.set(id, el as HTMLButtonElement)
    else accountChipEls.delete(id)
  }
}

// Sección 14.7: fila de chips = default + custom, en ese orden, sin
// encabezados de grupo (decisión aceptada, riesgo 14.14.2).
const allCategories = computed(() => [
  ...categoriesStore.defaultCategories,
  ...categoriesStore.customCategories,
])

// Sección 14.4: el panel superior se colorea SIEMPRE con el color de la cuenta
// seleccionada (nunca cambia con el tab Ingreso/Gasto — decisión 14.14.1).
const selectedAccount = computed(() => accountsStore.accountById(form.accountId))
const selectedAccountColor = computed(() => selectedAccount.value?.color ?? '#6b7280')
// Color realmente pintado (respeta la variante `darkHex` en modo oscuro).
const panelBg = computed(() => resolveAccountColor(selectedAccountColor.value, isDarkNow.value))
// Contraste calculado contra el color PINTADO (no el hex claro guardado), para
// que el texto siga legible también cuando el panel usa la variante oscura.
const textColor = computed(() => readableTextColor(panelBg.value) ?? '#ffffff')
// Sección 14.4.2: si el texto resuelto es blanco, el panel es oscuro (define el
// tono del fondo semitransparente de la píldora de fecha) — sin tocar colors.ts.
const panelIsDark = computed(() => textColor.value === '#ffffff')
const panelStyle = computed(() => ({ background: panelBg.value }))
const selectedAccountBalance = computed(() => accountsStore.balanceFor(form.accountId))

// Sección 14.4.3: número gigante SOLO visual (aria-hidden). Parte entera
// agrupada de a miles con `formatAmount`; parte decimal tal cual la tipeó el
// usuario, sin reformatear (para no "corregir" un `,` final mientras escribe).
const liveFormattedAmount = computed(() => {
  const raw = form.amount
  if (!raw) return '0'
  const commaIndex = raw.indexOf(',')
  if (commaIndex === -1) {
    const intVal = Number(raw)
    return Number.isFinite(intVal) ? formatAmount(intVal) : raw
  }
  const intPart = raw.slice(0, commaIndex)
  const decPart = raw.slice(commaIndex + 1)
  const intVal = Number(intPart === '' ? '0' : intPart)
  const intFormatted = Number.isFinite(intVal) ? formatAmount(intVal) : (intPart || '0')
  return `${intFormatted},${decPart}`
})

// Sección 14.4.3: anuncio del monto para lectores de pantalla, con debounce de
// ~300ms para no leer el número completo en cada dígito tipeado.
const srAmountAnnouncement = ref('')
let announceTimer: ReturnType<typeof setTimeout> | undefined
watch(() => form.amount, () => {
  if (announceTimer) clearTimeout(announceTimer)
  announceTimer = setTimeout(() => {
    const parsed = parseAmount(form.amount)
    srAmountAnnouncement.value = parsed !== null ? `Monto: $${formatAmount(parsed)}` : 'Monto: $0'
  }, 300)
})

// Sección 14.4.2: etiqueta corta de la píldora de fecha ("Hoy"/"Ayer"/"12 jul").
const dateChipLabel = computed(() => formatDateChip(form.date))

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
    form.accountId = props.presetAccountId ?? defaultAccountId()
    form.categoryId = ''
    form.date = todayDateInputValue()
    form.description = ''
  }

  // Sección 14.8: expandida solo si ya hay una nota guardada (no perder de
  // vista un dato existente); colapsada en alta / edición sin descripción.
  noteExpanded.value = !!form.description
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

// --- Sección 14.6: teclado numérico (muta `form.amount`, el mismo string de
// siempre, sin cambiar el formato que valida/envía `parseAmount`). ---

function appendDigit(digit: string) {
  const current = form.amount
  // Si está vacío o es "0" y se toca un dígito, REEMPLAZA (no concatena "00…").
  if (current === '' || current === '0') {
    form.amount = digit
    return
  }
  // Una vez que hay ",", se limita a 2 decimales (el tercero no se agrega).
  const commaIndex = current.indexOf(',')
  if (commaIndex !== -1 && current.length - commaIndex - 1 >= 2) return
  form.amount = current + digit
}

function appendDecimalSeparator() {
  const current = form.amount
  if (current.includes(',')) return // no una segunda coma
  form.amount = current === '' ? '0,' : `${current},`
}

function backspace() {
  if (!form.amount) return
  form.amount = form.amount.slice(0, -1)
}

// --- Sección 14.5: foco al control del primer error (mapeo re-apuntado a los
// nuevos controles: input de monto oculto, chips, píldora de fecha). ---

function focusAmount() {
  amountInputRef.value?.focus()
}
function focusAccount() {
  const el = accountChipEls.get(form.accountId) ?? accountChipEls.get(accountsStore.accounts[0]?.id ?? '')
  el?.focus()
}
function focusCategory() {
  const el = categoryChipEls.get(form.categoryId) ?? categoryChipEls.get(allCategories.value[0]?.id ?? '')
  el?.focus()
}
function focusDate() {
  dateInputRef.value?.focus()
}

// Slot de error único (sección 14.5): el primer error truthy, en el mismo
// orden fijo de validación (monto → cuenta → categoría → fecha).
const activeError = computed(
  () => errors.amount ?? errors.account ?? errors.category ?? errors.date,
)

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
      class="max-h-[92dvh]"
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

      <!-- Sección 14.2: todo el contenido (tabs → panel → error → teclado →
           categoría → nota → cuentas) en el área scrolleable; el footer queda
           fijo al pie. `max-h`/`overflow-y-auto` porque el teclado numérico
           hace el Sheet más alto que el layout apilado anterior. -->
      <form
        id="transaction-form"
        class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
        novalidate
        @submit.prevent="onSubmit"
      >
        <!-- 14.3 — Tabs Ingreso / Gasto (2, no 3) -->
        <div id="tipo-transaccion-label" class="sr-only">Tipo de movimiento</div>
        <div
          role="radiogroup"
          aria-labelledby="tipo-transaccion-label"
          class="grid grid-cols-2 gap-2 px-4"
        >
          <button
            type="button"
            role="radio"
            :aria-checked="form.type === 'income'"
            :disabled="isEditing || isSaving"
            class="flex min-h-11 items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            :class="form.type === 'income' ? 'bg-success/10 text-success' : 'text-muted-foreground hover:bg-muted'"
            @click="form.type = 'income'"
          >
            <CircleArrowDown class="size-4" /> Ingreso
          </button>
          <button
            type="button"
            role="radio"
            :aria-checked="form.type === 'expense'"
            :disabled="isEditing || isSaving"
            class="flex min-h-11 items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            :class="form.type === 'expense' ? 'bg-destructive/10 text-destructive' : 'text-muted-foreground hover:bg-muted'"
            @click="form.type = 'expense'"
          >
            <CircleArrowUp class="size-4" /> Gasto
          </button>
        </div>

        <!-- 14.4 — Panel superior coloreado por la cuenta seleccionada -->
        <div class="mx-4 rounded-xl p-5" :style="panelStyle">
          <!-- 14.4.2 — Píldora de fecha (input date nativo invisible encima) -->
          <div class="relative ml-auto w-fit">
            <button
              type="button"
              :disabled="isSaving"
              class="flex min-h-9 items-center gap-1 rounded-full px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
              :style="{ background: panelIsDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)', color: textColor }"
            >
              {{ dateChipLabel }} <ChevronDown class="size-3.5" />
            </button>
            <input
              ref="dateInputRef"
              v-model="form.date"
              type="date"
              :max="todayValue"
              :disabled="isSaving"
              :aria-invalid="!!errors.date"
              aria-label="Fecha del movimiento"
              class="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            >
          </div>

          <!-- 14.4.3 — Monto gigante (número visual + input accesible oculto) -->
          <div class="relative my-4 text-center">
            <p
              aria-hidden="true"
              class="text-5xl font-bold tabular-nums tracking-tight"
              :style="{ color: textColor }"
            >
              ${{ liveFormattedAmount }}
            </p>
            <input
              ref="amountInputRef"
              v-model="form.amount"
              inputmode="decimal"
              type="text"
              :disabled="isSaving"
              :aria-invalid="!!errors.amount"
              aria-label="Monto"
              class="absolute inset-0 size-full cursor-default opacity-0"
            >
            <span aria-live="polite" class="sr-only">{{ srAmountAnnouncement }}</span>
          </div>

          <!-- 14.4.4 — Fila de cuenta (contexto; el cambio real está en 14.9) -->
          <div
            class="mt-3 flex items-center justify-center gap-2 text-sm font-medium"
            :style="{ color: textColor }"
          >
            <component :is="resolveAccountIcon(selectedAccount?.icon)" class="size-4 shrink-0" />
            <span>Cuenta: {{ selectedAccount?.name ?? '—' }} · ${{ formatAmount(selectedAccountBalance) }}</span>
          </div>
        </div>

        <!-- 14.5 — Slot de error único (sobre fondo neutro del Sheet) -->
        <p
          v-if="activeError"
          role="alert"
          class="-mt-1 px-4 text-center text-sm font-medium text-destructive"
        >
          {{ activeError }}
        </p>

        <!-- 14.6 — Teclado numérico (solo dígitos, sin operadores) -->
        <div class="grid grid-cols-3 gap-2 px-4">
          <button
            v-for="key in ['7', '8', '9', '4', '5', '6', '1', '2', '3']"
            :key="key"
            type="button"
            class="flex h-14 items-center justify-center rounded-lg bg-muted text-xl font-medium tabular-nums transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="isSaving"
            @click="appendDigit(key)"
          >
            {{ key }}
          </button>

          <button
            type="button"
            aria-label="Coma decimal"
            :disabled="isSaving"
            class="flex h-14 items-center justify-center rounded-lg bg-muted text-xl font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            @click="appendDecimalSeparator"
          >
            ,
          </button>
          <button
            type="button"
            :disabled="isSaving"
            class="flex h-14 items-center justify-center rounded-lg bg-muted text-xl font-medium tabular-nums transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            @click="appendDigit('0')"
          >
            0
          </button>
          <button
            type="button"
            aria-label="Borrar el último dígito"
            :disabled="isSaving"
            class="flex h-14 items-center justify-center rounded-lg bg-muted transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            @click="backspace"
          >
            <Delete class="size-5" />
          </button>
        </div>

        <!-- 14.7 — Categoría (solo si Gasto) -->
        <div v-if="form.type === 'expense'">
          <p id="categoria-chips-label" class="px-4 text-xs font-medium text-muted-foreground">
            Categoría
          </p>
          <div
            role="listbox"
            aria-labelledby="categoria-chips-label"
            class="mt-1.5 flex gap-2 overflow-x-auto px-4 pb-1"
          >
            <button
              v-for="category in allCategories"
              :key="category.id"
              :ref="setCategoryChipRef(category.id)"
              type="button"
              role="option"
              :aria-selected="form.categoryId === category.id"
              :disabled="isSaving"
              class="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              :class="form.categoryId === category.id ? 'border-transparent' : 'border-border text-muted-foreground'"
              :style="form.categoryId === category.id ? { background: withAlpha(category.color, 0.18), color: category.color ?? undefined } : undefined"
              @click="form.categoryId = category.id"
            >
              <span
                class="size-2 rounded-full"
                :style="{ background: category.color ?? 'var(--color-muted-foreground)' }"
              />
              {{ category.name }}
              <Check v-if="form.categoryId === category.id" class="size-3.5" />
            </button>
          </div>
        </div>

        <!-- 14.8 — "Agregar nota" (= campo Descripción ya existente) -->
        <div class="px-4">
          <button
            v-if="!noteExpanded"
            type="button"
            :disabled="isSaving"
            class="flex min-h-11 items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            @click="noteExpanded = true"
          >
            <StickyNote class="size-4" /> Agregar nota
          </button>
          <div v-else class="flex flex-col gap-1.5">
            <Label for="descripcion">
              Nota <span class="font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Input
              id="descripcion"
              v-model="form.description"
              placeholder="Ej. Almuerzo con el equipo"
              maxlength="200"
              :disabled="isSaving"
            />
          </div>
        </div>

        <!-- 14.9 — "Tus cuentas" (cambia la cuenta seleccionada al instante) -->
        <div class="pb-1">
          <p id="cuentas-chips-label" class="px-4 text-xs font-medium text-muted-foreground">
            Tus cuentas
          </p>
          <div
            role="listbox"
            aria-labelledby="cuentas-chips-label"
            class="mt-1.5 flex gap-2 overflow-x-auto px-4 pb-1"
          >
            <button
              v-for="account in accountsStore.accounts"
              :key="account.id"
              :ref="setAccountChipRef(account.id)"
              type="button"
              role="option"
              :aria-selected="form.accountId === account.id"
              :disabled="isSaving"
              class="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              :class="form.accountId === account.id ? 'border-transparent' : 'border-border text-muted-foreground'"
              :style="form.accountId === account.id ? { background: withAlpha(resolveAccountColor(account.color ?? '#6b7280', isDarkNow), 0.18), color: resolveAccountColor(account.color ?? '#6b7280', isDarkNow) } : undefined"
              @click="form.accountId = account.id"
            >
              <component :is="resolveAccountIcon(account.icon)" class="size-3.5" />
              {{ account.name }} · ${{ formatAmount(accountsStore.balanceFor(account.id)) }}
              <Check v-if="form.accountId === account.id" class="size-3.5" />
            </button>
          </div>
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
