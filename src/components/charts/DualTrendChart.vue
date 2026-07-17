<script setup lang="ts">
// Sección 3.8 de debts-ux.md: hermano de TrendAreaChart.vue, NO una extensión
// (contrato de color fijo por serie, normalización de eje Y compartida entre
// dos series, granularidad mensual en vez de diaria — ver justificación
// completa en el doc). Presentacional puro: recibe los puntos ya calculados
// (buildDebtBalanceEvolution de src/lib/charts.ts) y no llama a ningún store.
import { computed, useId } from 'vue'

export interface DualTrendPoint {
  /** Etiqueta corta de mes, ej. "Ene", "Feb" — ya formateada, el componente
   * no conoce fechas. */
  label: string
  lent: number
  borrowed: number
}

const props = withDefaults(defineProps<{
  /** Orden ascendente cronológico, longitud típica 12. */
  points: DualTrendPoint[]
  height?: number
  ariaLabel: string
}>(), {
  height: 120,
})

const VIEW_WIDTH = 100
const VIEW_HEIGHT = 32
const TOP_MARGIN = 4

// Único máximo compartido por ambas series (sección 3.8, punto 2): si cada
// línea normalizara contra su propio máximo, una "dominaría" visualmente solo
// por estar en una escala distinta, engañoso para comparar "yo presté" contra
// "me prestaron".
const maxAmount = computed(() => Math.max(0, ...props.points.flatMap(point => [point.lent, point.borrowed])))

function toCoords(values: number[]): { x: number, y: number }[] {
  const n = values.length
  if (n === 0) return []
  return values.map((value, idx) => {
    const x = n === 1 ? VIEW_WIDTH : (idx / (n - 1)) * VIEW_WIDTH
    const y = maxAmount.value === 0
      ? VIEW_HEIGHT
      : VIEW_HEIGHT - (value / maxAmount.value) * (VIEW_HEIGHT - TOP_MARGIN)
    return { x, y }
  })
}

// Mismo "midpoint smoothing" que TrendAreaChart.vue (sección 3.8: técnica
// reusada tal cual, ver ese componente para la explicación completa) —
// duplicado acá a propósito en vez de importado, ver justificación en el doc
// de por qué DualTrendChart es un componente hermano y no una extensión.
function buildSmoothCurve(pts: { x: number, y: number }[]): string {
  if (pts.length <= 1) return ''

  let d = ''
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]!
    const curr = pts[i]!
    const midX = (prev.x + curr.x) / 2
    const midY = (prev.y + curr.y) / 2
    d += ` Q${prev.x},${prev.y} ${midX},${midY}`
  }
  const last = pts[pts.length - 1]!
  d += ` L${last.x},${last.y}`
  return d
}

function buildLinePath(pts: { x: number, y: number }[]): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M${pts[0]!.x},${pts[0]!.y}`
  return `M${pts[0]!.x},${pts[0]!.y}${buildSmoothCurve(pts)}`
}

function buildAreaPath(pts: { x: number, y: number }[]): string {
  if (pts.length === 0) return ''
  const first = pts[0]!
  const last = pts[pts.length - 1]!
  if (pts.length === 1) return `M${first.x},${VIEW_HEIGHT} L${first.x},${first.y} L${last.x},${VIEW_HEIGHT} Z`
  return `M${first.x},${VIEW_HEIGHT} L${first.x},${first.y}${buildSmoothCurve(pts)} L${last.x},${VIEW_HEIGHT} Z`
}

const lentCoords = computed(() => toCoords(props.points.map(point => point.lent)))
const borrowedCoords = computed(() => toCoords(props.points.map(point => point.borrowed)))

const lentLinePath = computed(() => buildLinePath(lentCoords.value))
const lentAreaPath = computed(() => buildAreaPath(lentCoords.value))
const borrowedLinePath = computed(() => buildLinePath(borrowedCoords.value))
const borrowedAreaPath = computed(() => buildAreaPath(borrowedCoords.value))

const lastLentPoint = computed(() => lentCoords.value.at(-1) ?? null)
const lastBorrowedPoint = computed(() => borrowedCoords.value.at(-1) ?? null)

// `id` único por instancia (dos gradientes en el mismo SVG, mismo criterio
// que TrendAreaChart.vue).
const lentGradientId = `debt-lent-gradient-${useId()}`
const borrowedGradientId = `debt-borrowed-gradient-${useId()}`

// Sección 3.8: etiquetas de eje X cada 2 meses si hay más de 6 puntos (evita
// amontonar 12 etiquetas en una pantalla chica), todas si hay 6 o menos.
const axisLabels = computed(() => {
  if (props.points.length === 0) return []
  if (props.points.length <= 6) return props.points.map((point, idx) => ({ key: idx, label: point.label }))
  return props.points
    .map((point, idx) => ({ key: idx, label: point.label }))
    .filter((_, idx) => idx % 2 === 0)
})
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
      <defs>
        <linearGradient :id="lentGradientId" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="hsl(var(--success))" stop-opacity="0.28" />
          <stop offset="100%" stop-color="hsl(var(--success))" stop-opacity="0" />
        </linearGradient>
        <linearGradient :id="borrowedGradientId" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="hsl(var(--destructive))" stop-opacity="0.28" />
          <stop offset="100%" stop-color="hsl(var(--destructive))" stop-opacity="0" />
        </linearGradient>
      </defs>

      <path :d="lentAreaPath" :fill="`url(#${lentGradientId})`" stroke="none" />
      <path :d="borrowedAreaPath" :fill="`url(#${borrowedGradientId})`" stroke="none" />

      <path
        :d="lentLinePath"
        fill="none"
        stroke="hsl(var(--success))"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      />
      <path
        :d="borrowedLinePath"
        fill="none"
        stroke="hsl(var(--destructive))"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      />

      <circle
        v-if="lastLentPoint"
        :cx="lastLentPoint.x"
        :cy="lastLentPoint.y"
        r="3"
        fill="hsl(var(--success))"
        stroke="hsl(var(--card))"
        stroke-width="2"
        vector-effect="non-scaling-stroke"
      />
      <circle
        v-if="lastBorrowedPoint"
        :cx="lastBorrowedPoint.x"
        :cy="lastBorrowedPoint.y"
        r="3"
        fill="hsl(var(--destructive))"
        stroke="hsl(var(--card))"
        stroke-width="2"
        vector-effect="non-scaling-stroke"
      />
    </svg>

    <div v-if="axisLabels.length" class="flex justify-between text-[10px] text-muted-foreground">
      <span v-for="item in axisLabels" :key="item.key">{{ item.label }}</span>
    </div>
  </div>
</template>
