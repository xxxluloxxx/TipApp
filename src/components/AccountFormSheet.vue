<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Check, Loader2 } from '@lucide/vue'
import { COLOR_SWATCHES, readableTextColor } from '@/lib/colors'
import { ACCOUNT_ICON_OPTIONS, DEFAULT_ACCOUNT_ICON, type AccountIconKey } from '@/lib/accountIcons'
import { useAccountsStore, type Account } from '@/stores/accounts'
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

// Sección 6.3 de accounts-income-ux.md: alta/edición de cuenta, 100%
// optimista (mismo criterio que `CardFormSheet.vue` — no hay ningún índice
// único conocido sobre `accounts.name`).

const props = defineProps<{
  open: boolean
  /** Cuenta a editar. `null`/`undefined` = modo alta. */
  account?: Account | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const accountsStore = useAccountsStore()

const isEditing = computed(() => !!props.account)

const form = reactive({
  name: '',
  color: null as string | null,
  icon: DEFAULT_ACCOUNT_ICON as AccountIconKey,
  initialBalance: '',
  transferCommission: '',
})

const errors = reactive<{ name?: string, color?: string, initialBalance?: string, transferCommission?: string }>({})
const isSaving = ref(false)

const nameInputRef = ref<{ $el?: HTMLElement } | null>(null)

function resetForm() {
  errors.name = undefined
  errors.color = undefined
  errors.initialBalance = undefined
  errors.transferCommission = undefined

  if (props.account) {
    form.name = props.account.name
    // Sección 6.3: si el color guardado no coincide con ninguno de los
    // swatches (dato legado — p. ej. un hex de la paleta vieja de cuentas), no
    // se preselecciona ninguno — mismo criterio que `CategoryFormSheet`/
    // `CardFormSheet`.
    form.color = COLOR_SWATCHES.some(swatch => swatch.hex === props.account?.color)
      ? props.account.color
      : null
    form.icon = ACCOUNT_ICON_OPTIONS.some(item => item.key === props.account?.icon)
      ? (props.account.icon as AccountIconKey)
      : DEFAULT_ACCOUNT_ICON
    form.initialBalance = String(props.account.initial_balance)
    form.transferCommission = String(props.account.transfer_commission)
  } else {
    form.name = ''
    // Sección 6.3, punto 2: el color SÍ fuerza elección consciente en modo
    // alta (a diferencia del ícono) — una cuenta siempre necesita identidad
    // visual propia.
    form.color = null
    // Sección 5.2: el ícono sí tiene un default razonable preseleccionado.
    form.icon = DEFAULT_ACCOUNT_ICON
    form.initialBalance = ''
    form.transferCommission = ''
  }
}

watch(() => props.open, (isOpen) => {
  if (isOpen) resetForm()
})

function focusName() {
  nameInputRef.value?.$el?.focus()
}

function parseInitialBalance(raw: string): number | null | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return 0
  // El saldo inicial admite negativo (una cuenta puede arrancar en
  // descubierto, sección 6.3) — a diferencia del monto de un gasto/ingreso.
  const normalized = trimmed.replace(',', '.')
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return undefined
  const value = Number(normalized)
  return Number.isFinite(value) ? value : undefined
}

/** account-transfers-ux.md sección 5.1: comisión sugerida, `>= 0` (nunca
 * negativa, a diferencia del saldo inicial). Vacío se interpreta como 0. */
function parseCommission(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return 0
  const normalized = trimmed.replace(',', '.')
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return undefined
  const value = Number(normalized)
  return Number.isFinite(value) ? value : undefined
}

function validate(): boolean {
  errors.name = undefined
  errors.color = undefined
  errors.initialBalance = undefined
  errors.transferCommission = undefined
  let ok = true

  if (!form.name.trim()) {
    errors.name = 'Ingresá un nombre para la cuenta.'
    ok = false
  }

  if (!form.color) {
    errors.color = 'Elegí un color para la cuenta.'
    ok = false
  }

  const balance = parseInitialBalance(form.initialBalance)
  if (balance === undefined) {
    errors.initialBalance = 'Ingresá un monto válido, o dejalo vacío.'
    ok = false
  }

  const commission = parseCommission(form.transferCommission)
  if (commission === undefined) {
    errors.transferCommission = 'Ingresá un monto válido (0 o mayor), o dejalo vacío.'
    ok = false
  }

  return ok
}

function handleOpenChange(value: boolean) {
  emit('update:open', value)
}

