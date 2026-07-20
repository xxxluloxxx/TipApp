<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Loader2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { isFutureDate, todayDateInputValue } from '@/lib/date'
import { useAccountsStore } from '@/stores/accounts'
import { useAccountTransfersStore, type AccountTransfer } from '@/stores/accountTransfers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

// Sección 4 de account-transfers-ux.md: Sheet de alta/edición de una
// transferencia entre dos cuentas propias. Guardado NO optimista en ambos
// modos (sección 4.3): el Sheet permanece abierto en "Guardando…" hasta la
// confirmación atómica del servidor (RPC que ajusta las dos cuentas + crea/
// actualiza/borra el gasto de comisión).

const props = withDefaults(defineProps<{
  open: boolean
  /** Transferencia a editar. `null`/`undefined` = modo alta. */
  transfer?: AccountTransfer | null
}>(), {
  transfer: null,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const accountsStore = useAccountsStore()
const accountTransfersStore = useAccountTransfersStore()

const isEditing = computed(() => !!props.transfer)
const todayValue = computed(() => todayDateInputValue())

const form = reactive({
  fromAccountId: null as string | null,
  toAccountId: null as string | null,
  amount: '',
  commission: '',
  date: todayDateInputValue(),
  description: '',
})

// Sección 4.4: en alta arranca en `false` (el sugerido de la cuenta pisa el
// campo hasta que el usuario lo edita); en edición arranca en `true` (nunca
// pisa el valor ya guardado de esta transferencia puntual).
const commissionTouched = ref(false)

const errors = reactive<{
  fromAccountId?: string
  toAccountId?: string
  amount?: string
  commission?: string
  date?: string
}>({})
const isSaving = ref(false)

// Sección 4.2: el destino excluye la cuenta de origen ya elegida — computed
// reactivo, no un snapshot tomado al abrir el Sheet.
const destinationOptions = computed(() =>
  accountsStore.accounts.filter(account => account.id !== form.fromAccountId),
)

function resetForm() {
  errors.fromAccountId = undefined
  errors.toAccountId = undefined
  errors.amount = undefined
  errors.commission = undefined
  errors.date = undefined

  if (props.transfer) {
    form.fromAccountId = props.transfer.from_account_id
    form.toAccountId = props.transfer.to_account_id
    form.amount = String(props.transfer.amount)
    // Sección 4.4: en edición se precarga el valor guardado de ESTA
    // transferencia, nunca el `transfer_commission` actual de la cuenta.
    form.commission = String(props.transfer.commission_amount)
    form.date = props.transfer.transfer_date
    form.description = props.transfer.description ?? ''
    commissionTouched.value = true
  } else {
    form.fromAccountId = null
    form.toAccountId = null
    form.amount = ''
    form.commission = ''
    form.date = todayDateInputValue()
    form.description = ''
    commissionTouched.value = false
  }
}

watch(() => props.open, (isOpen) => {
  if (isOpen) resetForm()
})

/**
 * Handler de cambio de cuenta de origen (secciones 4.2 y 4.4). Se dispara vía
 * `@update:model-value` del `Select` de origen (sólo en interacción real del
 * usuario, no en el reset programático), así que a esta altura
 * `form.fromAccountId` ya tiene el valor nuevo.
 */
function onOriginChange() {
  const originId = form.fromAccountId
  if (!originId) return

  // Sección 4.2: si el destino ya elegido quedó igual al nuevo origen, se
  // limpia (silencioso — `destinationOptions` ya no lo incluye).
  if (form.toAccountId === originId) form.toAccountId = null

  // Sección 4.4: el sugerido de la cuenta recién elegida sólo pisa el campo si
  // el usuario todavía no lo editó a mano en esta sesión del formulario.
  if (!commissionTouched.value) {
    const account = accountsStore.accountById(originId)
    form.commission = String(account?.transfer_commission ?? 0)
  }

  // Sección 4.2: si tras elegir origen queda una única opción de destino
  // (el usuario tiene exactamente 2 cuentas), se preselecciona — no hay
  // ninguna decisión real que tomar.
  const options = destinationOptions.value
  if (options.length === 1) form.toAccountId = options[0]!.id
}

function parseAmount(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const normalized = trimmed.replace(',', '.')
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

/** Comisión: `>= 0`, vacío se interpreta como 0 (sección 4.6). */
function parseCommission(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return 0
  const normalized = trimmed.replace(',', '.')
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return undefined
  const value = Number(normalized)
  return Number.isFinite(value) ? value : undefined
}

function validate(): boolean {
  errors.fromAccountId = undefined
  errors.toAccountId = undefined
  errors.amount = undefined
  errors.commission = undefined
  errors.date = undefined
  let ok = true

  if (!form.fromAccountId) {
    errors.fromAccountId = 'Elegí la cuenta de origen.'
    ok = false
  }

  if (!form.toAccountId) {
    errors.toAccountId = 'Elegí la cuenta de destino.'
    ok = false
  }

  const amount = parseAmount(form.amount)
  if (amount === null || amount <= 0) {
    errors.amount = 'Ingresá un monto mayor a 0.'
    ok = false
  }

  const commission = parseCommission(form.commission)
  if (commission === undefined) {
    errors.commission = 'Ingresá un monto válido (0 o mayor), o dejalo vacío.'
    ok = false
  }

  if (!form.date) {
    errors.date = 'Seleccioná una fecha.'
    ok = false
  } else if (isFutureDate(form.date)) {
    errors.date = 'La fecha no puede ser futura.'
    ok = false
  }

  return ok
}

function handleOpenChange(value: boolean) {
  // Sección 4.3: no se puede cerrar mientras hay un roundtrip en vuelo.
  if (isSaving.value) return
  emit('update:open', value)
}

// Sección 4.3: bloquea cerrar por Escape / tap fuera mientras se guarda.
function preventCloseWhileSaving(event: Event) {
  if (isSaving.value) event.preventDefault()
}

async function onSubmit() {
  if (!validate()) return

  const amount = parseAmount(form.amount)!
  const commission = parseCommission(form.commission) ?? 0

  isSaving.value = true
  try {
    const payload = {
      fromAccountId: form.fromAccountId!,
      toAccountId: form.toAccountId!,
      amount,
      commissionAmount: commission,
      transferDate: form.date,
      description: form.description.trim() ? form.description.trim() : null,
    }

    const result = props.transfer
      ? await accountTransfersStore.updateTransfer(props.transfer.id, payload)
      : await accountTransfersStore.createTransfer(payload)

    if ('error' in result) {
      toast.error(
        props.transfer ? 'No se pudieron guardar los cambios' : 'No se pudo guardar la transferencia',
        { description: 'Revisá tu conexión e intentá de nuevo.' },
      )
      return
    }

    toast.success(props.transfer ? 'Cambios guardados' : 'Transferencia registrada')
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
        <SheetTitle>{{ isEditing ? 'Editar transferencia' : 'Nueva transferencia' }}</SheetTitle>
        <SheetDescription v-if="!isEditing">
          Mové plata entre dos de tus cuentas.
        </SheetDescription>
      </SheetHeader>

      <form id="transfer-form" class="flex flex-col gap-4 px-4" novalidate @submit.prevent="onSubmit">
        <div class="flex flex-col gap-1.5">
          <Label for="cuenta-origen">Cuenta de origen</Label>
          <Select v-model="form.fromAccountId" :disabled="isSaving" @update:model-value="onOriginChange">
            <SelectTrigger id="cuenta-origen" class="h-11 w-full" :aria-invalid="!!errors.fromAccountId">
              <SelectValue placeholder="Elegí la cuenta de origen" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="account in accountsStore.accounts" :key="account.id" :value="account.id">
                {{ account.name }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p v-if="errors.fromAccountId" class="text-xs text-destructive">
            {{ errors.fromAccountId }}
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="cuenta-destino">Cuenta de destino</Label>
          <Select v-model="form.toAccountId" :disabled="isSaving || !form.fromAccountId">
            <SelectTrigger id="cuenta-destino" class="h-11 w-full" :aria-invalid="!!errors.toAccountId">
              <SelectValue :placeholder="form.fromAccountId ? 'Elegí la cuenta de destino' : 'Elegí primero la cuenta de origen'" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="account in destinationOptions" :key="account.id" :value="account.id">
                {{ account.name }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p v-if="errors.toAccountId" class="text-xs text-destructive">
            {{ errors.toAccountId }}
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="monto-transferencia">Monto</Label>
          <div class="flex items-center gap-1.5">
            <span class="text-sm text-muted-foreground">$</span>
            <Input
              id="monto-transferencia"
              v-model="form.amount"
              inputmode="decimal"
              type="text"
              placeholder="0"
              class="text-lg font-semibold tabular-nums"
              :disabled="isSaving"
              :aria-invalid="!!errors.amount"
            />
          </div>
          <p class="text-xs text-muted-foreground">
            Movemos este monto de tu cuenta de origen a la de destino — este movimiento
            <strong class="font-medium text-foreground">no va a aparecer como gasto ni ingreso</strong>
            en tus listados, solo acá en Transferencias.
          </p>
          <p v-if="errors.amount" class="text-xs text-destructive">
            {{ errors.amount }}
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="comision-transferencia">
            Comisión <span class="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <div class="flex items-center gap-1.5">
            <span class="text-sm text-muted-foreground">$</span>
            <Input
              id="comision-transferencia"
              v-model="form.commission"
              inputmode="decimal"
              type="text"
              placeholder="0"
              :disabled="isSaving"
              :aria-invalid="!!errors.commission"
              @input="commissionTouched = true"
            />
          </div>
          <p class="text-xs text-muted-foreground">
            A diferencia del monto de arriba, la comisión <strong class="font-medium text-foreground">sí es un gasto real</strong> —
            se descuenta de la cuenta de origen y vas a verla en Transacciones, Estadísticas y la categoría "Comisiones bancarias".
          </p>
          <p v-if="errors.commission" class="text-xs text-destructive">
            {{ errors.commission }}
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="fecha-transferencia">Fecha</Label>
          <input
            id="fecha-transferencia"
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
          <Label for="descripcion-transferencia">
            Descripción <span class="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <Input
            id="descripcion-transferencia"
            v-model="form.description"
            placeholder="Ej. Paso plata al banco"
            maxlength="200"
            :disabled="isSaving"
          />
        </div>
      </form>

      <SheetFooter>
        <Button type="submit" form="transfer-form" class="w-full" :disabled="isSaving">
          <Loader2 v-if="isSaving" class="size-4 animate-spin" />
          {{ isSaving ? 'Guardando…' : (isEditing ? 'Guardar cambios' : 'Guardar transferencia') }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
