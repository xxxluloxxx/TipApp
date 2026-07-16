<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { AlertVariants } from '.'
import { cn } from '@/lib/utils'
import { alertVariants } from '.'

const props = defineProps<{
  variant?: AlertVariants['variant']
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div
    data-slot="alert"
    role="alert"
    :class="cn(alertVariants({ variant: props.variant }), props.class)"
  >
    <slot />
  </div>
</template>
