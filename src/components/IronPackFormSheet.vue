<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Info, Loader2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { formatTimeShort, isFutureDate, nowTimeInputValue, todayDateInputValue } from '@/lib/date'
import { formatAmount } from '@/lib/currency'
import { useAccountsStore } from '@/stores/accounts'
import { useExpensesStore } from '@/stores/expenses'
import { useIncomesStore } from '@/stores/incomes'
import { useIronStore, type IronPack } from '@/stores/iron'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
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

// iron-ux.md sección 7: alta/edición de compra de cajetilla, con el Switch de
// vínculo opcional a un `expense` real (sección 2). Guardado NO optimista
// cuando toca `expenses` (alta vinculada, o cualquier edición de una compra
// vinculada / que activa o desactiva el vínculo); optimista simple cuando la
// compra nunca estuvo ni queda vinculada — el store resuelve cuál según los
// datos (sección 7.2), acá solo se espera el resultado y se cierra el Sheet.

const props = withDefaults(defineProps<{
  open: boolean
  /** Compra a editar. `null`/`undefined` = modo alta. */
  pack?: IronPack | null
  /** account-id de la compra a editar, si estaba vinculada (lo resuelve el
   * llamador desde `fetchDay().linkedExpenseAccounts`). Ignorado en alta. */
  linkedAccountId?: string | null
}>(), {
  pack: null,
  linkedAccountId: null,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: []
}>()

const accountsStore = useAccountsStore()
const expensesStore = useExpensesStore()
const incomesStore = useIncomesStore()
const ironStore = useIronStore()

const isEditing = computed(() => !!props.pack)
const wasLinked = computed(() => !!props.pack?.linked_expense_id)
const todayValue = computed(() => todayDateInputValue())

const form = reactive({
  cost: '',
  date: todayDateInputValue(),
  time: nowTimeInputValue(),
  linkToExpense: false,
  accountId: null as string | null,
})

const errors = reactive<{ cost?: string, account?: string }>({})
const isSaving = ref(false)

// Sección 2.5: borrado desde el modo edición (el único punto de gestión de una
// compra ya registrada, dado que la fila del Historial abre directo este Sheet).
const isDeleteDialogOpen = ref(false)
const isDeleting = ref(false)

// Sección 8.2 de accounts-income-ux.md: default = cuenta del movimiento más
// reciente; fallback "General"; último recurso, la primera cuenta. Mismo helper
// que `TransactionFormSheet` (las listas pueden estar vacías en el flujo de
// Iron, en cuyo caso cae directo a "General").
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
  errors.cost = undefined
  errors.account = undefined
  isSaving.value = false

  if (props.pack) {
    form.cost = String(props.pack.cost)
    form.date = props.pack.purchased_date
    form.time = formatTimeShort(props.pack.purchased_time)
    form.linkToExpense = !!props.pack.linked_expense_id
    form.accountId = props.pack.linked_expense_id
      ? (props.linkedAccountId ?? defaultAccountId())
      : defaultAccountId()
  } else {
    form.cost = ''
    form.date = todayDateInputValue()
    form.time = nowTimeInputValue()
    form.linkToExpense = false
    form.accountId = defaultAccountId()
  }
}

watch(() => props.open, (isOpen) => {
  if (isOpen) resetForm()
})

// Sección 2.4: al desactivar el toggle, el valor de cuenta se descarta (no
// queda "fantasma"). Al reactivar, se vuelve a proponer el default.
watch(() => form.linkToExpense, (linked) => {
  if (!linked) {
    errors.account = undefined
    form.accountId = null
  } else if (!form.accountId) {
    form.accountId = defaultAccountId()
  }
})

function parseCost(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const normalized = trimmed.replace(',', '.')
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null
  const value = Number(normalized)
  return Number.isFinite(value) && value > 0 ? value : null
}

const parsedCost = computed(() => parseCost(form.cost) ?? 0)

function validate(): boolean {
  errors.cost = undefined
  errors.account = undefined
  let ok = true

  const cost = parseCost(form.cost)
  if (cost === null) {
    errors.cost = 'Ingresá un costo válido'
    ok = false
  }
  if (form.date && isFutureDate(form.date)) {
    // La fecha nunca es futura; sin campo de error propio, se refleja en el
    // `max` del input, pero se valida por las dudas.
    ok = false
  }
  if (form.linkToExpense && !form.accountId) {
    errors.account = 'Elegí una cuenta'
    ok = false
  }
  return ok
}

function handleOpenChange(value: boolean) {
  if (isSaving.value) return
  emit('update:open', value)
}

function preventCloseWhileSaving(event: Event) {
  if (isSaving.value) event.preventDefault()
}

async function onSubmit() {
  if (!validate()) return

  isSaving.value = true
  try {
    const payload = {
      cost: parseCost(form.cost)!,
      purchasedDate: form.date,
      purchasedTime: form.time || nowTimeInputValue(),
      link: form.linkToExpense,
      accountId: form.linkToExpense ? form.accountId : null,
    }

    const result = props.pack
      ? await ironStore.updatePack(props.pack, payload)
      : await ironStore.addPack(payload)

    if ('error' in result) {
      toast.error(
        isEditing.value ? 'No pudimos guardar los cambios' : 'No pudimos registrar la compra',
        { description: 'Revisá tu conexión e intentá de nuevo.' },
      )
      return
    }

    toast.success(isEditing.value ? 'Cambios guardados' : 'Cajetilla registrada')
    emit('saved')
    emit('update:open', false)
  } finally {
    isSaving.value = false
  }
}

