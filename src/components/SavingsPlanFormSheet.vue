<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Loader2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { todayDateInputValue } from '@/lib/date'
import { useAccountsStore } from '@/stores/accounts'
import { useSavingsPlansStore } from '@/stores/savingsPlans'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'

// Alta de un ahorro programado: se mueve un monto fijo de una cuenta a otra
// durante N meses. Guardado NO optimista (RPC crea el plan y todas sus cuotas).

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const accountsStore = useAccountsStore()
const savingsStore = useSavingsPlansStore()

const form = reactive({
  name: '',
  fromAccountId: null as string | null,
  toAccountId: null as string | null,
  amount: '',
  day: '',
  months: '12',
  startMonth: todayDateInputValue().slice(0, 7),
})
const errors = reactive<Record<string, string | undefined>>({})
const isSaving = ref(false)

const destinationOptions = computed(() =>
  accountsStore.accounts.filter(account => account.id !== form.fromAccountId),
)

watch(() => props.open, (isOpen) => {
  if (!isOpen) return
  Object.assign(form, {
    name: '',
    fromAccountId: null,
    toAccountId: null,
    amount: '',
    day: String(new Date().getDate()),
    months: '12',
    startMonth: todayDateInputValue().slice(0, 7),
  })
  for (const key of Object.keys(errors)) errors[key] = undefined
})

function parsePositive(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.')
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null
  const value = Number(normalized)
  return Number.isFinite(value) && value > 0 ? value : null
}

function validate(): boolean {
  for (const key of Object.keys(errors)) errors[key] = undefined
  if (!form.name.trim()) errors.name = 'Ponle un nombre al ahorro.'
  if (!form.fromAccountId) errors.from = 'Elige la cuenta de origen.'
  if (!form.toAccountId) errors.to = 'Elige la cuenta de destino.'
  if (parsePositive(form.amount) === null) errors.amount = 'Ingresa un monto mayor a 0.'
  const day = Number(form.day)
  if (!Number.isInteger(day) || day < 1 || day > 31) errors.day = 'Un día entre 1 y 31.'
  const months = Number(form.months)
  if (!Number.isInteger(months) || months < 1 || months > 600) errors.months = 'Entre 1 y 600 meses.'
  if (!form.startMonth) errors.startMonth = 'Elige el mes de inicio.'
  return !Object.values(errors).some(Boolean)
}

async function onSubmit() {
  if (!validate()) return
  isSaving.value = true
  try {
    const result = await savingsStore.createPlan({
      name: form.name.trim(),
      fromAccountId: form.fromAccountId!,
      toAccountId: form.toAccountId!,
      amount: parsePositive(form.amount)!,
      dayOfMonth: Number(form.day),
      termMonths: Number(form.months),
      startDate: `${form.startMonth}-01`,
    })
    if ('error' in result) {
      toast.error('No se pudo guardar el ahorro', { description: 'Revisa tu conexión e intenta de nuevo.' })
      return
    }
    toast.success('Ahorro programado creado')
    emit('update:open', false)
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <Sheet :open="props.open" @update:open="(v: boolean) => { if (!isSaving) emit('update:open', v) }">
    <SheetContent side="bottom" :show-close-button="!isSaving">
      <SheetHeader>
        <SheetTitle>Nuevo ahorro programado</SheetTitle>
        <SheetDescription>
          Cada mes se mueve un monto fijo de una cuenta a otra. Tú confirmas cada cuota.
        </SheetDescription>
      </SheetHeader>

      <form id="savings-form" class="flex max-h-[65vh] flex-col gap-4 overflow-y-auto px-4" novalidate @submit.prevent="onSubmit">
        <div class="flex flex-col gap-1.5">
          <Label for="ahorro-nombre">Nombre</Label>
          <Input id="ahorro-nombre" v-model="form.name" maxlength="80" placeholder="Ej. Ahorro programado banco" :disabled="isSaving" />
          <p v-if="errors.name" class="text-xs text-destructive">{{ errors.name }}</p>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="ahorro-origen">Cuenta de la que te quitan</Label>
          <Select v-model="form.fromAccountId" :disabled="isSaving">
            <SelectTrigger id="ahorro-origen" class="h-11 w-full">
              <SelectValue placeholder="Elige la cuenta de origen" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="account in accountsStore.accounts" :key="account.id" :value="account.id">{{ account.name }}</SelectItem>
            </SelectContent>
          </Select>
          <p v-if="errors.from" class="text-xs text-destructive">{{ errors.from }}</p>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="ahorro-destino">Cuenta de ahorro (destino)</Label>
          <Select v-model="form.toAccountId" :disabled="isSaving || !form.fromAccountId">
            <SelectTrigger id="ahorro-destino" class="h-11 w-full">
              <SelectValue :placeholder="form.fromAccountId ? 'Elige la cuenta de destino' : 'Elige primero el origen'" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="account in destinationOptions" :key="account.id" :value="account.id">{{ account.name }}</SelectItem>
            </SelectContent>
          </Select>
          <p v-if="errors.to" class="text-xs text-destructive">{{ errors.to }}</p>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="ahorro-monto">Monto por mes</Label>
          <div class="flex items-center gap-1.5">
            <span class="text-sm text-muted-foreground">$</span>
            <Input id="ahorro-monto" v-model="form.amount" inputmode="decimal" placeholder="0" class="text-lg font-semibold tabular-nums" :disabled="isSaving" />
          </div>
          <p v-if="errors.amount" class="text-xs text-destructive">{{ errors.amount }}</p>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="flex flex-col gap-1.5">
            <Label for="ahorro-dia">Día del mes</Label>
            <Input id="ahorro-dia" v-model="form.day" inputmode="numeric" placeholder="5" :disabled="isSaving" />
            <p v-if="errors.day" class="text-xs text-destructive">{{ errors.day }}</p>
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="ahorro-meses">Meses</Label>
            <Input id="ahorro-meses" v-model="form.months" inputmode="numeric" placeholder="12" :disabled="isSaving" />
            <p v-if="errors.months" class="text-xs text-destructive">{{ errors.months }}</p>
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="ahorro-inicio">Primer mes</Label>
          <input
            id="ahorro-inicio"
            v-model="form.startMonth"
            type="month"
            :disabled="isSaving"
            class="dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border bg-transparent px-2.5 py-1 text-base shadow-xs outline-none transition-[color,box-shadow] focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
          >
          <p v-if="errors.startMonth" class="text-xs text-destructive">{{ errors.startMonth }}</p>
        </div>
      </form>

      <SheetFooter>
        <Button type="submit" form="savings-form" class="w-full" :disabled="isSaving">
          <Loader2 v-if="isSaving" class="size-4 animate-spin" />
          {{ isSaving ? 'Guardando…' : 'Crear ahorro' }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
