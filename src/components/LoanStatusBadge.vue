<script setup lang="ts">
import { AlertCircle, CircleCheck, Clock } from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import type { LoanBadgeStatus } from '@/stores/loans'

// Sección 9.1 de loans-ux.md: badge de estado de un préstamo completo (3
// estados). Codificación redundante ícono + texto, nunca solo color (criterio
// CVD del proyecto). `current` usa `muted-foreground` (estar al día es lo
// esperado, no un logro — el logro real, `completed`, tiene su color reservado).

const props = defineProps<{ status: LoanBadgeStatus }>()

const STATUS_CONFIG = {
  current: { icon: Clock, class: 'text-muted-foreground', label: 'Al día' },
  overdue: { icon: AlertCircle, class: 'text-destructive', label: 'Atrasado' },
  completed: { icon: CircleCheck, class: 'text-success', label: 'Completado' },
} as const

const config = () => STATUS_CONFIG[props.status]
</script>

<template>
  <Badge variant="outline" class="gap-1 text-[10px]" :class="config().class">
    <component :is="config().icon" class="size-3" />
    {{ config().label }}
  </Badge>
</template>
