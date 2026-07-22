<script setup lang="ts">
// reports-detail-ux.md sección 6.2: barras de magnitud divergentes ancladas
// al centro, con <div> + width en porcentaje (NO SVG — mismo patrón "barra =
// width %" ya usado por "Por mes" de StatisticsView y los rankings de
// Tarjetas). Presentacional: recibe filas ya filtradas (sin `null`, sección
// 5.4 del doc — las categorías "Nuevo"/"Ya no aparece" no tienen % graficable
// y viven solo en la tabla de arriba) y deriva internamente `barWidthPercent`.
import { computed } from 'vue'
import { ArrowDown, ArrowUp } from '@lucide/vue'

export interface CategoryVariationRow {
  id: string
  name: string
  /** Siempre positivo — la dirección va en `direction`. */
  percent: number
  direction: 'up' | 'down'
}

const props = defineProps<{ rows: CategoryVariationRow[] }>()

// Escala contra el máximo |percent| del conjunto (mismo `percentOfMax` de
// "Por mes"/rankings): evita que una categoría con +400% aplaste visualmente
// a las demás. La mitad de la pista (50%) representa el 100% relativo del set.
const scaledRows = computed(() => {
  const maxAbs = Math.max(0, ...props.rows.map(row => row.percent))
  return props.rows.map(row => ({
    ...row,
    barWidthPercent: maxAbs === 0 ? 0 : (row.percent / maxAbs) * 50,
  }))
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <div v-for="row in scaledRows" :key="row.id" class="flex items-center gap-2">
      <span class="w-24 shrink-0 truncate text-xs text-muted-foreground">{{ row.name }}</span>
      <div class="relative h-2 flex-1 rounded-full bg-muted">
        <div class="absolute inset-y-0 left-1/2 w-px bg-border" aria-hidden="true" />
        <div
          class="absolute inset-y-0 rounded-full"
          :class="row.direction === 'up' ? 'left-1/2 bg-destructive' : 'right-1/2 bg-success'"
          :style="{ width: `${row.barWidthPercent}%` }"
        />
      </div>
      <span
        class="flex w-16 shrink-0 items-center justify-end gap-0.5 text-xs font-medium tabular-nums"
        :class="row.direction === 'up' ? 'text-destructive' : 'text-success'"
      >
        <component :is="row.direction === 'up' ? ArrowUp : ArrowDown" class="size-3" />
        {{ Math.round(row.percent) }}%
      </span>
    </div>
  </div>
</template>
