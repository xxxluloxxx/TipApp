<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertCircle,
  ArrowLeft,
  ExternalLink,
  Flag,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Sparkles,
  Target,
  TriangleAlert,
  Trash2,
  type LucideIcon,
} from '@lucide/vue'
import { useLiveMatchesStore, type LiveMatch } from '@/stores/liveMatches'
import { isLiveStage, matchClockLabel } from '@/lib/matchClock'
import { relativeTimeShort } from '@/lib/relativeTime'
import {
  incidentDisplay,
  incidentLabel,
  legStatusDisplay,
  stateDisplay,
  type MatchIncident,
} from '@/lib/matchDisplay'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
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

// Detalle de un partido (live-matches-ux.md sección 4): hero + stats
// completas + timeline de incidencias + legs completos. Todo es presentación
// pura sobre el snapshot server-side (sección 1.2) — nada se deriva acá.

const route = useRoute()
const router = useRouter()
const liveMatchesStore = useLiveMatchesStore()

const matchId = computed(() => route.params.id as string)

const isInitialLoading = ref(true)
const loadError = ref(false)

const now = ref(Date.now())
let tickerId: ReturnType<typeof setInterval> | null = null

const match = computed<LiveMatch | undefined>(() => liveMatchesStore.matchById(matchId.value))

async function loadMatch() {
  loadError.value = false
  isInitialLoading.value = true
  try {
    const found = await liveMatchesStore.fetchOne(matchId.value)
    if (!found) loadError.value = true
  } finally {
    isInitialLoading.value = false
  }
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') {
    void liveMatchesStore.fetchOne(matchId.value)
  }
}

