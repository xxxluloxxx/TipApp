<script setup lang="ts">
// reports-detail-ux.md sección 6.1: hermano de DualTrendChart.vue, NO una
// extensión (geometría distinta — barras agrupadas por mes discreto vs. curva
// continua; ver justificación completa en el doc). Presentacional puro:
// recibe los puntos ya calculados (buildMonthlyBarPoints de src/lib/charts.ts)
// y no llama a ningún store. `chart.js` descartado por el mismo motivo de
// dashboard-redesign-ux.md sección 0 (canvas no repinta solo con el tema).
import { computed } from 'vue'
import { formatAmount } from '@/lib/currency'

export interface MonthlyBarPoint {
  /** Etiqueta corta de mes, ej. "Ene", "Feb" — ya formateada (mismo contrato
   * que DualTrendPoint.label). */
  label: string
  income: number
  expense: number
}

const props = withDefaults(defineProps<{
  /** Longitud fija 6, orden ascendente cronológico. */
  points: MonthlyBarPoint[]
  height?: number
  ariaLabel: string
}>(), {
  height: 140,
})

const VIEW_WIDTH = 100
const VIEW_HEIGHT = 32
const TOP_MARGIN = 4

const SLOT_WIDTH = VIEW_WIDTH / 6
// Gap entre las 2 barras de un mismo mes (~10% del ancho del slot) + margen a
// los costados para que las barras queden centradas dentro de su slot.
const INNER_GAP = SLOT_WIDTH * 0.1
const SIDE_MARGIN = SLOT_WIDTH * 0.14
const BAR_WIDTH = (SLOT_WIDTH - INNER_GAP - SIDE_MARGIN * 2) / 2

// Escala compartida por ambas series de los 6 meses (sección 6.1, punto
// "maxAmount"): una sola escala para poder comparar visualmente ingreso vs.
// gasto del mismo mes, no una por serie.
const maxAmount = computed(() =>
  Math.max(0, ...props.points.flatMap(point => [point.income, point.expense])),
)

interface Bar {
  key: string
  x: number
  y: number
  barHeight: number
  color: string
}

function barHeightFor(value: number): number {
  if (maxAmount.value === 0) return 0
  return (value / maxAmount.value) * (VIEW_HEIGHT - TOP_MARGIN)
}

const bars = computed<Bar[]>(() => {
  const result: Bar[] = []
  props.points.forEach((point, idx) => {
    const slotStart = idx * SLOT_WIDTH + SIDE_MARGIN
    const incomeHeight = barHeightFor(point.income)
    const expenseHeight = barHeightFor(point.expense)
    result.push({
      key: `income-${idx}`,
      x: slotStart,
      y: VIEW_HEIGHT - incomeHeight,
      barHeight: incomeHeight,
      color: 'hsl(var(--success))',
    })
    result.push({
      key: `expense-${idx}`,
      x: slotStart + BAR_WIDTH + INNER_GAP,
      y: VIEW_HEIGHT - expenseHeight,
      barHeight: expenseHeight,
      color: 'hsl(var(--destructive))',
    })
  })
  return result
})

const monthLabels = computed(() => props.points.map((point, idx) => ({ key: idx, label: point.label })))

// Mismo agregado de eje Y que TrendAreaChart/DualTrendChart: techo del eje en
// fila propia arriba del SVG.
const maxAmountLabel = computed(() => `Hasta $${formatAmount(maxAmount.value)}`)
</script>

<template>
  <div class="flex flex-col gap-1">
    <p class="text-[10px] text-muted-foreground">
      {{ maxAmountLabel }}
    </p>

    <svg
      role="img"
      :aria-label="ariaLabel"
      :viewBox="`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`"
      preserveAspectRatio="none"
      width="100%"
      :height="height"
    >
      <line
        x1="0"
        :y1="VIEW_HEIGHT"
        :x2="VIEW_WIDTH"
        :y2="VIEW_HEIGHT"
        stroke="hsl(var(--border))"
        stroke-width="1"
        vector-effect="non-scaling-stroke"
      />
      <rect
        v-for="bar in bars"
        :key="bar.key"
        :x="bar.x"
        :y="bar.y"
        :width="BAR_WIDTH"
        :height="bar.barHeight"
        :fill="bar.color"
        rx="1"
      />
    </svg>

    <!-- Etiquetas de mes: fila HTML aparte debajo del SVG (mismo motivo que
         axisLabels de TrendAreaChart — texto nativo dentro de un SVG con
         preserveAspectRatio="none" sale deformado). -->
    <div class="flex text-[10px] text-muted-foreground">
      <span v-for="item in monthLabels" :key="item.key" class="flex-1 text-center capitalize">
        {{ item.label }}
      </span>
    </div>

    <!-- Leyenda: 2 series no se distinguen solo por posición (sección 6.1) —
         color + texto, mismo criterio de a11y de toda leyenda del proyecto. -->
    <div class="mt-1 flex items-center justify-center gap-4 text-xs text-muted-foreground">
      <span class="flex items-center gap-1.5">
        <span class="size-2.5 rounded-full" style="background: hsl(var(--success))" />
        Ingresos
      </span>
      <span class="flex items-center gap-1.5">
        <span class="size-2.5 rounded-full" style="background: hsl(var(--destructive))" />
        Gastos
      </span>
    </div>
  </div>
</template>
