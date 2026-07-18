<script setup lang="ts">
// Anillo de estado de un cupón (live-coupons-ux.md §6.2). SVG a mano, sin
// librería — mismo criterio que `CategoryDonutChart`/`DualTrendChart`: los
// colores van vía `hsl(var(--token))`, así el tema claro/oscuro cambia gratis
// sin watcher (el tramo gris usa `--muted-foreground`, que sí cambia entre
// temas, correcto).
//
// Es una paleta de ESTADO (no categórica), reusa los 4 tokens reservados
// (§4): success/warning/muted-foreground/destructive. La codificación
// secundaria que exige el hallazgo CVD rojo↔verde (§4.1/§4.2) la aportan la
// leyenda de al lado (ícono+texto+número) y el número "X/Y" del centro en
// tinta — este SVG lleva `role="img"` + `aria-label` compuesto, nunca comunica
// el dato solo por color. El gap de 2px entre segmentos separa físicamente el
// par rojo↔verde en la costura. Estático (no anima su llenado): se actualiza
// cuando llega un `bet_status` nuevo por Realtime.
import { computed } from 'vue'

const props = defineProps<{
  won: number
  live: number
  pending: number
  lost: number
}>()

const RADIUS = 40
const STROKE_WIDTH = 10
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
// ~2px de hueco en unidades del viewBox (100×100), separa arcos adyacentes.
const GAP = 2

const total = computed(() => props.won + props.live + props.pending + props.lost)

// Orden narrativo mejor→peor (§6.2): won → live → pending → lost. El par
// rojo↔verde solo se toca en la costura del anillo, resuelto por el gap.
const segments = computed(() => [
  { key: 'won', value: props.won, color: 'hsl(var(--success))' },
  { key: 'live', value: props.live, color: 'hsl(var(--warning))' },
  { key: 'pending', value: props.pending, color: 'hsl(var(--muted-foreground))' },
  { key: 'lost', value: props.lost, color: 'hsl(var(--destructive))' },
])

const arcs = computed(() => {
  if (total.value === 0) return []
  let offsetAccum = 0
  return segments.value
    .filter(segment => segment.value > 0)
    .map((segment) => {
      const length = (segment.value / total.value) * CIRCUMFERENCE
      const dashLength = Math.max(length - GAP, 0)
      const dashArray = `${dashLength} ${Math.max(CIRCUMFERENCE - dashLength, 0)}`
      const dashOffset = -offsetAccum
      offsetAccum += length
      return { key: segment.key, color: segment.color, dashArray, dashOffset }
    })
})

const ariaLabel = computed(
  () => `${props.won} ganados, ${props.live} en juego, ${props.pending} pendientes, ${props.lost} perdidos de ${total.value}`,
)
</script>

<template>
  <svg viewBox="0 0 100 100" role="img" :aria-label="ariaLabel">
    <!-- Track de fondo -->
    <circle
      cx="50"
      cy="50"
      :r="RADIUS"
      fill="none"
      stroke="hsl(var(--muted))"
      :stroke-width="STROKE_WIDTH"
    />
    <!-- Segmentos por estado -->
    <circle
      v-for="arc in arcs"
      :key="arc.key"
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
    <!-- Centro: "X/Y" en tinta + "acertados" (el dato clave no depende del color) -->
    <text
      x="50"
      y="47"
      text-anchor="middle"
      dominant-baseline="middle"
      class="fill-foreground text-[22px] font-bold tabular-nums"
    >{{ won }}/{{ total }}</text>
    <text
      x="50"
      y="64"
      text-anchor="middle"
      dominant-baseline="middle"
      class="fill-muted-foreground text-[10px]"
    >acertados</text>
  </svg>
</template>
