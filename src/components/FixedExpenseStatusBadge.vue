<script setup lang="ts">
import { AlertCircle, CircleCheck, Clock, PauseCircle } from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import type { FixedExpenseDisplayStatus } from '@/stores/fixedExpenses'

// Sección 6 de fixed-expenses-ux.md: badge de 4 estados (paid/overdue/pending/
// paused). Codificación redundante (ícono + texto, nunca solo color) por el
// criterio CVD ya aplicado en el resto del proyecto. `variant="outline"` para
// los 4: el color vive en el ícono+texto, no en el relleno del badge.

const props = defineProps<{ status: FixedExpenseDisplayStatus }>()

const STATUS_CONFIG = {
  paid: { icon: CircleCheck, class: 'text-success', label: 'Pagado' },
  overdue: { icon: AlertCircle, class: 'text-destructive', label: 'Vencido' },
  pending: { icon: Clock, class: 'text-muted-foreground', label: 'Pendiente' },
  paused: { icon: PauseCircle, class: 'text-muted-foreground', label: 'Pausado' },
} as const

const config = () => STATUS_CONFIG[props.status]
</script>

<template>
  <Badge variant="outline" class="gap-1 text-[10px]" :class="config().class">
    <component :is="config().icon" class="size-3" />
    {{ config().label }}
  </Badge>
</template>
