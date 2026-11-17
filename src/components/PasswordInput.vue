<script setup lang="ts">
import { ref } from 'vue'
import { Eye, EyeOff } from '@lucide/vue'
import { Input } from '@/components/ui/input'

defineOptions({ inheritAttrs: false })

const model = defineModel<string>({ default: '' })
const visible = ref(false)
</script>

<template>
  <div class="relative">
    <Input
      v-bind="$attrs"
      v-model="model"
      :type="visible ? 'text' : 'password'"
      class="pr-11"
    />
    <button
      type="button"
      class="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
      :aria-label="visible ? 'Ocultar contraseña' : 'Mostrar contraseña'"
      :aria-pressed="visible"
      :disabled="$attrs.disabled === true || $attrs.disabled === ''"
      @click="visible = !visible"
    >
      <EyeOff v-if="visible" class="size-5" />
      <Eye v-else class="size-5" />
    </button>
  </div>
</template>
