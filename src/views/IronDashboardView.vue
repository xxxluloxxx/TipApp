<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertCircle,
  ChevronRight,
  Cigarette,
  CigaretteOff,
  Clock,
  Package,
  RotateCcw,
  X,
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import { formatAmount } from '@/lib/currency'
import { formatCigaretteCount, pendingSinceLabel } from '@/lib/iron'
import { useAccountsStore } from '@/stores/accounts'
import { useIronStore } from '@/stores/iron'
import AppHeader from '@/components/AppHeader.vue'
import IronPackFormSheet from '@/components/IronPackFormSheet.vue'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

// iron-ux.md sección 4: panorama + accesos rápidos. Banner de mitad pendiente,
// registro de un toque con "Deshacer" (sección 4.4), compra de cajetilla y
// resumen de hoy / este mes (sin deltas inventados, sección 4.5).

const router = useRouter()
const ironStore = useIronStore()
const accountsStore = useAccountsStore()

const isInitialLoading = ref(true)
const loadError = ref(false)

async function loadAll() {
  loadError.value = false
  isInitialLoading.value = true
  try {
    const [dashboardOk, accountsOk] = await Promise.all([
      ironStore.fetchDashboard(),
      accountsStore.fetchAccounts(),
    ])
    if (!dashboardOk || !accountsOk) loadError.value = true
  } finally {
    isInitialLoading.value = false
  }
}

onMounted(loadAll)

const pendingHalf = computed(() => ironStore.pendingHalf)
const pendingLabel = computed(() =>
  pendingHalf.value
    ? pendingSinceLabel(pendingHalf.value.pending_since_date, pendingHalf.value.pending_since_time)
    : '',
)
const todayCigaretteLabel = computed(() => formatCigaretteCount(ironStore.todayCigaretteUnits))
const monthPackSpend = computed(() => ironStore.monthPackSpend)

// Sección 4.7: hint de estado vacío total (sin ningún registro todavía). Los
// accesos rápidos siguen visibles igual — solo se agrega la línea extra.
const showEmptyHint = computed(() => !ironStore.hasAnyCigaretteEver && !ironStore.hasAnyPackEver)

function logWhole() {
  const res = ironStore.logCigarette('entero')
  if (!res) return
  toast('Cigarrillo registrado', {
    duration: 5000,
    action: { label: 'Deshacer', onClick: () => ironStore.undoLog(res.tempId) },
  })
}

function logHalf() {
  if (ironStore.pendingHalf) return
  const res = ironStore.logCigarette('mitad')
  if (!res) return
  toast('Media registrada', {
    duration: 5000,
    action: { label: 'Deshacer', onClick: () => ironStore.undoLog(res.tempId) },
  })
}

// Sección 12.1: registrar una media que no se termina, en un solo toque.
// Siempre habilitada (nace en `status = 'descartada'`, sin conflicto con el
// índice de mitad pendiente); mismo patrón "Deshacer" que los otros registros.
function logDiscardedHalf() {
  const res = ironStore.logDiscardedHalf()
  if (!res) return
  toast('Media registrada (no terminada)', {
    duration: 5000,
    action: { label: 'Deshacer', onClick: () => ironStore.undoLog(res.tempId) },
  })
}

function onClosePendingHalf() {
  void ironStore.closePendingHalf()
}

function onDiscardPendingHalf() {
  void ironStore.discardPendingHalf()
}