async function onConfirmDelete() {
  if (!props.pack) return
  isDeleting.value = true
  try {
    const ok = await ironStore.deletePack(props.pack)
    if (!ok) return
    toast.success('Cajetilla eliminada')
    isDeleteDialogOpen.value = false
    emit('saved')
    emit('update:open', false)
  } finally {
    isDeleting.value = false
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
        <SheetTitle>{{ isEditing ? 'Editar cajetilla' : 'Registrar cajetilla comprada' }}</SheetTitle>
        <SheetDescription v-if="!isEditing">
          Anotá cuánto te costó la cajetilla.
        </SheetDescription>
      </SheetHeader>

      <form id="iron-pack-form" class="flex flex-col gap-4 px-4 sm:px-6" novalidate @submit.prevent="onSubmit">
        <div class="flex flex-col gap-1.5">
          <Label for="costo">Costo</Label>
          <div class="relative">
            <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <Input
              id="costo"
              v-model="form.cost"
              inputmode="decimal"
              type="text"
              placeholder="0"
              class="h-11 pl-7 text-lg font-semibold tabular-nums"
              :disabled="isSaving"
              :aria-invalid="!!errors.cost"
            />
          </div>
          <p v-if="errors.cost" class="text-xs text-destructive">
            {{ errors.cost }}
          </p>
        </div>

        <div class="flex gap-3">
          <div class="flex flex-1 flex-col gap-1.5">
            <Label for="fecha-cajetilla">Fecha</Label>
            <Input
              id="fecha-cajetilla"
              v-model="form.date"
              type="date"
              class="h-11 text-base"
              :max="todayValue"
              :disabled="isSaving"
            />
          </div>
          <div class="flex flex-1 flex-col gap-1.5">
            <Label for="hora-cajetilla">Hora</Label>
            <Input
              id="hora-cajetilla"
              v-model="form.time"
              type="time"
              class="h-11 text-base"
              :disabled="isSaving"
            />
          </div>
        </div>

        <!-- Sección 2.4: Switch de vínculo opcional (default false) -->
        <div class="flex flex-col gap-2 border-t border-border pt-4">
          <div class="flex items-center justify-between gap-3">
            <Label for="link-toggle">Vincular a mis finanzas</Label>
            <Switch id="link-toggle" v-model="form.linkToExpense" :disabled="isSaving" />
          </div>
          <p class="text-xs text-muted-foreground">
            Si lo activás, esta compra también se va a registrar como un gasto real
            en Transacciones y Estadísticas.
          </p>
        </div>

        <div v-if="form.linkToExpense" class="flex flex-col gap-4">
          <Alert v-if="!wasLinked">
            <Info class="size-4" />
            <AlertDescription>
              Se va a crear un gasto de ${{ formatAmount(parsedCost) }} en la
              categoría "Tabaco", con la cuenta que elijas abajo.
            </AlertDescription>
          </Alert>

          <div class="flex flex-col gap-1.5">
            <Label for="cuenta-iron">Cuenta</Label>
            <Select v-model="form.accountId" :disabled="isSaving">
              <SelectTrigger id="cuenta-iron" class="h-11 w-full" :aria-invalid="!!errors.account">
                <SelectValue placeholder="Seleccioná una cuenta" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="account in accountsStore.accounts" :key="account.id" :value="account.id">
                  <span
                    class="size-2.5 rounded-full"
                    :style="{ background: account.color ?? '#6b7280' }"
                  />
                  {{ account.name }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p v-if="errors.account" class="text-xs text-destructive">
              {{ errors.account }}
            </p>
          </div>
        </div>

        <!-- Sección 2.6 caso 3: advertencia al desactivar un vínculo existente -->
        <Alert v-else-if="isEditing && wasLinked" variant="destructive">
          <Info class="size-4" />
          <AlertDescription>
            Si desactivás esto, el gasto de ${{ formatAmount(props.pack?.cost ?? 0) }} va a
            desaparecer de Transacciones y Estadísticas.
          </AlertDescription>
        </Alert>
      </form>

      <SheetFooter class="flex-col gap-2">
        <Button type="submit" form="iron-pack-form" class="h-11 w-full" :disabled="isSaving">
          <Loader2 v-if="isSaving" class="size-4 animate-spin" />
          {{ isSaving ? 'Guardando…' : (isEditing ? 'Guardar cambios' : 'Registrar cajetilla') }}
        </Button>
        <Button
          v-if="isEditing"
          type="button"
          variant="ghost"
          class="h-11 w-full text-destructive hover:text-destructive"
          :disabled="isSaving"
          @click="isDeleteDialogOpen = true"
        >
          Eliminar cajetilla
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>

  <AlertDialog v-model:open="isDeleteDialogOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>¿Eliminar esta cajetilla?</AlertDialogTitle>
        <AlertDialogDescription v-if="wasLinked">
          Esto también va a borrar el gasto de ${{ formatAmount(props.pack?.cost ?? 0) }} asociado
          en Transacciones. Esta acción no se puede deshacer.
        </AlertDialogDescription>
        <AlertDialogDescription v-else>
          Esta acción no se puede deshacer.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="isDeleting">
          Cancelar
        </AlertDialogCancel>
        <!-- `<Button>` común (no `AlertDialogAction`) para evitar el auto-cierre
             y poder mostrar el estado "Eliminando…" — misma convención que
             AccountTransfersView. -->
        <Button variant="destructive" :disabled="isDeleting" @click="onConfirmDelete">
          <Loader2 v-if="isDeleting" class="size-4 animate-spin" />
          {{ isDeleting ? 'Eliminando…' : 'Eliminar' }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
