<script setup lang="ts">
import { computed } from 'vue'
import { CircleCheck, CircleDashed, CircleX, Clock } from '@lucide/vue'
import type { BetSlipLeg } from '@/stores/liveMatches'

// Resumen compacto de conteos por estado de leg para la card
// (live-matches-ux.md sección 3.5). El detalle completo de cada leg (mercado
// + umbral + texto) vive únicamente en el detalle (sección 4.4). Estados y
// colores tomados del vocabulario central (`matchDisplay.ts`), acá inline por
// ser un resumen chico de conteos.

const props = defineProps<{
  legs: BetSlipLeg[]
}>()

const wonCount = computed(() => props.legs.filter(leg => leg.status === 'won').length)
const lostCount = computed(() => props.legs.filter(leg => leg.status === 'lost').length)
const pendingCount = computed(() => props.legs.filter(leg => leg.status === 'pending').length)
const notMonitorableCount = computed(() => props.legs.filter(leg => leg.status === 'not_monitorable').length)
</script>

<template>
  <div class="flex items-center gap-3 text-xs">
    <span v-if="wonCount > 0" class="flex items-center gap-1 text-success">
      <CircleCheck class="size-3.5" aria-hidden="true" />
      <span><span class="sr-only">Ganados: </span>{{ wonCount }}</span>
    </span>
    <span v-if="lostCount > 0" class="flex items-center gap-1 text-destructive">
      <CircleX class="size-3.5" aria-hidden="true" />
      <span><span class="sr-only">Perdidos: </span>{{ lostCount }}</span>
    </span>
    <span v-if="pendingCount > 0" class="flex items-center gap-1 text-muted-foreground">
      <Clock class="size-3.5" aria-hidden="true" />
      <span><span class="sr-only">Pendientes: </span>{{ pendingCount }}</span>
    </span>
    <span v-if="notMonitorableCount > 0" class="flex items-center gap-1 text-muted-foreground">
      <CircleDashed class="size-3.5" aria-hidden="true" />
      <span><span class="sr-only">No monitoreables: </span>{{ notMonitorableCount }}</span>
    </span>
    <span class="ml-auto text-muted-foreground">{{ legs.length }} selecc.</span>
  </div>
</template>
