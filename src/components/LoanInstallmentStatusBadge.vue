<script setup lang="ts">
import { AlertCircle, CircleCheck, Clock } from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import type { LoanInstallmentDisplayStatus } from '@/stores/loans'

// Sección 9.2 de loans-ux.md: badge de una cuota individual (3 estados). Mismo
// vocabulario visual (Clock/AlertCircle/CircleCheck) que `LoanStatusBadge` y
// Gastos fijos, pero con copy en femenino ("Atrasada"/"Pagada", es una cuota).

const props = defineProps<{ status: LoanInstallmentDisplayStatus }>()

const STATUS_CONFIG = {
  pending: { icon: Clock, class: 'text-muted-foreground', label: 'Pendiente' },
  overdue: { icon: AlertCircle, class: 'text-destructive', label: 'Atrasada' },
  paid: { icon: CircleCheck, class: 'text-success', label: 'Pagada' },
} as const

const config = () => STATUS_CONFIG[props.status]
</script>

<template>
  <Badge variant="outline" class="gap-1 text-[10px]" :class="config().class">
    <component :is="config().icon" class="size-3" />
    {{ config().label }}
  </Badge>
</template>
