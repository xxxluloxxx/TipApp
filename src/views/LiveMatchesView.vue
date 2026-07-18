<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertCircle,
  ArrowLeft,
  BellRing,
  EllipsisVertical,
  Goal,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Smartphone,
  TriangleAlert,
  Trash2,
  X,
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import { useLiveMatchesStore, type LiveMatch } from '@/stores/liveMatches'
import { usePushNotificationsStore } from '@/stores/pushNotifications'
import { isLiveStage, matchClockLabel } from '@/lib/matchClock'
import { relativeTimeShort } from '@/lib/relativeTime'
import { stateDisplay } from '@/lib/matchDisplay'
import MatchStatsRow from '@/components/MatchStatsRow.vue'
import MatchLegsSummary from '@/components/MatchLegsSummary.vue'
import MatchFormSheet from '@/components/MatchFormSheet.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

// Dashboard de partidos en vivo (live-matches-ux.md sección 3). Lista
// agrupada por estado de monitoreo (sección 3.4, sin Tabs — todo visible en
// un scroll), banner de permiso de notificaciones (6.1), FAB de alta (3.6).

const router = useRouter()
const liveMatchesStore = useLiveMatchesStore()
const pushStore = usePushNotificationsStore()

const isInitialLoading = ref(true)
const loadError = ref(false)
const isSheetOpen = ref(false)

// Ticker de 1s (sección 1.4/1.5): mueve el minuto en vivo y el "Actualizado
// hace Ns" sin tocar la red. Un solo `now` compartido por todas las cards.
const now = ref(Date.now())
let tickerId: ReturnType<typeof setInterval> | null = null

async function loadAll() {
  loadError.value = false
  isInitialLoading.value = true
  try {
    const ok = await liveMatchesStore.fetchAll()
    if (!ok) loadError.value = true
  } finally {
    isInitialLoading.value = false
  }
}

// Sección 1.3: red de seguridad al volver a foreground — un refetch completo
// una sola vez, por si el socket de Realtime se cayó en segundo plano.
function onVisibilityChange() {
  if (document.visibilityState === 'visible') {
    void liveMatchesStore.fetchAll()
    void pushStore.refresh()
  }
}

