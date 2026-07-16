<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Check, Loader2, User } from '@lucide/vue'
import { COLOR_SWATCHES, readableTextColor } from '@/lib/colors'
import { useCardPeopleStore, type CardPerson } from '@/stores/cardPeople'
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

// Sección 6.3 de credit-cards-ux.md: alta/edición de persona, 100%
// optimista. Sin nombre duplicado (no hay ambigüedad conocida, a diferencia
// de categorías) y color opcional (grid de 10 swatches + "Sin color").

const props = defineProps<{
  open: boolean
  /** Persona a editar. `null`/`undefined` = modo alta. */
  person?: CardPerson | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const cardPeopleStore = useCardPeopleStore()

const isEditing = computed(() => !!props.person)

const form = reactive({
  name: '',
  color: null as string | null,
  /** El grid necesita distinguir "todavía no elegí" de "elegí Sin color"
   * explícitamente (sección 6.3) — `hasChosenColor` cubre ese tercer estado
   * sin inventar un valor mágico dentro de `color`. */
  hasChosenColor: false,
})

const errors = reactive<{ name?: string, color?: string }>({})
const isSaving = ref(false)

const nameInputRef = ref<{ $el?: HTMLElement } | null>(null)

function resetForm() {
  errors.name = undefined
  errors.color = undefined

  if (props.person) {
    form.name = props.person.name
    const matchesSwatch = COLOR_SWATCHES.some(swatch => swatch.hex === props.person?.color)
    form.color = matchesSwatch ? props.person.color : null
    form.hasChosenColor = matchesSwatch || props.person.color === null
  } else {
    form.name = ''
    form.color = null
    form.hasChosenColor = false
  }
}

watch(() => props.open, (isOpen) => {
  if (isOpen) resetForm()
})

function focusName() {
  nameInputRef.value?.$el?.focus()
}

function selectColor(hex: string | null) {
  form.color = hex
  form.hasChosenColor = true
}

function validate(): boolean {
  errors.name = undefined
  errors.color = undefined
  let ok = true

  if (!form.name.trim()) {
    errors.name = 'Ingresá un nombre para la persona.'
    ok = false
  }

  if (!form.hasChosenColor) {
    errors.color = 'Elegí un color, o "Sin color".'
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
    const payload = { name: form.name.trim(), color: form.color }

    // El store ya se encarga del toast de éxito/error (optimista, sección
    // 6.3) — acá solo se decide qué mutación disparar.
    if (props.person) {
      cardPeopleStore.updatePerson(props.person.id, payload)
    } else {
      cardPeopleStore.addPerson(payload)
    }

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
        <SheetTitle>{{ isEditing ? 'Editar persona' : 'Nueva persona' }}</SheetTitle>
        <SheetDescription v-if="!isEditing">
          Elegí un nombre y, si querés, un color para identificarla.
        </SheetDescription>
      </SheetHeader>

      <form id="card-person-form" class="flex flex-col gap-4 px-4" novalidate @submit.prevent="onSubmit">
        <div class="flex flex-col gap-1.5">
          <Label for="nombre-persona">Nombre</Label>
          <Input
            id="nombre-persona"
            ref="nameInputRef"
            v-model="form.name"
            placeholder="Ej. Paul"
            maxlength="40"
            :disabled="isSaving"
            :aria-invalid="!!errors.name"
          />
          <p v-if="errors.name" class="text-xs text-destructive">
            {{ errors.name }}
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label id="color-persona-label">Color <span class="font-normal text-muted-foreground">(opcional)</span></Label>
          <div id="color-persona" role="group" aria-labelledby="color-persona-label" class="flex flex-wrap gap-3">
            <button
              v-for="swatch in COLOR_SWATCHES"
              :key="swatch.hex"
              type="button"
              class="relative flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :class="{ 'ring-2 ring-offset-2 ring-ring': form.hasChosenColor && form.color === swatch.hex }"
              :style="{ background: swatch.hex }"
              :aria-pressed="form.hasChosenColor && form.color === swatch.hex"
              :aria-label="swatch.label"
              :disabled="isSaving"
              @click="selectColor(swatch.hex)"
            >
              <Check
                v-if="form.hasChosenColor && form.color === swatch.hex"
                class="size-5"
                :style="{ color: readableTextColor(swatch.hex) }"
              />
            </button>

            <button
              type="button"
              class="relative flex size-11 shrink-0 items-center justify-center rounded-full border border-dashed border-border outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :class="{ 'ring-2 ring-offset-2 ring-ring': form.hasChosenColor && form.color === null }"
              aria-label="Sin color"
              :aria-pressed="form.hasChosenColor && form.color === null"
              :disabled="isSaving"
              @click="selectColor(null)"
            >
              <User class="size-5 text-muted-foreground" />
            </button>
          </div>
          <p v-if="errors.color" class="text-sm text-destructive">
            {{ errors.color }}
          </p>
        </div>
      </form>

      <SheetFooter>
        <Button type="submit" form="card-person-form" class="w-full" :disabled="isSaving">
          <Loader2 v-if="isSaving" class="size-4 animate-spin" />
          {{ isSaving ? 'Guardando…' : (isEditing ? 'Guardar cambios' : 'Guardar persona') }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
