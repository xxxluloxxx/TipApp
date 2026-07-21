<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Check, Loader2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { readableTextColor, withAlpha } from '@/lib/colors'
import { CATEGORY_ICON_OPTIONS } from '@/lib/categoryIcons'
import { useCategoriesStore, type Category } from '@/stores/categories'
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

// Sección 3.3 de categories-mvp-ux.md: los 10 hex ya sembrados en las
// categorías default, con su nombre en español para el `aria-label` de cada
// swatch (un lector de pantalla anunciando el hex crudo no comunica nada).
const COLOR_SWATCHES = [
  { hex: '#f97316', label: 'Naranja' },
  { hex: '#3b82f6', label: 'Azul' },
  { hex: '#8b5cf6', label: 'Violeta' },
  { hex: '#eab308', label: 'Amarillo' },
  { hex: '#ef4444', label: 'Rojo' },
  { hex: '#06b6d4', label: 'Celeste' },
  { hex: '#ec4899', label: 'Rosa' },
  { hex: '#14b8a6', label: 'Verde azulado' },
  { hex: '#22c55e', label: 'Verde' },
  { hex: '#6b7280', label: 'Gris' },
] as const

const props = defineProps<{
  open: boolean
  /** Categoría a editar. `null`/`undefined` = modo alta. */
  category?: Category | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const categoriesStore = useCategoriesStore()

const isEditing = computed(() => !!props.category)

const form = reactive({
  name: '',
  // Sección 3.2: `null` = "Sin ícono" (celda por default seleccionada en alta,
  // 100% opcional, sin validación de error posible).
  icon: null as string | null,
  color: null as string | null,
})

const errors = reactive<{ name?: string, color?: string }>({})
const isSaving = ref(false)

const nameInputRef = ref<{ $el?: HTMLElement } | null>(null)

function resetForm() {
  errors.name = undefined
  errors.color = undefined

  if (props.category) {
    form.name = props.category.name
    // Sección 3.2: si el ícono guardado coincide con uno del set curado se
    // preselecciona; si no (NULL, o un emoji fuera del set — dato legado), se
    // cae a "Sin ícono" (null) SIN bloquear el guardado (a diferencia de
    // Color, que sí exige reelegir porque es obligatorio).
    form.icon = CATEGORY_ICON_OPTIONS.some(item => item.emoji === props.category?.icon)
      ? props.category.icon
      : null
    // Sección 3.3: si el color guardado no coincide con ninguno de los 10
    // swatches (dato legado / edición manual en la base), no se
    // preselecciona ninguno — se exige elegir de nuevo, no se inventa un
    // 11º swatch dinámico.
    form.color = COLOR_SWATCHES.some(swatch => swatch.hex === props.category?.color)
      ? props.category.color
      : null
  } else {
    form.name = ''
    form.icon = null
    form.color = null
  }
}

// Precarga el form cada vez que el Sheet se abre (alta vacía, o edición con
// los valores de la categoría seleccionada), mismo patrón que ExpenseFormSheet.
watch(() => props.open, (isOpen) => {
  if (isOpen) resetForm()
})

function focusName() {
  nameInputRef.value?.$el?.focus()
}

/** Duplicado case-insensitive contra defaults + propias, excluyéndose a sí
 * misma en edición (sección 3.1). Es una regla de negocio de frontend por
 * encima del índice único de la base (que solo garantiza unicidad dentro de
 * cada grupo default/custom, no entre ambos). */
function isDuplicateName(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  return categoriesStore.categories.some(
    category => category.id !== props.category?.id && category.name.trim().toLowerCase() === normalized,
  )
}

function validateName(): boolean {
  const trimmed = form.name.trim()

  if (!trimmed) {
    errors.name = 'Ingresá un nombre para la categoría.'
    return false
  }

  if (isDuplicateName(trimmed)) {
    errors.name = 'Ya existe una categoría con ese nombre.'
    return false
  }

  errors.name = undefined
  return true
}

function validateColor(): boolean {
  if (!form.color) {
    errors.color = 'Elegí un color para la categoría.'
    return false
  }
  errors.color = undefined
  return true
}

function handleOpenChange(value: boolean) {
  emit('update:open', value)
}

// Sección 3.4: el Sheet no se puede cerrar (tap fuera / Escape / swipe)
// mientras se guarda, ya que acá sí hay un roundtrip real en vuelo (a
// diferencia de gastos, el guardado de categoría no es optimista).
function preventCloseWhileSaving(event: Event) {
  if (isSaving.value) event.preventDefault()
}

async function onSubmit() {
  const nameOk = validateName()
  const colorOk = validateColor()
  if (!nameOk) {
    focusName()
    return
  }
  if (!colorOk) return

  isSaving.value = true
  try {
    const payload = { name: form.name.trim(), icon: form.icon, color: form.color! }

    const result = isEditing.value
      ? await categoriesStore.updateCategory(props.category!.id, payload)
      : await categoriesStore.addCategory(payload)

    if (result.category) {
      if (isEditing.value) {
        toast.success('Categoría actualizada')
      } else {
        toast.success('Categoría creada', {
          description: `"${result.category.name}" ya está disponible para tus gastos.`,
        })
      }
      emit('update:open', false)
      return
    }

    if (result.errorCode === '23505') {
      // Backstop de carrera (sección 3.1/3.4): dos guardados simultáneos que
      // ambos pasaron la validación de cliente porque, al validar, el
      // conflicto todavía no existía.
      errors.name = 'Ya existe una categoría con ese nombre.'
      focusName()
      return
    }

    toast.error('No se pudo guardar la categoría', {
      description: 'Revisá tu conexión e intentá de nuevo.',
    })
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
        <SheetTitle>{{ isEditing ? 'Editar categoría' : 'Nueva categoría' }}</SheetTitle>
        <SheetDescription v-if="!isEditing">
          Elegí un nombre, un ícono y un color para tu categoría.
        </SheetDescription>
      </SheetHeader>

      <form id="category-form" class="flex flex-col gap-4 px-4" novalidate @submit.prevent="onSubmit">
        <div class="flex flex-col gap-1.5">
          <Label for="nombre-categoria">Nombre</Label>
          <Input
            id="nombre-categoria"
            ref="nameInputRef"
            v-model="form.name"
            placeholder="Ej. Mascotas"
            maxlength="40"
            :disabled="isSaving"
            :aria-invalid="!!errors.name"
            @blur="validateName"
          />
          <p v-if="errors.name" class="text-xs text-destructive">
            {{ errors.name }}
          </p>
        </div>

        <!-- Preview en vivo (sección 3.2): refleja exactamente el swatch que va
             a tener la categoría en el listado real (mismo `withAlpha` + borde),
             a medida que se elige ícono/color. -->
        <div class="flex items-center gap-3 py-1">
          <div
            class="flex size-11 shrink-0 items-center justify-center rounded-full"
            :style="form.color
              ? { background: withAlpha(form.color, 0.12), border: `1px solid ${form.color}` }
              : { border: '1px dashed var(--border)' }"
          >
            <span v-if="form.icon" class="text-lg leading-none">{{ form.icon }}</span>
          </div>
          <span class="truncate text-sm text-muted-foreground">
            {{ form.name.trim() || 'Tu categoría' }}
          </span>
        </div>

        <!-- Campo Ícono (sección 3.2): grid de 19 emojis curados + celda "Sin
             ícono", selección marcada solo con anillo + aria-pressed (sin Check
             superpuesto, que taparía el emoji). Opcional, nunca bloquea. -->
        <div class="flex flex-col gap-1.5">
          <Label id="icono-categoria-label">
            Ícono <span class="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <div id="icono-categoria" role="group" aria-labelledby="icono-categoria-label" class="flex flex-wrap gap-3">
            <button
              v-for="item in CATEGORY_ICON_OPTIONS"
              :key="item.emoji"
              type="button"
              class="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :class="{ 'ring-2 ring-offset-2 ring-ring': form.icon === item.emoji }"
              :aria-pressed="form.icon === item.emoji"
              :aria-label="item.label"
              :disabled="isSaving"
              @click="form.icon = item.emoji"
            >
              <span class="text-xl leading-none">{{ item.emoji }}</span>
            </button>

            <!-- Celda "Sin ícono": borde punteado + punto neutro, mismo
                 tratamiento que una categoría sin ícono en el listado. -->
            <button
              type="button"
              class="flex size-11 shrink-0 items-center justify-center rounded-full border border-dashed border-border outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :class="{ 'ring-2 ring-offset-2 ring-ring': form.icon === null }"
              :aria-pressed="form.icon === null"
              aria-label="Sin ícono"
              :disabled="isSaving"
              @click="form.icon = null"
            >
              <span class="size-2.5 rounded-full bg-muted-foreground/40" />
            </button>
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label id="color-categoria-label">Color</Label>
          <div id="color-categoria" role="group" aria-labelledby="color-categoria-label" class="flex flex-wrap gap-3">
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
      </form>

      <SheetFooter>
        <Button type="submit" form="category-form" class="w-full" :disabled="isSaving">
          <Loader2 v-if="isSaving" class="size-4 animate-spin" />
          {{ isSaving ? 'Guardando…' : (isEditing ? 'Guardar cambios' : 'Guardar categoría') }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
