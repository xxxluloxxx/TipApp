<script setup lang="ts">
import { ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'

// Nombre de un borrador de la calculadora (crear / renombrar).
const props = defineProps<{ open: boolean, title: string, initialName: string, submitLabel: string }>()
const emit = defineEmits<{ 'update:open': [value: boolean], submit: [name: string] }>()

const name = ref('')
const error = ref('')
const isSaving = ref(false)

watch(() => props.open, (isOpen) => {
  if (!isOpen) return
  name.value = props.initialName
  error.value = ''
  isSaving.value = false
})

function onSubmit() {
  const trimmed = name.value.trim()
  if (!trimmed) {
    error.value = 'Ponle un nombre al cálculo.'
    return
  }
  isSaving.value = true
  emit('submit', trimmed)
}
</script>

<template>
  <Sheet :open="props.open" @update:open="emit('update:open', $event)">
    <SheetContent side="bottom">
      <SheetHeader>
        <SheetTitle>{{ title }}</SheetTitle>
      </SheetHeader>
      <form id="calc-name-form" class="flex flex-col gap-1.5 px-4" novalidate @submit.prevent="onSubmit">
        <Label for="calc-name">Nombre</Label>
        <Input id="calc-name" v-model="name" maxlength="80" placeholder="Ej. Presupuesto diciembre" :aria-invalid="!!error" />
        <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
      </form>
      <SheetFooter>
        <Button type="submit" form="calc-name-form" class="w-full" :disabled="isSaving">
          {{ isSaving ? 'Guardando…' : submitLabel }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
