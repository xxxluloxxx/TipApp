<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { toast } from 'vue-sonner'
import {
  ArrowLeftRight,
  ChevronDown,
  CircleArrowDown,
  CircleArrowUp,
  Clock,
  Delete,
  Loader2,
  StickyNote,
  X,
} from '@lucide/vue'
import { formatDateChip, formatTimeShort, isFutureDate, nowTimeInputValue, todayDateInputValue } from '@/lib/date'
import { readableTextColor } from '@/lib/colors'
import { formatAmount } from '@/lib/currency'
import { resolveAccountIcon } from '@/lib/accountIcons'
import { useAccountsStore } from '@/stores/accounts'
import { useCategoriesStore, type CategoryKind } from '@/stores/categories'
import { useAccountTransfersStore } from '@/stores/accountTransfers'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

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

// 'transfer' reusa el mismo Sheet (account-transfers-ux.md): el origen es
// `form.accountId` (la cuenta que colorea el panel) y el destino `toAccountId`.
// A diferencia de gasto/ingreso, el guardado NO es optimista (RPC atómico).
export type TransactionType = 'expense' | 'income' | 'transfer'

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
  /** transactions-filters-ux.md sección 3.5: `ref`s locales a sincronizar de
   * forma optimista, además de la lista maestra del store (mismo mecanismo que
   * `CardExpenseFormSheet`). Usados solo por `TransactionsView`, que trae su
   * propio dato acotado por filtros y ya no lee la lista maestra. Los demás
   * call-sites (`HomeView`/`AccountDetailView`) no los pasan y siguen igual. */
  expenseSyncTargets?: Ref<ExpenseWithCategory[]>[]
  incomeSyncTargets?: Ref<IncomeWithAccount[]>[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  /** Se creó una transferencia: las vistas con listas propias la recargan. */
  'transfer-saved': []
}>()

const expensesStore = useExpensesStore()
const incomesStore = useIncomesStore()
const categoriesStore = useCategoriesStore()
const accountsStore = useAccountsStore()
const accountTransfersStore = useAccountTransfersStore()

const isEditing = computed(() => !!props.transaction)
const todayValue = computed(() => todayDateInputValue())

const form = reactive({
  type: 'expense' as TransactionType,
  amount: '',
  accountId: '',
  /** Solo en Transferencia: cuenta de destino. */
  toAccountId: '',
  /** Solo en Transferencia: comisión opcional (vacío = 0). */
  commission: '',
  categoryId: '',
  date: todayDateInputValue(),
  /** transaction-time-ux.md: hora opcional `"HH:MM"`. Vacía = se guarda `null`. */
  time: nowTimeInputValue(),
  description: '',
})

const errors = reactive<{
  amount?: string
  account?: string
  toAccount?: string
  category?: string
  commission?: string
  date?: string
}>({})

// La comisión sugerida de la cuenta de origen pisa el campo hasta que el
// usuario lo edita a mano (mismo criterio que AccountTransferFormSheet).
const commissionTouched = ref(false)

const isTransfer = computed(() => form.type === 'transfer')
// El destino excluye la cuenta de origen elegida.
const destinationOptions = computed(() =>
  accountsStore.accounts.filter(account => account.id !== form.accountId),
)
const selectedToAccount = computed(() => accountsStore.accountById(form.toAccountId))
const isSaving = ref(false)

// Sección 14.8: la nota (= Descripción) arranca colapsada en alta, expandida
// si ya hay contenido guardado (edición) — set en `resetForm`.
const noteExpanded = ref(false)

const amountInputRef = ref<HTMLInputElement | null>(null)
const dateInputRef = ref<HTMLInputElement | null>(null)

// Sección 16.7.2: cada picker (Cuenta/Categoría) tiene ahora un único trigger
// (no "un elemento por opción" como los chips viejos), así que basta un ref
// simple por trigger para que `focusAccount()`/`focusCategory()` puedan
// enfocar el botón cerrado al fallar la validación (sin abrir el menú).
const accountTriggerRef = ref<HTMLButtonElement | null>(null)
const categoryTriggerRef = ref<HTMLButtonElement | null>(null)
const toAccountTriggerRef = ref<HTMLButtonElement | null>(null)
const commissionInputRef = ref<{ $el?: HTMLElement } | null>(null)