function onSubmit() {
  if (!validate()) {
    if (errors.name) focusName()
    return
  }

  isSaving.value = true
  try {
    const payload = {
      name: form.name.trim(),
      color: form.color!,
      icon: form.icon,
      initialBalance: parseInitialBalance(form.initialBalance) ?? 0,
      transferCommission: parseCommission(form.transferCommission) ?? 0,
    }

    // El store ya se encarga del toast de éxito/error (optimista, sección
    // 6.3) — acá solo se decide qué mutación disparar.
    if (props.account) {
      accountsStore.updateAccount(props.account.id, payload)
    } else {
      accountsStore.addAccount(payload)
    }

    // Sección 6.3: 100% optimista, el Sheet se cierra de inmediato.
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
        <SheetTitle>{{ isEditing ? 'Editar cuenta' : 'Nueva cuenta' }}</SheetTitle>
        <SheetDescription v-if="!isEditing">
          Completá los datos de tu cuenta.
        </SheetDescription>
      </SheetHeader>

      <form id="account-form" class="flex flex-col gap-4 px-4" novalidate @submit.prevent="onSubmit">
        <div class="flex flex-col gap-1.5">
          <Label for="nombre-cuenta">Nombre</Label>
          <Input
            id="nombre-cuenta"
            ref="nameInputRef"
            v-model="form.name"
            placeholder="Ej. Efectivo"
            maxlength="40"
            :disabled="isSaving"
            :aria-invalid="!!errors.name"
          />
          <p v-if="errors.name" class="text-xs text-destructive">
            {{ errors.name }}
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label id="color-cuenta-label">Color</Label>
          <div id="color-cuenta" role="group" aria-labelledby="color-cuenta-label" class="flex flex-wrap gap-3">
            <button
              v-for="swatch in COLOR_SWATCHES"
              :key="swatch.hex"
              type="button"
              class="relative flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :class="{ 'ring-2 ring-offset-2 ring-ring': form.color === swatch.hex }"
              :style="{ background: swatch.hex }"
              :aria-pressed="form.color === swatch.hex"
              :aria-label="swatch.label"
              :disabled="isSaving"
              @click="form.color = swatch.hex"
            >
              <Check
                v-if="form.color === swatch.hex"
                class="size-5"
                :style="{ color: readableTextColor(swatch.hex) }"
              />
            </button>
          </div>
          <p v-if="errors.color" class="text-sm text-destructive">
            {{ errors.color }}
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label id="icono-cuenta-label">Ícono</Label>
          <div id="icono-cuenta" role="group" aria-labelledby="icono-cuenta-label" class="flex flex-wrap gap-3">
            <button
              v-for="item in ACCOUNT_ICON_OPTIONS"
              :key="item.key"
              type="button"
              class="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-muted outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :class="{ 'ring-2 ring-offset-2 ring-ring': form.icon === item.key }"
              :aria-pressed="form.icon === item.key"
              :aria-label="item.label"
              :disabled="isSaving"
              @click="form.icon = item.key"
            >
              <component
                :is="item.component"
                class="size-5"
                :style="{ color: form.color ?? undefined }"
              />
            </button>
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="saldo-inicial">
            Saldo inicial <span class="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <div class="flex items-center gap-1.5">
            <span class="text-sm text-muted-foreground">$</span>
            <Input
              id="saldo-inicial"
              v-model="form.initialBalance"
              inputmode="decimal"
              type="text"
              placeholder="0"
              :disabled="isSaving"
              :aria-invalid="!!errors.initialBalance"
            />
          </div>
          <p class="text-xs text-muted-foreground">
            Monto que esta cuenta ya tenía antes de empezar a usarla en TipApp. Dejalo en blanco si arranca en $0.
          </p>
          <p v-if="errors.initialBalance" class="text-xs text-destructive">
            {{ errors.initialBalance }}
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="comision-sugerida">
            Comisión de transferencia sugerida <span class="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <div class="flex items-center gap-1.5">
            <span class="text-sm text-muted-foreground">$</span>
            <Input
              id="comision-sugerida"
              v-model="form.transferCommission"
              inputmode="decimal"
              type="text"
              placeholder="0"
              :disabled="isSaving"
              :aria-invalid="!!errors.transferCommission"
            />
          </div>
          <p class="text-xs text-muted-foreground">
            Se usa como monto sugerido cada vez que transferís plata DESDE esta cuenta hacia otra —
            vas a poder cambiarlo en cada transferencia puntual.
          </p>
          <p v-if="errors.transferCommission" class="text-xs text-destructive">
            {{ errors.transferCommission }}
          </p>
        </div>
      </form>

      <SheetFooter>
        <Button type="submit" form="account-form" class="w-full" :disabled="isSaving">
          <Loader2 v-if="isSaving" class="size-4 animate-spin" />
          {{ isSaving ? 'Guardando…' : (isEditing ? 'Guardar cambios' : 'Guardar cuenta') }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
