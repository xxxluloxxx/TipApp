<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Loader2, UserRoundPlus } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { isFutureDate, todayDateInputValue } from '@/lib/date'
import { useAccountsStore } from '@/stores/accounts'
import { useCardPeopleStore } from '@/stores/cardPeople'
import { useDebtsStore, type Debt, type DebtDirection } from '@/stores/debts'
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

// Secciones 5/6.5 de debts-ux.md: mismo Sheet para dos modos muy distintos.
// Alta (props.debt = null): Dirección/Contraparte/Descripción/Monto
// inicial/Fecha/Cuenta, guardado NO optimista vía RPC atómico (sección 5.2 —
// única excepción real de esta feature, ver justificación en el store).
// Edición de cabecera (props.debt set): solo Contraparte/Descripción,
// Dirección bloqueada (sección 6.5), 100% optimista.

const props = withDefaults(defineProps<{
  open: boolean
  /** Deuda a editar (solo cabecera). `null`/`undefined` = modo alta. */
  debt?: Debt | null
}>(), {
  debt: null,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const router = useRouter()
const debtsStore = useDebtsStore()
const cardPeopleStore = useCardPeopleStore()
const accountsStore = useAccountsStore()

const isEditing = computed(() => !!props.debt)
const todayValue = computed(() => todayDateInputValue())

const form = reactive({
  direction: '' as DebtDirection | '',
  personId: '',
  description: '',
  amount: '',
  date: todayDateInputValue(),
  accountId: null as string | null,
})

const errors = reactive<{ direction?: string, personId?: string, amount?: string, date?: string }>({})
const isSaving = ref(false)

const personTriggerRef = ref<{ $el?: HTMLElement } | null>(null)
const amountInputRef = ref<{ $el?: HTMLElement } | null>(null)
const dateInputRef = ref<HTMLInputElement | null>(null)

function resetForm() {
  errors.direction = undefined
  errors.personId = undefined
  errors.amount = undefined
  errors.date = undefined

  if (props.debt) {
    // Edición de cabecera (sección 6.5): Monto/Fecha/Cuenta no aplican acá,
    // esos campos solo existen en el momento de creación atómica.
    form.direction = props.debt.direction as DebtDirection
    form.personId = props.debt.person_id
    form.description = props.debt.description ?? ''
    form.amount = ''
    form.date = todayDateInputValue()
    form.accountId = null
  } else {
    // Sección 5.1: Dirección sin default preseleccionado, fuerza elección
    // consciente.
    form.direction = ''
    form.personId = ''
    form.description = ''
    form.amount = ''
    form.date = todayDateInputValue()
    form.accountId = null
  }
}

watch(() => props.open, (isOpen) => {
  if (isOpen) resetForm()
})

function setDirection(value: DebtDirection) {
  // Sección 6.5: Dirección queda bloqueada en edición — cambiarla invertiría
  // retroactivamente el significado de cada signo de `debt_movements.amount`
  // ya cargado.
  if (isEditing.value || isSaving.value) return
  form.direction = value
}

function parseAmount(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const normalized = trimmed.replace(',', '.')
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

function focusPerson() {
  personTriggerRef.value?.$el?.focus()
}
function focusAmount() {
  amountInputRef.value?.$el?.focus()
}
function focusDate() {
  dateInputRef.value?.focus()
}

function validate(): boolean {
  errors.direction = undefined
  errors.personId = undefined
  errors.amount = undefined
  errors.date = undefined

  if (!form.direction) {
    errors.direction = 'Elegí el tipo de préstamo.'
    return false
  }

  if (!form.personId) {
    errors.personId = 'Seleccioná una persona.'
    focusPerson()
    return false
  }

  if (!isEditing.value) {
    const amount = parseAmount(form.amount)
    if (amount === null || amount <= 0) {
      errors.amount = 'Ingresá un monto mayor a 0.'
      focusAmount()
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
  }

  return true
}

function handleOpenChange(value: boolean) {
  emit('update:open', value)
}

// Sección 5.2: el Sheet no se puede cerrar (tap fuera / Escape / swipe)
// mientras se crea una deuda nueva — hay un roundtrip real en vuelo, a
// diferencia del resto del proyecto. En edición esto no importa en la
// práctica (100% optimista, el Sheet se cierra antes de que `isSaving`
// llegue a valer `true` por más de un instante).
function preventCloseWhileSaving(event: Event) {
  if (isSaving.value) event.preventDefault()
}

// Sección 4.2: atajo "Agregar persona nueva", navega a la gestión de
// tarjetas/personas — se acepta perder lo ya tecleado acá (ver justificación
// completa del trade-off en el doc).
function goManagePeople() {
  router.push({ name: 'manage-cards', query: { new: 'person' } })
}

async function onSubmit() {
  if (!validate()) return

  isSaving.value = true
  try {
    if (isEditing.value) {
      // Sección 6.5: 100% optimista, el store ya resuelve el toast.
      debtsStore.updateDebt(props.debt!.id, {
        personId: form.personId,
        description: form.description.trim() ? form.description.trim() : null,
      })
      emit('update:open', false)
      return
    }

    const amount = parseAmount(form.amount)!
    const result = await debtsStore.createDebt({
      personId: form.personId,
      direction: form.direction as DebtDirection,
      amount,
      accountId: form.accountId,
      movementDate: form.date,
      description: form.description.trim() ? form.description.trim() : null,
    })

    if ('error' in result) {
      toast.error('No se pudo guardar la deuda', {
        description: 'Revisá tu conexión e intentá de nuevo.',
      })
      return
    }

    toast.success('Deuda creada', {
      description: `Se registró el préstamo con ${cardPeopleStore.personById(form.personId)?.name ?? 'la persona seleccionada'}.`,
    })
    emit('update:open', false)
    router.push({ name: 'debt-detail', params: { id: result.debtId } })
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
        <SheetTitle>{{ isEditing ? 'Editar deuda' : 'Nueva deuda' }}</SheetTitle>
        <SheetDescription v-if="!isEditing">
          Registrá a quién le prestaste plata o quién te prestó a vos.
        </SheetDescription>
      </SheetHeader>

      <form id="debt-form" class="flex flex-col gap-4 px-4" novalidate @submit.prevent="onSubmit">
        <div class="flex flex-col gap-1.5">
          <Label id="direccion-label">¿Qué tipo de préstamo es?</Label>
          <div role="radiogroup" aria-labelledby="direccion-label" class="flex gap-1 rounded-md bg-muted p-1">
            <button
              type="button"
              role="radio"
              :aria-checked="form.direction === 'lent'"
              class="flex-1 rounded-sm px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              :class="form.direction === 'lent' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
              :disabled="isEditing || isSaving"
              @click="setDirection('lent')"
            >
              Yo le presto
            </button>
            <button
              type="button"
              role="radio"
              :aria-checked="form.direction === 'borrowed'"
              class="flex-1 rounded-sm px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              :class="form.direction === 'borrowed' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
              :disabled="isEditing || isSaving"
              @click="setDirection('borrowed')"
            >
              Me presta
            </button>
          </div>
          <p v-if="errors.direction" class="text-xs text-destructive">
            {{ errors.direction }}
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="contraparte-deuda">Contraparte</Label>
          <Select v-model="form.personId" :disabled="isSaving">
            <SelectTrigger id="contraparte-deuda" ref="personTriggerRef" class="h-11 w-full" :aria-invalid="!!errors.personId">
              <SelectValue placeholder="Seleccioná una persona" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="person in cardPeopleStore.people" :key="person.id" :value="person.id">
                {{ person.name }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p v-if="errors.personId" class="text-xs text-destructive">
            {{ errors.personId }}
          </p>
          <Button variant="link" size="sm" class="h-auto w-fit p-0 text-xs" type="button" @click="goManagePeople">
            <UserRoundPlus class="size-3.5" /> Agregar persona nueva
          </Button>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="descripcion-deuda">
            Descripción <span class="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <Input
            id="descripcion-deuda"
            v-model="form.description"
            placeholder="Ej. Préstamo personal"
            maxlength="200"
            :disabled="isSaving"
          />
        </div>

        <template v-if="!isEditing">
          <div class="flex flex-col gap-1.5">
            <Label for="monto-deuda">Monto inicial</Label>
            <div class="flex items-center gap-1.5">
              <span class="text-sm text-muted-foreground">$</span>
              <Input
                id="monto-deuda"
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
            <Label for="fecha-deuda">Fecha</Label>
            <input
              id="fecha-deuda"
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
            <Label for="cuenta-deuda">Cuenta (opcional)</Label>
            <Select v-model="form.accountId" :disabled="isSaving">
              <SelectTrigger id="cuenta-deuda" class="h-11 w-full">
                <SelectValue placeholder="Sin cuenta" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem :value="null">
                  Sin cuenta
                </SelectItem>
                <SelectItem v-for="account in accountsStore.accounts" :key="account.id" :value="account.id">
                  {{ account.name }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p class="text-xs text-muted-foreground">
              Si vinculás una cuenta, ajustamos su saldo automáticamente por la plata real que sale o entra —
              pero este movimiento <strong class="font-medium text-foreground">no va a aparecer como gasto ni
                ingreso</strong> en tus listados, solo acá en Deudas.
            </p>
          </div>
        </template>
      </form>

      <SheetFooter>
        <Button type="submit" form="debt-form" class="w-full" :disabled="isSaving">
          <Loader2 v-if="isSaving" class="size-4 animate-spin" />
          {{ isSaving ? 'Guardando…' : (isEditing ? 'Guardar cambios' : 'Guardar deuda') }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
