<script setup lang="ts">
// Sección 5.1 de dashboard-redesign-ux.md. Presentacional: recibe los puntos
// ya calculados (buildCumulativeDailySeries / buildDailySeries de
// src/lib/charts.ts) y no llama a ningún store.
import { computed } from 'vue'

export interface TrendPoint {
  date: string
  amount: number
}

const props = withDefaults(defineProps<{
  /** Orden ascendente por fecha, ya con huecos rellenados a 0. */
  points: TrendPoint[]
  height?: number
  ariaLabel: string
  /** Línea base + 3 etiquetas de eje X (variante de Estadísticas, sección 4.2). */
  showAxis?: boolean
}>(), {
  height: 64,
  showAxis: false,
})

const VIEW_WIDTH = 100
const VIEW_HEIGHT = 32
const TOP_MARGIN = 4

const maxAmount = computed(() => Math.max(0, ...props.points.map(point => point.amount)))

const coords = computed(() => {
  const points = props.points
  const n = points.length
  if (n === 0) return []
  return points.map((point, idx) => {
    const x = n === 1 ? VIEW_WIDTH : (idx / (n - 1)) * VIEW_WIDTH
    const y = maxAmount.value === 0
      ? VIEW_HEIGHT
      : VIEW_HEIGHT - (point.amount / maxAmount.value) * (VIEW_HEIGHT - TOP_MARGIN)
    return { x, y }
  })
})

const linePath = computed(() => {
  if (coords.value.length === 0) return ''
  return coords.value.map((c, idx) => `${idx === 0 ? 'M' : 'L'}${c.x},${c.y}`).join(' ')
})

const areaPath = computed(() => {
  const list = coords.value
  if (list.length === 0) return ''
  const first = list[0]!
  const last = list[list.length - 1]!
  const middle = list.map(c => `L${c.x},${c.y}`).join(' ')
  return `M${first.x},${VIEW_HEIGHT} ${middle} L${last.x},${VIEW_HEIGHT} Z`
})

const lastPoint = computed(() => coords.value.at(-1) ?? null)

// Nota de implementación (deviación menor del doc, sección 5.1): el doc pide
// 3 `<text>` de eje X dentro del propio SVG. Como el `viewBox` no es 1:1
// (ancho y alto se estiran con proporciones distintas por
// `preserveAspectRatio="none"`), un `<text>` nativo ahí adentro saldría con
// las letras deformadas (mismo motivo por el que la línea necesita
// `vector-effect="non-scaling-stroke"`, que no existe para texto). Se
// renderizan en su lugar como una fila HTML aparte debajo del SVG
// (`text-[10px] text-muted-foreground`, mismo tamaño/color pedido), que da
// el mismo resultado visual sin el bug de escalado.
const axisLabels = computed(() => {
  if (!props.showAxis || props.points.length === 0) return []
  const lastIdx = props.points.length - 1
  const midIdx = Math.floor(lastIdx / 2)
  const indices = [...new Set([0, midIdx, lastIdx])]
  return indices.map(idx => ({ key: idx, label: formatAxisLabel(props.points[idx]!.date) }))
})

function formatAxisLabel(dateStr: string): string {
  const day = dateStr.split('-')[2]
  return day ? String(Number(day)) : dateStr
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <svg
      role="img"
      :aria-label="ariaLabel"
      :viewBox="`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`"
      preserveAspectRatio="none"
      width="100%"
      :height="height"
    >
      <line
        v-if="showAxis"
        x1="0"
        :y1="VIEW_HEIGHT"
        :x2="VIEW_WIDTH"
        :y2="VIEW_HEIGHT"
        stroke="hsl(var(--border))"
        stroke-width="1"
        vector-effect="non-scaling-stroke"
      />
      <path :d="areaPath" fill="hsl(var(--primary))" fill-opacity="0.1" stroke="none" />
      <path
        :d="linePath"
        fill="none"
        stroke="hsl(var(--primary))"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      />
      <circle
        v-if="lastPoint"
        :cx="lastPoint.x"
        :cy="lastPoint.y"
        r="3"
        fill="hsl(var(--primary))"
        stroke="hsl(var(--card))"
        stroke-width="2"
        vector-effect="non-scaling-stroke"
      />
    </svg>

    <div v-if="showAxis && axisLabels.length" class="flex justify-between text-[10px] text-muted-foreground">
      <span v-for="item in axisLabels" :key="item.key">{{ item.label }}</span>
    </div>
  </div>
</template>