const isPackSheetOpen = ref(false)
function openPackSheet() {
  isPackSheetOpen.value = true
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <AppHeader title="Iron" />

    <main class="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <div class="flex flex-col gap-1">
        <p class="text-sm text-muted-foreground">
          Registrá tu consumo de tabaco y seguí tu progreso.
        </p>
        <p v-if="!isInitialLoading && !loadError && showEmptyHint" class="text-sm text-muted-foreground">
          Todavía no registraste nada. Empezá tocando un botón de abajo.
        </p>
      </div>

      <!-- Estado de carga -->
      <template v-if="isInitialLoading">
        <Skeleton class="h-20 w-full rounded-xl" />
        <div class="grid grid-cols-2 gap-3">
          <Skeleton class="h-24 w-full rounded-lg" />
          <Skeleton class="h-24 w-full rounded-lg" />
        </div>
        <Skeleton class="h-11 w-full rounded-lg" />
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Skeleton class="h-24 w-full rounded-xl" />
          <Skeleton class="h-24 w-full rounded-xl" />
        </div>
      </template>

      <!-- Estado de error -->
      <template v-else-if="loadError">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <AlertCircle class="size-12 text-destructive" />
          <h2 class="text-lg font-semibold">
            No pudimos cargar tu información de Iron
          </h2>
          <p class="text-sm text-muted-foreground">
            Revisá tu conexión e intentá de nuevo.
          </p>
          <Button variant="outline" @click="loadAll">
            <RotateCcw class="size-4" />
            Reintentar
          </Button>
        </div>
      </template>

      <template v-else>
        <!-- Sección 4.3: banner de mitad pendiente -->
        <Card v-if="pendingHalf" class="border-warning/30 bg-warning/5">
          <div class="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
            <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
              <Clock class="size-4" />
            </span>
            <div class="flex min-w-0 flex-1 flex-col">
              <p class="text-sm font-medium">
                Tenés una mitad pendiente
              </p>
              <p class="text-xs text-muted-foreground">
                Empezada {{ pendingLabel }}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <Button
                size="icon"
                variant="ghost"
                class="h-11 w-11"
                aria-label="Descartar mitad pendiente"
                @click="onDiscardPendingHalf"
              >
                <X class="size-4" />
              </Button>
              <Button class="h-11" @click="onClosePendingHalf">
                Fumé la otra mitad
              </Button>
            </div>
          </div>
        </Card>

        <!-- Sección 4.4: accesos rápidos (un toque, sin Sheet) -->
        <div class="flex flex-col gap-2">
          <div class="grid grid-cols-2 gap-3">
            <button
              type="button"
              class="flex min-h-11 flex-col items-center gap-2 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              @click="logWhole"
            >
              <Cigarette class="size-6" />
              <span class="text-sm font-medium">Fumé uno entero</span>
            </button>

            <button
              type="button"
              class="relative flex min-h-11 flex-col items-center gap-2 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
              :disabled="!!pendingHalf"
              @click="logHalf"
            >
              <span class="relative">
                <Cigarette class="size-6" />
                <span class="absolute -right-1.5 -top-1.5 rounded-full bg-muted px-1 text-[9px] font-bold leading-tight text-muted-foreground">½</span>
              </span>
              <span class="text-sm font-medium">Fumé la mitad</span>
            </button>
          </div>
          <p v-if="pendingHalf" class="text-center text-xs text-muted-foreground">
            Cerrá la mitad pendiente de arriba antes de empezar una nueva.
          </p>

          <!-- Sección 12.1: acción de un toque, peso visual menor que los botones de arriba -->
          <button
            type="button"
            class="mx-auto flex min-h-11 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            @click="logDiscardedHalf"
          >
            <CigaretteOff class="size-4" />
            Fumé la mitad y no la termino
          </button>

          <Button variant="outline" class="h-11 w-full" @click="openPackSheet">
            <Package class="size-4" />
            Registrar cajetilla comprada
          </Button>
        </div>

        <!-- Sección 4.5: resumen de hoy / este mes -->
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card>
            <div class="flex flex-col gap-1 px-4 py-4 sm:px-6">
              <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Hoy
              </p>
              <p class="text-2xl font-bold tabular-nums tracking-tight">
                {{ todayCigaretteLabel }}
              </p>
            </div>
          </Card>
          <Card>
            <div class="flex flex-col gap-1 px-4 py-4 sm:px-6">
              <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Este mes
              </p>
              <p class="text-2xl font-bold tabular-nums tracking-tight">
                ${{ formatAmount(monthPackSpend) }}
              </p>
              <p class="text-xs text-muted-foreground">
                en compras de tabaco
              </p>
            </div>
          </Card>
        </div>

        <!-- Sección 4.6: accesos a Historial / Tendencias -->
        <div class="flex flex-col gap-2">
          <Button variant="outline" class="h-11 w-full justify-between" @click="router.push({ name: 'iron-history' })">
            Ver historial completo
            <ChevronRight class="size-4" />
          </Button>
          <Button variant="outline" class="h-11 w-full justify-between" @click="router.push({ name: 'iron-trends' })">
            Ver tendencias
            <ChevronRight class="size-4" />
          </Button>
        </div>
      </template>
    </main>

    <IronPackFormSheet v-model:open="isPackSheetOpen" />
  </div>
</template>