onMounted(async () => {
  await loadAll()
  liveMatchesStore.subscribeRealtime()
  void pushStore.refresh()
  tickerId = setInterval(() => {
    now.value = Date.now()
  }, 1000)
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onBeforeUnmount(() => {
  liveMatchesStore.unsubscribeRealtime()
  if (tickerId !== null) clearInterval(tickerId)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})

// --- Agrupado y orden (sección 3.4) --------------------------------------

function isLive(match: LiveMatch): boolean {
  return isLiveStage(match.stage_code)
}

function clockLabel(match: LiveMatch): string {
  return matchClockLabel(match.stage_code, match.stage_anchor_ts, match.scheduled_kickoff_ts, now.value)
}

function relativeTime(iso: string | null): string {
  return relativeTimeShort(iso, now.value)
}

/** Sin snapshot todavía (sección 5.5): partido recién agregado cuyo primer
 * poll aún no llegó. */
function isAwaitingData(match: LiveMatch): boolean {
  return match.last_polled_at === null
}

function scoreText(value: number | null): string {
  return value === null ? '-' : String(value)
}

function sortLiveGroup(list: LiveMatch[]): LiveMatch[] {
  return [...list].sort((a, b) => {
    const aRunning = isLive(a)
    const bRunning = isLive(b)
    // Corriendo primero, ordenados por cambio más reciente (sección 3.3).
    if (aRunning !== bRunning) return aRunning ? -1 : 1
    if (aRunning) return b.last_changed_at.localeCompare(a.last_changed_at)
    // "Por empezar": hora de inicio más próxima primero.
    const aKick = a.scheduled_kickoff_ts ?? ''
    const bKick = b.scheduled_kickoff_ts ?? ''
    return aKick.localeCompare(bKick)
  })
}

const liveGroup = computed(() => sortLiveGroup(liveMatchesStore.matches.filter(m => m.state === 'monitoring')))
const pausedGroup = computed(() =>
  [...liveMatchesStore.matches.filter(m => m.state === 'paused')].sort((a, b) => b.last_changed_at.localeCompare(a.last_changed_at)),
)
const finishedGroup = computed(() =>
  [...liveMatchesStore.matches.filter(m => m.state === 'finished')].sort((a, b) => b.last_changed_at.localeCompare(a.last_changed_at)),
)

// --- Banner de notificaciones (sección 6.1 / 6.4) ------------------------

const hasMonitoring = computed(() => liveMatchesStore.matches.some(m => m.state === 'monitoring'))

const showPermissionBanner = computed(() =>
  pushStore.supported
  && pushStore.permission === 'default'
  && !pushStore.bannerDismissed
  && hasMonitoring.value,
)

// Nota de limitación (sección 6.4): solo si el navegador no soporta push
// (típicamente iOS sin instalar). El banner y esta nota son mutuamente
// excluyentes (si no hay soporte, no hay permiso `default` que pedir).
const showUnsupportedNote = computed(() => !pushStore.supported && liveMatchesStore.hasMatches)

async function requestNotificationPermission() {
  const result = await pushStore.enable()
  if (result.ok) {
    toast.success('Notificaciones activadas')
  } else if (result.reason === 'error' || result.reason === 'no_key') {
    toast.error('No pudimos activar las notificaciones. Intentá de nuevo.')
  }
  // 'denied': sin toast, el navegador ya dio su feedback nativo (sección 6.1).
  pushStore.dismissBanner()
}

function dismissNotificationBanner() {
  pushStore.dismissBanner()
}

// --- Acciones -------------------------------------------------------------

function openMatch(match: LiveMatch) {
  router.push({ name: 'match-detail', params: { id: match.id } })
}

function toggleMonitoring(match: LiveMatch) {
  liveMatchesStore.toggleMonitoring(match.id)
}

function removeMatch(match: LiveMatch) {
  liveMatchesStore.removeMatch(match.id)
}

function openAddSheet() {
  isSheetOpen.value = true
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <header class="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-6 sm:py-4 lg:px-8">
      <Button variant="ghost" size="icon" aria-label="Volver" @click="router.push({ name: 'home' })">
        <ArrowLeft class="size-5" />
      </Button>
      <h1 class="text-xl font-semibold">
        Partidos en vivo
      </h1>
    </header>

    <main class="mx-auto flex max-w-md flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <!-- Carga (sección 3.7) -->
      <template v-if="isInitialLoading">
        <Card v-for="i in 3" :key="i" class="overflow-hidden">
          <div class="flex flex-col gap-3 p-4">
            <Skeleton class="h-3 w-24" />
            <div class="flex items-center justify-between gap-3">
              <div class="flex flex-1 flex-col gap-1.5">
                <Skeleton class="h-4 w-32" />
                <Skeleton class="h-4 w-28" />
              </div>
              <Skeleton class="h-10 w-8" />
            </div>
            <Skeleton class="h-10 w-full" />
          </div>
        </Card>
      </template>

      <!-- Error de carga de la lista (sección 3.7) -->
      <template v-else-if="loadError">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <AlertCircle class="size-12 text-destructive" />
          <h2 class="text-lg font-semibold">
            No pudimos cargar tus partidos
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

      <!-- Vacío (sección 3.7) -->
      <template v-else-if="!liveMatchesStore.hasMatches">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <Goal class="size-12 text-muted-foreground" />
          <h2 class="text-lg font-semibold">
            Todavía no estás siguiendo ningún partido.
          </h2>
          <p class="max-w-xs text-center text-sm text-muted-foreground">
            Pegá el link de un partido de Flashscore para ver sus estadísticas en vivo y recibir avisos.
          </p>
          <Button @click="openAddSheet">
            Agregar partido
          </Button>
        </div>
      </template>

      <template v-else>
        <!-- Banner de notificaciones (sección 6.1) -->
        <Card v-if="showPermissionBanner" class="border-primary/30 bg-primary/5">
          <div class="flex items-start gap-3 px-4 py-4">
            <BellRing class="size-5 shrink-0 text-primary" />
            <div class="flex-1">
              <p class="text-sm font-medium">
                Activá las notificaciones
              </p>
              <p class="text-sm text-muted-foreground">
                Te avisamos cuando haya un gol, una tarjeta, o se decida una selección de tu cupón.
              </p>
              <div class="mt-3 flex gap-2">
                <Button size="sm" :disabled="pushStore.isBusy" @click="requestNotificationPermission">
                  Activar
                </Button>
                <Button size="sm" variant="ghost" @click="dismissNotificationBanner">
                  Ahora no
                </Button>
              </div>
            </div>
            <Button variant="ghost" size="icon" class="-mr-2 -mt-2 size-9" aria-label="Cerrar" @click="dismissNotificationBanner">
              <X class="size-4" />
            </Button>
          </div>
        </Card>

        <!-- Nota de limitación iOS / navegador sin soporte (sección 6.4) -->
        <Card v-else-if="showUnsupportedNote" class="border-primary/30 bg-primary/5">
          <p class="flex items-start gap-2 px-4 py-3 text-xs text-muted-foreground">
            <Smartphone class="mt-0.5 size-3.5 shrink-0" />
            <span v-if="pushStore.isIOS">
              En iPhone o iPad, las notificaciones solo funcionan si instalás TipApp en la pantalla de inicio (Compartir → Agregar a pantalla de inicio).
            </span>
            <span v-else>
              Tu navegador no admite notificaciones. Probá desde Chrome o Safari actualizados.
            </span>
          </p>
        </Card>

        <!-- Grupos (sección 3.4) -->
        <template v-for="group in [
          { key: 'live', label: 'En vivo y por empezar', items: liveGroup },
          { key: 'paused', label: 'Pausados', items: pausedGroup },
          { key: 'finished', label: 'Finalizados', items: finishedGroup },
        ]" :key="group.key">
          <template v-if="group.items.length > 0">
            <p class="px-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {{ group.label }}
            </p>

            <Card v-for="match in group.items" :key="match.id" class="overflow-hidden">
              <!-- Fila superior: competición + menú de acciones -->
              <div class="flex items-center justify-between gap-2 px-4 pt-3">
                <p class="truncate text-xs font-medium text-muted-foreground">
                  {{ match.competition ?? 'Partido' }}
                </p>
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button variant="ghost" size="icon" aria-label="Más opciones" class="-mr-2 size-9">
                      <EllipsisVertical class="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem @select="toggleMonitoring(match)">
                      <component :is="match.state === 'paused' ? Play : Pause" class="size-4" />
                      {{ match.state === 'paused' ? 'Reanudar' : 'Pausar' }}
                    </DropdownMenuItem>
                    <AlertDialog>
                      <AlertDialogTrigger as-child>
                        <DropdownMenuItem variant="destructive" @select="(e: Event) => e.preventDefault()">
                          <Trash2 class="size-4" />
                          Quitar partido
                        </DropdownMenuItem>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>¿Quitar "{{ match.home_team }} vs. {{ match.away_team }}"?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Dejamos de monitorear este partido. Si tenía un cupón asociado, también se quita. Esta acción no se puede deshacer.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction @click="removeMatch(match)">
                            Quitar
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <!-- Región clickeable: navega al detalle -->
              <button
                type="button"
                class="flex w-full flex-col gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                @click="openMatch(match)"
              >
                <div class="flex items-center justify-between gap-3">
                  <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p class="truncate text-sm font-medium">
                      {{ match.home_team ?? 'Local' }}
                    </p>
                    <p class="truncate text-sm font-medium">
                      {{ match.away_team ?? 'Visitante' }}
                    </p>
                  </div>

                  <template v-if="isAwaitingData(match)">
                    <span class="text-xs text-muted-foreground">Buscando datos…</span>
                  </template>
                  <template v-else>
                    <div class="flex flex-col items-end gap-0.5 tabular-nums">
                      <p class="text-lg font-bold">
                        {{ scoreText(match.score_home) }}
                      </p>
                      <p class="text-lg font-bold">
                        {{ scoreText(match.score_away) }}
                      </p>
                    </div>
                    <div class="flex w-20 shrink-0 flex-col items-end gap-1">
                      <span v-if="isLive(match)" class="flex items-center gap-1 text-sm font-semibold text-primary">
                        <Radio class="size-3 animate-pulse" aria-hidden="true" />
                        {{ clockLabel(match) }}
                      </span>
                      <Badge v-else variant="secondary" class="text-[10px]">
                        {{ clockLabel(match) }}
                      </Badge>
                    </div>
                  </template>
                </div>

                <template v-if="!isAwaitingData(match)">
                  <MatchStatsRow :match="match" />
                  <MatchLegsSummary v-if="match.bet_slip_legs.length > 0" :legs="match.bet_slip_legs" />
                </template>
              </button>

              <!-- Pie: estado de actualización (sección 1.5) -->
              <div class="flex items-center justify-between gap-2 border-t border-border px-4 py-2">
                <p class="text-xs text-muted-foreground">
                  Actualizado {{ relativeTime(match.last_polled_at) }}
                </p>
                <Badge :variant="stateDisplay(match.state).badgeVariant" class="text-[10px]">
                  {{ stateDisplay(match.state).label }}
                </Badge>
              </div>
              <p v-if="!match.last_poll_ok" class="flex items-center gap-1.5 border-t border-border px-4 py-2 text-xs text-warning">
                <TriangleAlert class="size-3.5 shrink-0" />
                No pudimos actualizar este partido. Seguimos intentando.
              </p>
            </Card>
          </template>
        </template>
      </template>
    </main>

    <!-- FAB (sección 3.6) -->
    <button
      v-if="!isInitialLoading && !loadError && liveMatchesStore.hasMatches"
      type="button"
      aria-label="Agregar partido"
      class="fixed bottom-6 right-4 z-10 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[var(--shadow-elevated)] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:right-6 lg:right-8"
      style="margin-bottom: env(safe-area-inset-bottom)"
      @click="openAddSheet"
    >
      <Plus class="size-6" />
    </button>

    <MatchFormSheet v-model:open="isSheetOpen" />
  </div>
</template>