onMounted(async () => {
  await loadMatch()
  liveMatchesStore.subscribeRealtime()
  tickerId = setInterval(() => {
    now.value = Date.now()
  }, 1000)
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onBeforeUnmount(() => {
  if (tickerId !== null) clearInterval(tickerId)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})

function isLive(m: LiveMatch): boolean {
  return isLiveStage(m.stage_code)
}
function clockLabel(m: LiveMatch): string {
  return matchClockLabel(m.stage_code, m.stage_anchor_ts, m.scheduled_kickoff_ts, now.value)
}
function relativeTime(iso: string | null): string {
  return relativeTimeShort(iso, now.value)
}
function scoreText(value: number | null): string {
  return value === null ? '-' : String(value)
}

interface StatRow {
  key: string
  label: string
  icon?: LucideIcon
  squareClass?: string
  home: number
  away: number
}

// Sección 4.2: layout "número — ícono+label — número". Las tarjetas
// amarilla/roja se dibujan con un cuadradito de color (mismo criterio literal
// que la card, sección 3.5), el resto con su ícono.
const statsRows = computed<StatRow[]>(() => {
  const m = match.value
  if (!m) return []
  return [
    { key: 'corners', label: 'Córners', icon: Flag, home: m.corners_home ?? 0, away: m.corners_away ?? 0 },
    { key: 'shots', label: 'Remates a puerta', icon: Target, home: m.shots_on_target_home ?? 0, away: m.shots_on_target_away ?? 0 },
    { key: 'chances', label: 'Ocasiones claras', icon: Sparkles, home: m.clear_chances_home ?? 0, away: m.clear_chances_away ?? 0 },
    { key: 'yellow', label: 'Tarjetas amarillas', squareClass: 'bg-warning', home: m.yellow_cards_home ?? 0, away: m.yellow_cards_away ?? 0 },
    { key: 'red', label: 'Tarjetas rojas', squareClass: 'bg-destructive', home: m.red_cards_home ?? 0, away: m.red_cards_away ?? 0 },
  ]
})

// Sección 4.3/1.6: incidencias ya completas desde el servidor (jsonb),
// mostradas en orden cronológico tal como llegan.
const incidents = computed<MatchIncident[]>(() => {
  const raw = match.value?.incidents
  return Array.isArray(raw) ? (raw as unknown as MatchIncident[]) : []
})

function toggleMonitoring() {
  if (match.value) liveMatchesStore.toggleMonitoring(match.value.id)
}
function removeMatch() {
  if (!match.value) return
  liveMatchesStore.removeMatch(match.value.id)
  router.push({ name: 'matches' })
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <header class="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-6 sm:py-4 lg:px-8">
      <Button variant="ghost" size="icon" aria-label="Volver" @click="router.push({ name: 'matches' })">
        <ArrowLeft class="size-5" />
      </Button>
      <span class="flex-1" />
      <a
        v-if="match"
        :href="match.flashscore_url"
        target="_blank"
        rel="noopener noreferrer"
        class="flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        Ver en Flashscore
        <ExternalLink class="size-4" />
      </a>
    </header>

    <main class="mx-auto flex max-w-md flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <!-- Carga (sección 4.5) -->
      <template v-if="isInitialLoading">
        <Card>
          <div class="flex flex-col gap-4 p-6">
            <Skeleton class="h-3 w-24" />
            <div class="flex items-center justify-between gap-3">
              <div class="flex flex-1 flex-col gap-2">
                <Skeleton class="h-5 w-40" />
                <Skeleton class="h-5 w-32" />
              </div>
              <Skeleton class="h-14 w-10" />
            </div>
          </div>
        </Card>
        <Card>
          <div class="flex flex-col gap-3 p-6">
            <Skeleton v-for="i in 5" :key="i" class="h-4 w-full" />
          </div>
        </Card>
      </template>

      <!-- Error / no encontrado (sección 4.5) -->
      <template v-else-if="loadError || !match">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <AlertCircle class="size-12 text-destructive" />
          <h2 class="text-lg font-semibold">
            No pudimos cargar este partido
          </h2>
          <p class="text-sm text-muted-foreground">
            Revisá tu conexión e intentá de nuevo.
          </p>
          <div class="flex gap-2">
            <Button variant="outline" @click="loadMatch">
              <RotateCcw class="size-4" />
              Reintentar
            </Button>
            <Button variant="ghost" @click="router.push({ name: 'matches' })">
              Volver
            </Button>
          </div>
        </div>
      </template>

      <template v-else>
        <!-- Hero (sección 4.1) -->
        <Card>
          <CardHeader class="gap-3">
            <p class="text-xs font-medium text-muted-foreground">
              {{ match.competition ?? 'Partido' }}
            </p>
            <div class="flex items-center justify-between gap-3">
              <div class="flex flex-1 flex-col gap-1">
                <p class="text-base font-semibold">
                  {{ match.home_team ?? 'Local' }}
                </p>
                <p class="text-base font-semibold">
                  {{ match.away_team ?? 'Visitante' }}
                </p>
              </div>
              <div class="flex flex-col items-end gap-1 tabular-nums">
                <p class="text-3xl font-bold">
                  {{ scoreText(match.score_home) }}
                </p>
                <p class="text-3xl font-bold">
                  {{ scoreText(match.score_away) }}
                </p>
              </div>
            </div>
            <div class="flex items-center justify-between">
              <span v-if="isLive(match)" class="flex items-center gap-1.5 text-base font-semibold text-primary">
                <Radio class="size-4 animate-pulse" aria-hidden="true" />
                {{ clockLabel(match) }}
              </span>
              <Badge v-else variant="secondary">
                {{ clockLabel(match) }}
              </Badge>
              <Badge :variant="stateDisplay(match.state).badgeVariant">
                {{ stateDisplay(match.state).label }}
              </Badge>
            </div>
          </CardHeader>

          <div class="flex gap-2 border-t border-border px-6 py-4">
            <Button variant="outline" class="flex-1" @click="toggleMonitoring">
              <component :is="match.state === 'paused' ? Play : Pause" class="size-4" />
              {{ match.state === 'paused' ? 'Reanudar' : 'Pausar' }}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger as-child>
                <Button variant="outline" class="flex-1 text-destructive hover:text-destructive">
                  <Trash2 class="size-4" />
                  Quitar
                </Button>
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
                  <AlertDialogAction @click="removeMatch">
                    Quitar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          <p v-if="!match.last_poll_ok" class="flex items-center gap-1.5 border-t border-border px-6 py-3 text-sm text-warning">
            <TriangleAlert class="size-4 shrink-0" />
            No pudimos actualizar este partido. Seguimos intentando.
          </p>
          <p class="border-t border-border px-6 py-2 text-xs text-muted-foreground">
            Actualizado {{ relativeTime(match.last_polled_at) }}
          </p>
        </Card>

        <!-- Stats completas (sección 4.2) -->
        <Card>
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Estadísticas
            </CardTitle>
          </CardHeader>
          <div class="flex flex-col gap-3 px-6 pb-6">
            <div v-for="stat in statsRows" :key="stat.key" class="flex items-center gap-3 text-sm">
              <span class="w-8 text-right font-semibold tabular-nums">{{ stat.home }}</span>
              <div class="flex flex-1 items-center justify-center gap-1.5 text-muted-foreground">
                <component :is="stat.icon" v-if="stat.icon" class="size-4" aria-hidden="true" />
                <span v-else class="h-3.5 w-2.5 rounded-[2px]" :class="stat.squareClass" aria-hidden="true" />
                <span class="text-xs">{{ stat.label }}</span>
              </div>
              <span class="w-8 font-semibold tabular-nums">{{ stat.away }}</span>
            </div>
          </div>
        </Card>

        <!-- Timeline de incidencias (sección 4.3) -->
        <Card v-if="incidents.length > 0">
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Incidencias
            </CardTitle>
          </CardHeader>
          <div class="flex flex-col">
            <template v-for="(incident, idx) in incidents" :key="idx">
              <Separator v-if="idx > 0" />
              <div class="flex items-center gap-3 px-4 py-3">
                <span class="w-10 shrink-0 text-right text-sm font-semibold tabular-nums text-muted-foreground">
                  {{ incident.minuteLabel ?? '' }}
                </span>
                <component
                  :is="incidentDisplay(incident.type).icon"
                  v-if="incidentDisplay(incident.type).icon"
                  class="size-4 shrink-0"
                  :class="incidentDisplay(incident.type).iconClass"
                  aria-hidden="true"
                />
                <span
                  v-else
                  class="h-4 w-3 shrink-0 rounded-[2px]"
                  :class="incidentDisplay(incident.type).squareClass"
                  aria-hidden="true"
                />
                <div class="flex min-w-0 flex-1 flex-col">
                  <p class="truncate text-sm font-medium">
                    {{ incidentLabel(incident) }}
                  </p>
                  <p v-if="incident.player" class="truncate text-xs text-muted-foreground">
                    {{ incident.player }} · {{ incident.team === 'home' ? match.home_team : match.away_team }}
                  </p>
                </div>
              </div>
            </template>
          </div>
        </Card>

        <!-- Legs del cupón (sección 4.4) -->
        <Card v-if="match.bet_slip_legs.length > 0">
          <CardHeader>
            <CardTitle class="text-base font-semibold">
              Tu cupón
            </CardTitle>
          </CardHeader>
          <div class="flex flex-col">
            <template v-for="(leg, idx) in match.bet_slip_legs" :key="leg.id">
              <Separator v-if="idx > 0" />
              <div class="flex items-start gap-3 px-4 py-3">
                <component
                  :is="legStatusDisplay(leg.status).icon"
                  class="size-5 shrink-0"
                  :class="legStatusDisplay(leg.status).iconClass"
                  aria-hidden="true"
                />
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p class="text-sm font-medium">
                    {{ leg.selection_label }}
                  </p>
                  <p class="text-xs text-muted-foreground">
                    {{ leg.market_label }}
                  </p>
                </div>
                <Badge
                  :variant="legStatusDisplay(leg.status).badgeVariant"
                  :class="legStatusDisplay(leg.status).badgeClass"
                  class="shrink-0 text-[10px]"
                >
                  {{ legStatusDisplay(leg.status).label }}
                </Badge>
              </div>
            </template>
          </div>
        </Card>
      </template>
    </main>
  </div>
</template>
