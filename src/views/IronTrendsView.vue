<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { AlertCircle, RotateCcw } from '@lucide/vue'
import {
  buildIronTrendSeries,
  formatCigaretteCount,
  GRANULARITY_BY_TAB,
  type IronBucket,
  ironTrendWindow,
  windowLabelFor,
} from '@/lib/iron'
import { useIronStore } from '@/stores/iron'
import AppHeader from '@/components/AppHeader.vue'
import TrendAreaChart from '@/components/charts/TrendAreaChart.vue'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

// iron-ux.md sección 6: tendencias diario/semanal/mensual. Dos gráficos por
// pestaña (cantidad de cigarrillos y gasto en tabaco), reusando `TrendAreaChart`
// tal cual (con las dos props opcionales de la sección 6.4). Nunca acumulado,
// sin deltas: la forma de la curva se lee a ojo (sección 6.2).

type TabValue = 'daily' | 'weekly' | 'monthly'

const ironStore = useIronStore()

const activeTab = ref<TabValue>('daily')
const isLoading = ref(true)
const loadError = ref(false)

const cigaretteBuckets = ref<IronBucket[]>([])
const packBuckets = ref<IronBucket[]>([])

const granularity = computed(() => GRANULARITY_BY_TAB[activeTab.value])
const windowLabel = computed(() => windowLabelFor(granularity.value))
const hasAnyPackEver = computed(() => ironStore.hasAnyPackEver)

async function loadTrend() {
  isLoading.value = true
  loadError.value = false
  const { start, end } = ironTrendWindow(granularity.value)
  const res = await ironStore.fetchTrend(granularity.value, start, end)
  if (!res) {
    loadError.value = true
    isLoading.value = false
    return
  }
  cigaretteBuckets.value = res.cigarettes
  packBuckets.value = res.packs
  isLoading.value = false
}

onMounted(async () => {
  await ironStore.fetchHasAnyPack()
  await loadTrend()
})

watch(activeTab, () => {
  void loadTrend()
})

// Ventana alineada al bucket, compartida por ambas series de la pestaña activa.
const window = computed(() => ironTrendWindow(granularity.value))

const cigaretteCountPoints = computed(() =>
  buildIronTrendSeries(cigaretteBuckets.value, window.value.start, window.value.end, granularity.value),
)
const packSpendPoints = computed(() =>
  buildIronTrendSeries(packBuckets.value, window.value.start, window.value.end, granularity.value),
)

// Sección 6.2: se necesita al menos 2 buckets con datos reales para dibujar la
// tendencia (mismo criterio que "Por mes" de Estadísticas).
const hasCigaretteTrend = computed(() => cigaretteBuckets.value.length >= 2)
const hasPackTrend = computed(() => packBuckets.value.length >= 2)

const cigaretteMaxLabel = (max: number) => `Hasta ${formatCigaretteCount(max)}`

const NOT_ENOUGH = 'Todavía no hay suficiente historial para mostrar la tendencia.'
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <AppHeader title="Tendencias" />

    <main class="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <Tabs v-model="activeTab" default-value="daily">
        <TabsList class="grid w-full grid-cols-3">
          <TabsTrigger value="daily">
            Diario
          </TabsTrigger>
          <TabsTrigger value="weekly">
            Semanal
          </TabsTrigger>
          <TabsTrigger value="monthly">
            Mensual
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <!-- Estado de carga -->
      <template v-if="isLoading">
        <Skeleton class="h-56 w-full rounded-xl" />
        <Skeleton class="h-56 w-full rounded-xl" />
      </template>

      <!-- Estado de error -->
      <template v-else-if="loadError">
        <div class="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
          <AlertCircle class="size-12 text-destructive" />
          <p class="text-sm text-muted-foreground">
            No pudimos cargar las tendencias
          </p>
          <Button variant="outline" @click="loadTrend">
            <RotateCcw class="size-4" />
            Reintentar
          </Button>
        </div>
      </template>

      <template v-else>
        <!-- Cantidad de cigarrillos -->
        <Card>
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Cantidad de cigarrillos
            </CardTitle>
            <CardDescription>{{ windowLabel }}</CardDescription>
          </CardHeader>
          <div class="px-4 pb-6 sm:px-6">
            <TrendAreaChart
              v-if="hasCigaretteTrend"
              :points="cigaretteCountPoints"
              :height="160"
              show-axis
              :max-label-formatter="cigaretteMaxLabel"
              :ariaLabel="`Cigarrillos fumados, ${windowLabel}`"
            />
            <p v-else class="py-8 text-center text-sm text-muted-foreground">
              {{ NOT_ENOUGH }}
            </p>
          </div>
        </Card>

        <!-- Gasto en tabaco (oculto si nunca compró ninguna cajetilla) -->
        <Card v-if="hasAnyPackEver">
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Gasto en tabaco
            </CardTitle>
            <CardDescription>{{ windowLabel }} · compras de cajetilla</CardDescription>
          </CardHeader>
          <div class="px-4 pb-6 sm:px-6">
            <TrendAreaChart
              v-if="hasPackTrend"
              :points="packSpendPoints"
              :height="160"
              show-axis
              :ariaLabel="`Gasto en tabaco, ${windowLabel}`"
            />
            <p v-else class="py-8 text-center text-sm text-muted-foreground">
              {{ NOT_ENOUGH }}
            </p>
          </div>
        </Card>
      </template>
    </main>
  </div>
</template>
