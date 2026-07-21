<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { UserRoundPlus } from '@lucide/vue'
import { formatAmount } from '@/lib/currency'
import { useDebtPeopleStore } from '@/stores/debtPeople'
import { useLoansStore } from '@/stores/loans'
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

// Sección 8.2 de loans-ux.md: agregar una persona (ya existente en
// `debt_people`) a un préstamo puntual con un monto. El `Select` excluye a
// quienes ya son deudores de este préstamo (evita el unique server-side sin
// mostrar un error de submit). Guardado optimista.

const props = defineProps<{
  open: boolean
  loanId: string
  /** Ids de `debt_people` ya asignados a este préstamo (para excluir). */
  existingPersonIds: string[]
  loanTotalAmount: number
  /** Suma de `amount_owed` de los deudores ya asignados (para el aviso). */
  assignedTotal: number
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const router = useRouter()
const debtPeopleStore = useDebtPeopleStore()
const loansStore = useLoansStore()

const form = reactive({
  personId: '',
  amount: '',
})
const errors = reactive<{ personId?: string, amount?: string }>({})

const availablePeople = computed(() =>
  debtPeopleStore.people.filter(person => !props.existingPersonIds.includes(person.id)),
)

function resetForm() {
  errors.personId = undefined
  errors.amount = undefined
  form.personId = ''
  form.amount = ''
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

// Sección 8.2/5.4: aviso inline NO bloqueante si la asignación superaría el
// total del préstamo (repartir de más está permitido, solo se informa).
const parsedAmount = ref<number | null>(null)
watch(() => form.amount, (value) => {
  parsedAmount.value = parseAmount(value)
})
const exceedsTotal = computed(() => {
  if (parsedAmount.value === null || props.loanTotalAmount <= 0) return false
  return props.assignedTotal + parsedAmount.value > props.loanTotalAmount
})

function validate(): boolean {
  errors.personId = undefined
  errors.amount = undefined

  if (!form.personId) {
    errors.personId = 'Seleccioná una persona.'
    return false
  }
  const amount = parseAmount(form.amount)
  if (amount === null || amount <= 0) {
    errors.amount = 'Ingresá un monto mayor a 0.'
    return false
  }
  return true
}

function handleOpenChange(value: boolean) {
  emit('update:open', value)
}

// Sección 8.2: atajo hacia la gestión de personas de deuda (mismo destino y
// trade-off que `DebtFormSheet` — se pierde lo tecleado acá).
function goManagePeople() {
  router.push({ name: 'debt-people', query: { new: '1' } })
}

function onSubmit() {
  if (!validate()) return

  loansStore.addDebtor({
    loanId: props.loanId,
    debtPersonId: form.personId,
    amountOwed: parseAmount(form.amount)!,
  })
  emit('update:open', false)
}
</script>

<template>
  <Sheet :open="props.open" @update:open="handleOpenChange">
    <SheetContent side="bottom">
      <SheetHeader>
        <SheetTitle>Agregar persona</SheetTitle>
        <SheetDescription>Elegí quién te debe una parte de este préstamo.</SheetDescription>
      </SheetHeader>

      <form id="loan-debtor-form" class="flex flex-col gap-4 px-4" novalidate @submit.prevent="onSubmit">
        <div class="flex flex-col gap-1.5">
          <Label for="persona-deudor">Persona</Label>
          <Select v-model="form.personId">
            <SelectTrigger id="persona-deudor" class="h-11 w-full" :aria-invalid="!!errors.personId">
              <SelectValue placeholder="Seleccioná una persona" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="person in availablePeople" :key="person.id" :value="person.id">
                {{ person.name }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p v-if="availablePeople.length === 0" class="text-xs text-muted-foreground">
            Ya agregaste a todas tus personas a este préstamo, o todavía no creaste ninguna.
          </p>
          <p v-if="errors.personId" class="text-xs text-destructive">
            {{ errors.personId }}
          </p>
          <Button variant="link" size="sm" class="h-auto w-fit p-0 text-xs" type="button" @click="goManagePeople">
            <UserRoundPlus class="size-3.5" /> Agregar persona nueva
          </Button>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="monto-deudor">Monto que le corresponde</Label>
          <div class="flex items-center gap-1.5">
            <span class="text-sm text-muted-foreground">$</span>
            <Input
              id="monto-deudor"
              v-model="form.amount"
              inputmode="decimal"
              type="text"
              placeholder="0"
              class="text-lg font-semibold tabular-nums"
              :aria-invalid="!!errors.amount"
            />
          </div>
          <p v-if="exceedsTotal" class="text-xs text-warning">
            Esto supera el monto total del préstamo (${{ formatAmount(loanTotalAmount) }}).
          </p>
          <p v-if="errors.amount" class="text-xs text-destructive">
            {{ errors.amount }}
          </p>
        </div>
      </form>

      <SheetFooter>
        <Button type="submit" form="loan-debtor-form" class="w-full">
          Agregar persona
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
