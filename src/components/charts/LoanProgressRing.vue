<script setup lang="ts">
// Anillo de progreso de un préstamo (loans-ux.md §6). SVG a mano, hermano de
// `CouponStatusRing.vue` — mismo criterio: colores vía `hsl(var(--token))`
// (el tema claro/oscuro cambia gratis, sin watcher). A diferencia de aquél
// (4 segmentos + "X/Y"), acá son 2 segmentos (pagado/falta) con el porcentaje
// centrado en tinta. `role="img"` + `aria-label` con el dato exacto en texto:
// el porcentaje nunca depende solo del color (mismo criterio a11y del proyecto).
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  /** 0-100. */
  percent: number
  size?: number
}>(), {
  size: 72,
})

const RADIUS = 40
const STROKE_WIDTH = 10
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

const clamped = computed(() => Math.max(0, Math.min(100, props.percent)))
const rounded = computed(() => Math.round(clamped.value))
const paidLength = computed(() => (clamped.value / 100) * CIRCUMFERENCE)
const dashArray = computed(() => `${paidLength.value} ${Math.max(CIRCUMFERENCE - paidLength.value, 0)}`)
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 100 100"
    role="img"
    :aria-label="`${rounded}% completado`"
  >
    <!-- Track de fondo = segmento "falta" -->
    <circle
      cx="50"
      cy="50"
      :r="RADIUS"
      fill="none"
      stroke="hsl(var(--muted))"
      :stroke-width="STROKE_WIDTH"
    />
    <!-- Segmento "pagado" -->
    <circle
      v-if="paidLength > 0"
      cx="50"
      cy="50"
      :r="RADIUS"
      fill="none"
      stroke="hsl(var(--success))"
      :stroke-width="STROKE_WIDTH"
      stroke-linecap="round"
      :stroke-dasharray="dashArray"
      stroke-dashoffset="0"
      transform="rotate(-90 50 50)"
    />
    <!-- Porcentaje centrado en tinta (no depende del color) -->
    <text
      x="50"
      y="52"
      text-anchor="middle"
      dominant-baseline="middle"
      class="fill-foreground text-[24px] font-bold tabular-nums"
    >{{ rounded }}%</text>
  </svg>
</template>