// Categorías del picker, filtradas por el `kind` que corresponde al tipo de
// movimiento activo: un gasto solo puede imputarse a una categoría
// `kind='expense'` y un ingreso a una `kind='income'` (lo exige el trigger de
// validación de `incomes.category_id` en BD, no es solo cosmética).
const categoryKind = computed<CategoryKind>(() => (form.type === 'income' ? 'income' : 'expense'))
const defaultCategoryOptions = computed(() => categoriesStore.defaultCategoriesFor(categoryKind.value))
const customCategoryOptions = computed(() => categoriesStore.customCategoriesFor(categoryKind.value))

// Sección 14.7 / 16.2: default + custom, en ese orden — reusado por el picker
// de 16.2 (agrupación visual con `DropdownMenuLabel`/`DropdownMenuSeparator`)
// y por `selectedCategory` para resolver el nombre mostrado en el trigger.
const allCategories = computed(() => [
  ...defaultCategoryOptions.value,
  ...customCategoryOptions.value,
])

// Sección 14.4: el panel superior se colorea SIEMPRE con el color de la cuenta
// seleccionada (nunca cambia con el tab Ingreso/Gasto — decisión 14.14.1).
const selectedAccount = computed(() => accountsStore.accountById(form.accountId))
// Sección 16.2: cuenta/categoría elegidas, para pintar el valor en cada trigger.
const selectedCategory = computed(() =>
  allCategories.value.find(c => c.id === form.categoryId),
)
const selectedAccountColor = computed(() => selectedAccount.value?.color ?? '#6b7280')
// Contraste calculado contra el color de la cuenta, para que el texto del panel
// siga legible sobre cualquier hex de la paleta.
const textColor = computed(() => readableTextColor(selectedAccountColor.value) ?? '#ffffff')
// Sección 14.4.2: si el texto resuelto es blanco, el panel es oscuro (define el
// tono del fondo semitransparente de la píldora de fecha) — sin tocar colors.ts.
const panelIsDark = computed(() => textColor.value === '#ffffff')
const panelStyle = computed(() => ({ background: selectedAccountColor.value }))

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
  errors.toAccount = undefined
  errors.category = undefined
  errors.commission = undefined
  errors.date = undefined
  form.toAccountId = ''
  form.commission = ''
  commissionTouched.value = false

  if (props.transaction?.kind === 'expense') {
    const expense = props.transaction.expense
    form.type = 'expense'
    form.amount = String(expense.amount)
    form.accountId = expense.account_id
    form.categoryId = expense.category_id
    form.date = expense.expense_date
    // Sección 4: precarga los primeros 5 caracteres del "HH:MM:SS" de Postgres;
    // vacío si la fila no tiene hora (nunca inventa "00:00").
    form.time = expense.expense_time ? formatTimeShort(expense.expense_time) : ''
    form.description = expense.description ?? ''
  } else if (props.transaction?.kind === 'income') {
    const income = props.transaction.income
    form.type = 'income'
    form.amount = String(income.amount)
    form.accountId = income.account_id
    // Ingresos históricos (anteriores a las categorías de ingreso) tienen
    // `category_id` null: se precarga vacío y la validación obliga a elegir
    // una antes de guardar la edición.
    form.categoryId = income.category_id ?? ''
    form.date = income.income_date
    form.time = income.income_time ? formatTimeShort(income.income_time) : ''
    form.description = income.description ?? ''
  } else {
    // Modo alta (sección 7.3): "Gasto" es siempre el default del toggle, sin
    // importar qué tipo se haya cargado la última vez.
    form.type = 'expense'
    form.amount = ''
    form.accountId = props.presetAccountId ?? defaultAccountId()
    form.categoryId = ''
    form.date = todayDateInputValue()
    // Sección 3: default = hora real del dispositivo al abrir el Sheet.
    form.time = nowTimeInputValue()
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

// Sección 7.3: al cambiar de tipo se descarta SIEMPRE la categoría ya elegida
// (en ambos sentidos, no solo al pasar a Ingreso): las categorías de gasto y
// las de ingreso son conjuntos disjuntos por `kind`, así que una categoría
// elegida para el tipo anterior nunca es válida para el nuevo — dejarla
// guardaría un id "fantasma" que la BD rechazaría.
watch(() => form.type, () => {
  form.categoryId = ''
  if (form.type === 'transfer') syncTransferDefaults()
})

// Al entrar a Transferencia o cambiar el origen: limpia un destino que quedó
// igual al origen, sugiere la comisión de la cuenta de origen y, si solo queda
// una cuenta posible de destino, la preselecciona (no hay decisión que tomar).
function syncTransferDefaults() {
  if (form.toAccountId === form.accountId) form.toAccountId = ''
  if (!commissionTouched.value) {
    const origin = accountsStore.accountById(form.accountId)
    form.commission = origin && origin.transfer_commission > 0 ? String(origin.transfer_commission) : ''
  }
  const options = destinationOptions.value
  if (!form.toAccountId && options.length === 1) form.toAccountId = options[0]!.id
}

watch(() => form.accountId, () => {
  if (form.type === 'transfer') syncTransferDefaults()
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

/** Comisión: `>= 0`, vacío se interpreta como 0. */
function parseCommission(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return 0
  const normalized = trimmed.replace(',', '.')
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return undefined
  const value = Number(normalized)
  return Number.isFinite(value) ? value : undefined
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
// Sección 16.7.2: se enfoca el trigger CERRADO (no se abre el menú de forma
// programática) — el usuario confirma la apertura con Enter/Espacio/flecha, ya
// con foco puesto y el error anunciado por el slot único de 14.5.
function focusAccount() {
  accountTriggerRef.value?.focus()
}
function focusCategory() {
  categoryTriggerRef.value?.focus()
}
function focusToAccount() {
  toAccountTriggerRef.value?.focus()
}
function focusCommission() {
  commissionInputRef.value?.$el?.focus()
}
function focusDate() {
  dateInputRef.value?.focus()
}

// Slot de error único (sección 14.5): el primer error truthy, en el mismo
// orden fijo de validación (monto → cuenta → categoría → fecha).
const activeError = computed(
  () => errors.amount ?? errors.account ?? errors.toAccount ?? errors.category ?? errors.commission ?? errors.date,
)

// Orden fijo de validación (sección 7.3): monto -> cuenta -> categoría (si
// aplica) -> fecha, mostrando y enfocando solo el primer error encontrado.
function validate(): boolean {
  errors.amount = undefined
  errors.account = undefined
  errors.toAccount = undefined
  errors.category = undefined
  errors.commission = undefined
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

  if (form.type === 'transfer') {
    if (!form.toAccountId) {
      errors.toAccount = 'Seleccioná la cuenta de destino.'
      focusToAccount()
      return false
    }
    if (parseCommission(form.commission) === undefined) {
      errors.commission = 'Ingresá una comisión válida (0 o mayor), o dejala vacía.'
      focusCommission()
      return false
    }
  } else if (!form.categoryId) {
    // Categoría obligatoria para gasto e ingreso (las transferencias no
    // tienen categoría: la comisión se resuelve server-side).
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
  if (form.type === 'transfer') return 'Nueva transferencia'
  return form.type === 'income' ? 'Nuevo ingreso' : 'Nuevo gasto'
})

async function submitTransfer() {
  isSaving.value = true
  try {
    const result = await accountTransfersStore.createTransfer({
      fromAccountId: form.accountId,
      toAccountId: form.toAccountId,
      amount: parseAmount(form.amount)!,
      commissionAmount: parseCommission(form.commission) ?? 0,
      transferDate: form.date,
      transferTime: form.time ? form.time : null,
      description: form.description.trim() ? form.description.trim() : null,
    })

    if ('error' in result) {
      toast.error('No se pudo guardar la transferencia', {
        description: 'Revisá tu conexión e intentá de nuevo.',
      })
      return
    }

    toast.success('Transferencia registrada')
    emit('transfer-saved')
    emit('update:open', false)
  } finally {
    isSaving.value = false
  }
}

function onSubmit() {
  if (!validate()) return

  // Transferencia: NO optimista (RPC atómico), el Sheet espera la confirmación.
  if (form.type === 'transfer') {
    void submitTransfer()
    return
  }

  isSaving.value = true
  try {
    const amount = parseAmount(form.amount)!
    const description = form.description.trim() ? form.description.trim() : null
    // Sección 4/5: campo opcional — vacío se persiste como `null`, nunca "00:00".
    const time = form.time ? form.time : null

    if (form.type === 'expense') {
      const payload = {
        amount,
        categoryId: form.categoryId,
        accountId: form.accountId,
        description,
        expenseDate: form.date,
        expenseTime: time,
      }
      const expenseTargets = props.expenseSyncTargets ?? []
      if (props.transaction?.kind === 'expense') {
        expensesStore.updateExpense(props.transaction.expense.id, payload, expenseTargets)
      } else {
        expensesStore.addExpense(payload, expenseTargets)
      }
    } else {
      const payload = {
        amount,
        accountId: form.accountId,
        categoryId: form.categoryId,
        description,
        incomeDate: form.date,
        incomeTime: time,
      }
      const incomeTargets = props.incomeSyncTargets ?? []
      if (props.transaction?.kind === 'income') {
        incomesStore.updateIncome(props.transaction.income.id, payload, incomeTargets)
      } else {
        incomesStore.addIncome(payload, incomeTargets)
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
      class="h-[100dvh] max-h-[100dvh] w-full max-w-none gap-2 rounded-none border-t-0 data-[side=bottom]:h-[100dvh]"
      :show-close-button="!isSaving"
      @escape-key-down="preventCloseWhileSaving"
      @interact-outside="preventCloseWhileSaving"
    >
      <SheetHeader class="gap-1 p-3">
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
        class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"
        novalidate
        @submit.prevent="onSubmit"
      >
        <!-- 14.3 — Tabs Ingreso / Gasto / Transferencia -->
        <div id="tipo-transaccion-label" class="sr-only">Tipo de movimiento</div>
        <div
          role="radiogroup"
          aria-labelledby="tipo-transaccion-label"
          class="grid grid-cols-3 gap-2 px-4"
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
          <button
            type="button"
            role="radio"
            :aria-checked="form.type === 'transfer'"
            :disabled="isEditing || isSaving"
            class="flex min-h-11 items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            :class="form.type === 'transfer' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'"
            @click="form.type = 'transfer'"
          >
            <ArrowLeftRight class="size-4" /> Transferir
          </button>
        </div>

        <!-- 14.4 — Panel superior coloreado por la cuenta seleccionada -->
        <div class="mx-4 rounded-xl p-4" :style="panelStyle">
          <!-- transaction-time-ux.md sección 1: fila de 2 píldoras (Fecha + Hora),
               mismo tratamiento visual, alineadas a la derecha. -->
          <div class="ml-auto flex w-fit items-center gap-2">
            <!-- 14.4.2 — Píldora de fecha (input date nativo invisible encima) -->
            <div class="relative">
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
                class="absolute inset-0 size-full cursor-pointer text-base opacity-0 disabled:cursor-not-allowed"
              >
            </div>

            <!-- transaction-time-ux.md sección 1: píldora de hora (opcional).
                 Con valor: Clock + "HH:MM" + botón × para vaciar. Sin valor:
                 Clock + "Agregar hora" atenuado. El input time invisible captura
                 el tap para abrir el picker nativo; el × queda por encima (z-10)
                 y con @click.stop para no abrir el picker al limpiar. -->
            <div
              class="relative flex min-h-9 items-center gap-1 rounded-full px-3 text-sm font-medium"
              :style="{ background: panelIsDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)', color: textColor }"
            >
              <Clock class="size-3.5 shrink-0" />
              <span v-if="form.time">{{ formatTimeShort(form.time) }}</span>
              <span v-else class="opacity-70">Agregar hora</span>
              <input
                v-model="form.time"
                type="time"
                :disabled="isSaving"
                aria-label="Hora del movimiento"
                class="absolute inset-0 size-full cursor-pointer text-base opacity-0 disabled:cursor-not-allowed"
              >
              <button
                v-if="form.time"
                type="button"
                :disabled="isSaving"
                aria-label="Quitar hora"
                class="relative z-10 -mr-1 flex size-5 shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-60"
                :style="{ background: panelIsDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)' }"
                @click.stop="form.time = ''"
              >
                <X class="size-3" />
              </button>
            </div>
          </div>

          <!-- 14.4.3 — Monto gigante (número visual + input accesible oculto) -->
          <div class="relative my-3 text-center">
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

          <!-- 16.2 — 2 columnas dentro del panel: Cuenta / Categoría, ambas
               siempre visibles (la categoría ya no es exclusiva del Gasto). -->
          <div
            class="mt-3 grid grid-cols-2 gap-2 border-t pt-3"
            :style="{ borderColor: panelIsDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)' }"
          >
            <!-- Columna Cuenta (en Transferencia: "De la cuenta") -->
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <button
                  ref="accountTriggerRef"
                  type="button"
                  :disabled="isSaving"
                  :aria-invalid="!!errors.account"
                  class="flex min-h-11 flex-col items-start justify-center gap-0.5 rounded-lg px-2 py-1.5 text-left transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  :style="{
                    color: textColor,
                    outline: errors.account ? `2px solid ${textColor}` : undefined,
                    outlineOffset: errors.account ? '2px' : undefined,
                  }"
                >
                  <span class="text-xs opacity-80">{{ isTransfer ? 'De la cuenta' : 'Cuenta' }}</span>
                  <span class="flex w-full items-center gap-1 text-sm font-bold">
                    <span class="truncate">{{ selectedAccount?.name ?? 'Elegí una cuenta' }}</span>
                    <ChevronDown class="size-3.5 shrink-0 opacity-70" />
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" class="w-64 min-w-64 max-w-[85vw]">
                <DropdownMenuLabel>Tus cuentas</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  :model-value="form.accountId"
                  @update:model-value="(v) => { form.accountId = String(v) }"
                >
                  <DropdownMenuRadioItem
                    v-for="account in accountsStore.accounts"
                    :key="account.id"
                    :value="account.id"
                  >
                    <component
                      :is="resolveAccountIcon(account.icon)"
                      class="size-4 shrink-0"
                      :style="{ color: account.color ?? '#6b7280' }"
                    />
                    <span class="flex-1 truncate">{{ account.name }}</span>
                    <span class="text-xs text-muted-foreground">
                      ${{ formatAmount(accountsStore.balanceFor(account.id)) }}
                    </span>
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <!-- Columna "A la cuenta" (solo Transferencia; excluye el origen) -->
            <DropdownMenu v-if="isTransfer">
              <DropdownMenuTrigger as-child>
                <button
                  ref="toAccountTriggerRef"
                  type="button"
                  :disabled="isSaving"
                  :aria-invalid="!!errors.toAccount"
                  class="flex min-h-11 flex-col items-start justify-center gap-0.5 rounded-lg px-2 py-1.5 text-left transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  :style="{
                    color: textColor,
                    outline: errors.toAccount ? `2px solid ${textColor}` : undefined,
                    outlineOffset: errors.toAccount ? '2px' : undefined,
                  }"
                >
                  <span class="text-xs opacity-80">A la cuenta</span>
                  <span class="flex w-full items-center gap-1 text-sm font-bold">
                    <span class="truncate">{{ selectedToAccount?.name ?? 'Elegí una cuenta' }}</span>
                    <ChevronDown class="size-3.5 shrink-0 opacity-70" />
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-64 min-w-64 max-w-[85vw]">
                <DropdownMenuLabel>Cuenta de destino</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  :model-value="form.toAccountId"
                  @update:model-value="(v) => { form.toAccountId = String(v) }"
                >
                  <DropdownMenuRadioItem
                    v-for="account in destinationOptions"
                    :key="account.id"
                    :value="account.id"
                  >
                    <component
                      :is="resolveAccountIcon(account.icon)"
                      class="size-4 shrink-0"
                      :style="{ color: account.color ?? '#6b7280' }"
                    />
                    <span class="flex-1 truncate">{{ account.name }}</span>
                    <span class="text-xs text-muted-foreground">
                      ${{ formatAmount(accountsStore.balanceFor(account.id)) }}
                    </span>
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <!-- Columna Categoría (Gasto e Ingreso; el listado se filtra por
                 `kind` según el tipo activo) -->
            <DropdownMenu v-else>
              <DropdownMenuTrigger as-child>
                <button
                  ref="categoryTriggerRef"
                  type="button"
                  :disabled="isSaving"
                  :aria-invalid="!!errors.category"
                  class="flex min-h-11 flex-col items-start justify-center gap-0.5 rounded-lg px-2 py-1.5 text-left transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  :style="{
                    color: textColor,
                    outline: errors.category ? `2px solid ${textColor}` : undefined,
                    outlineOffset: errors.category ? '2px' : undefined,
                  }"
                >
                  <span class="text-xs opacity-80">Categoría</span>
                  <span class="flex w-full items-center gap-1 text-sm font-bold">
                    <span class="truncate">{{ selectedCategory?.name ?? 'Elegí una categoría' }}</span>
                    <ChevronDown class="size-3.5 shrink-0 opacity-70" />
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-64 min-w-64 max-w-[85vw]">
                <DropdownMenuLabel>Categorías</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  :model-value="form.categoryId"
                  @update:model-value="(v) => { form.categoryId = String(v) }"
                >
                  <DropdownMenuRadioItem
                    v-for="category in defaultCategoryOptions"
                    :key="category.id"
                    :value="category.id"
                  >
                    <span
                      class="size-2.5 shrink-0 rounded-full"
                      :style="{ background: category.color ?? 'var(--color-muted-foreground)' }"
                    />
                    <span class="truncate">{{ category.name }}</span>
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <template v-if="customCategoryOptions.length">
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Mis categorías</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    :model-value="form.categoryId"
                    @update:model-value="(v) => { form.categoryId = String(v) }"
                  >
                    <DropdownMenuRadioItem
                      v-for="category in customCategoryOptions"
                      :key="category.id"
                      :value="category.id"
                    >
                      <span
                        class="size-2.5 shrink-0 rounded-full"
                        :style="{ background: category.color ?? 'var(--color-muted-foreground)' }"
                      />
                      <span class="truncate">{{ category.name }}</span>
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </template>
              </DropdownMenuContent>
            </DropdownMenu>
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
          <div v-else class="flex flex-col gap-1">
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

        <!-- Comisión (solo Transferencia, opcional): si es > 0 el servidor
             crea un gasto "Comisiones bancarias". -->
        <div v-if="isTransfer" class="flex flex-col gap-1 px-4">
          <Label for="comision">
            Comisión <span class="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <Input
            id="comision"
            ref="commissionInputRef"
            v-model="form.commission"
            inputmode="decimal"
            placeholder="0"
            :disabled="isSaving"
            :aria-invalid="!!errors.commission"
            @input="commissionTouched = true"
          />
        </div>

      </form>

      <SheetFooter class="p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <Button type="submit" form="transaction-form" class="w-full" :disabled="isSaving">
          <Loader2 v-if="isSaving" class="size-4 animate-spin" />
          {{ isSaving ? 'Guardando…' : (isEditing ? 'Guardar cambios' : (isTransfer ? 'Guardar transferencia' : 'Guardar movimiento')) }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
