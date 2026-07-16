<script setup lang="ts">
// Sección 5.2 de dashboard-redesign-ux.md. Presentacional: recibe los slices
// ya armados (buildDonutSlices de src/lib/charts.ts) y no llama a ningún
// store. Toda la información accesible (nombre/monto/%) vive en la leyenda
// HTML que acompaña a este componente en cada vista, no acá — por eso el SVG
// es `aria-hidden`.
import { computed } from 'vue'

export interface DonutSlice {
  id: string
  name: string
  color: string | null
  amount: number
  percentLabel: string
  folded?: { id: string, name: string, amount: number }[]
}

const props = defineProps<{ slices: DonutSlice[] }>()

const RADIUS = 40
const STROKE_WIDTH = 18
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const GAP = CIRCUMFERENCE * 0.018

const total = computed(() => props.slices.reduce((sum, slice) => sum + slice.amount, 0))

const arcs = computed(() => {
  if (total.value === 0) return []

  let offsetAccum = 0
  return props.slices.map((slice) => {
    const length = (slice.amount / total.value) * CIRCUMFERENCE
    const dashLength = Math.max(length - GAP, 0)
    const dashArray = `${dashLength} ${Math.max(CIRCUMFERENCE - dashLength, 0)}`
    const dashOffset = -offsetAccum
    offsetAccum += length
    return {
      id: slice.id,
      color: slice.color ?? 'hsl(var(--muted-foreground))',
      dashArray,
      dashOffset,
    }
  })
})
</script>

<template>
  <svg aria-hidden="true" focusable="false" viewBox="0 0 100 100">
    <circle
      cx="50"
      cy="50"
      :r="RADIUS"
      fill="none"
      stroke="hsl(var(--card))"
      :stroke-width="STROKE_WIDTH"
    />
    <circle
      v-for="arc in arcs"
      :key="arc.id"
      cx="50"
      cy="50"
      :r="RADIUS"
      fill="none"
      :stroke="arc.color"
      :stroke-width="STROKE_WIDTH"
      stroke-linecap="butt"
      :stroke-dasharray="arc.dashArray"
      :stroke-dashoffset="arc.dashOffset"
      transform="rotate(-90 50 50)"
    />
  </svg>
</template>
