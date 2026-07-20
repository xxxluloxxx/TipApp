<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertCircle,
  BellRing,
  CircleCheck,
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
import { useBetSlipsStore, type Coupon } from '@/stores/betSlips'
import { usePushNotificationsStore } from '@/stores/pushNotifications'
import { isLiveStage, matchClockLabel } from '@/lib/matchClock'
import { relativeTimeShort } from '@/lib/relativeTime'
import { stateDisplay } from '@/lib/matchDisplay'
import MatchStatsRow from '@/components/MatchStatsRow.vue'
import MatchFormSheet from '@/components/MatchFormSheet.vue'
import CouponCard from '@/components/CouponCard.vue'
import AppHeader from '@/components/AppHeader.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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

// Dashboard rediseñado (live-coupons-ux.md §5–§7): dashboard de cupones (con
// `Tabs` Todos/En vivo/Finalizados sobre ítems de primer nivel) + sección de
// partidos sueltos. Los estados de cupón/partido-en-cupón llegan resueltos
// server-side (§1). "Partidos sueltos" = `live_matches` que ningún cupón
// referencia (diferencia de conjuntos sobre IDs ya en memoria, §3.4).

const router = useRouter()
const liveMatchesStore = useLiveMatchesStore()
const betSlipsStore = useBetSlipsStore()
const pushStore = usePushNotificationsStore()

const isInitialLoading = ref(true)
const loadError = ref(false)
const isSheetOpen = ref(false)

// Ticker de 1s (§1.4/1.5 original): mueve el minuto en vivo sin tocar la red.
const now = ref(Date.now())
let tickerId: ReturnType<typeof setInterval> | null = null

const TABS = [
  { value: 'all', label: 'Todos' },
  { value: 'live', label: 'En vivo' },
  { value: 'finished', label: 'Finalizados' },
] as const
type TabValue = typeof TABS[number]['value']
const activeTab = ref<TabValue>('all')

async function loadAll() {
  loadError.value = false
  isInitialLoading.value = true
  try {
    const [matchesOk, couponsOk] = await Promise.all([
      liveMatchesStore.fetchAll(),
      betSlipsStore.fetchAll(),
    ])
    if (!matchesOk || !couponsOk) loadError.value = true
  } finally {
    isInitialLoading.value = false
  }
}

// §1.3: red de seguridad al volver a foreground — un refetch completo por si el
// socket de Realtime se cayó en segundo plano.
function onVisibilityChange() {
  if (document.visibilityState === 'visible') {
    void liveMatchesStore.fetchAll()
    void betSlipsStore.fetchAll()
    void pushStore.refresh()
  }
}

onMounted(async () => {
  await loadAll()
  liveMatchesStore.subscribeRealtime()
  betSlipsStore.subscribeRealtime()
  void pushStore.refresh()
  tickerId = setInterval(() => {
    now.value = Date.now()
  }, 1000)
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onBeforeUnmount(() => {
  liveMatchesStore.unsubscribeRealtime()
  betSlipsStore.unsubscribeRealtime()
  if (tickerId !== null) clearInterval(tickerId)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})

// --- Partidos sueltos (diferencia de conjuntos, §3.4/§7.4) ----------------

const looseMatches = computed(() =>
  liveMatchesStore.matches.filter(m => !betSlipsStore.linkedLiveMatchIds.has(m.id)),
)

const hasAnyItem = computed(() => betSlipsStore.hasCoupons || looseMatches.value.length > 0)

// --- Bucketización de tabs (§3.4) -----------------------------------------

type Bucket = 'live' | 'finished' | 'other'

function couponBucket(coupon: Coupon): Bucket {
  if (coupon.status === 'won' || coupon.status === 'lost') return 'finished'
  if (coupon.status === 'in_progress' && coupon.liveMatchesCount > 0) return 'live'
  return 'other'
}
function looseBucket(m: LiveMatch): Bucket {
  if (m.stage_code === 3) return 'finished'
  if (m.stage_code === 12 || m.stage_code === 13 || m.stage_code === 38) return 'live'
  return 'other'
}

// Orden de sección: primero lo que está en vivo ahora, luego el resto, luego
// finalizados al fondo (§3.4).
const BUCKET_ORDER: Record<Bucket, number> = { live: 0, other: 1, finished: 2 }

function couponsForTab(tab: TabValue): Coupon[] {
  return [...betSlipsStore.coupons]
    .filter(c => tab === 'all' || couponBucket(c) === tab)
    .sort((a, b) => BUCKET_ORDER[couponBucket(a)] - BUCKET_ORDER[couponBucket(b)])
}

function sortLoose(list: LiveMatch[]): LiveMatch[] {
  return [...list].sort((a, b) => {
    const orderDiff = BUCKET_ORDER[looseBucket(a)] - BUCKET_ORDER[looseBucket(b)]
    if (orderDiff !== 0) return orderDiff
    if (looseBucket(a) === 'live') return b.last_changed_at.localeCompare(a.last_changed_at)
    if (looseBucket(a) === 'other') return (a.scheduled_kickoff_ts ?? '').localeCompare(b.scheduled_kickoff_ts ?? '')
    return b.last_changed_at.localeCompare(a.last_changed_at)
  })
}

function looseForTab(tab: TabValue): LiveMatch[] {
  return sortLoose(looseMatches.value.filter(m => tab === 'all' || looseBucket(m) === tab))
}

function tabIsEmpty(tab: TabValue): boolean {
  return couponsForTab(tab).length === 0 && looseForTab(tab).length === 0
}

// Contador del trigger "En vivo" (§5.2, opcional): ítems de primer nivel en vivo.
const liveItemCount = computed(() => couponsForTab('live').length + looseForTab('live').length)

// --- Card de partido suelto (helpers, §7.4 reusa la card original) --------

function isLive(match: LiveMatch): boolean {
  return isLiveStage(match.stage_code)
}
function clockLabel(match: LiveMatch): string {
  return matchClockLabel(match.stage_code, match.stage_anchor_ts, match.scheduled_kickoff_ts, now.value)
}
function relativeTime(iso: string | null): string {
  return relativeTimeShort(iso, now.value)
}
function isAwaitingData(match: LiveMatch): boolean {
  return match.last_polled_at === null
}
function scoreText(value: number | null): string {
  return value === null ? '-' : String(value)
}

// --- Banner de notificaciones (§6.1 / 6.4 original) -----------------------

const hasMonitoring = computed(() => liveMatchesStore.matches.some(m => m.state === 'monitoring'))

const showPermissionBanner = computed(() =>
  pushStore.supported
  && pushStore.permission === 'default'
  && !pushStore.bannerDismissed
  && hasMonitoring.value,
)

const showUnsupportedNote = computed(() => !pushStore.supported && hasAnyItem.value)

async function requestNotificationPermission() {
  const result = await pushStore.enable()
  if (result.ok) {
    toast.success('Notificaciones activadas')
  } else if (result.reason === 'error' || result.reason === 'no_key') {
    toast.error('No pudimos activar las notificaciones. Intentá de nuevo.')
  }
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
function removeCoupon(id: string) {
  betSlipsStore.removeCoupon(id)
}
function openAddSheet() {
  isSheetOpen.value = true
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <AppHeader title="Partidos en vivo" />

    <main class="mx-auto flex max-w-md flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <!-- Carga (§5.4) -->
      <template v-if="isInitialLoading">
        <Card v-for="i in 2" :key="i" class="overflow-hidden">
          <div class="flex flex-col gap-3 p-4">
            <Skeleton class="h-3 w-24" />
            <div class="flex items-center gap-4">
              <Skeleton class="size-24 shrink-0 rounded-full" />
              <div class="flex flex-1 flex-col gap-2">
                <Skeleton class="h-4 w-full" />
                <Skeleton class="h-4 w-3/4" />
                <Skeleton class="h-4 w-1/2" />
              </div>
            </div>
            <Skeleton class="h-10 w-full" />
          </div>
        </Card>
      </template>

      <!-- Error de carga (§5.4) -->
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

      <!-- Vacío (§5.4) -->
      <template v-else-if="!hasAnyItem">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <Goal class="size-12 text-muted-foreground" />
          <h2 class="text-lg font-semibold">
            Todavía no seguís ningún partido ni cupón.
          </h2>
          <p class="max-w-xs text-center text-sm text-muted-foreground">
            Buscá un partido para verlo en vivo, o subí la foto de tu cupón para seguir todas sus selecciones.
          </p>
          <Button @click="openAddSheet">
            Agregar
          </Button>
        </div>
      </template>

      <template v-else>
        <!-- Banner de notificaciones (§6.1) -->
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

        <!-- Nota de limitación iOS / navegador sin soporte (§6.4) -->
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

        <!-- Tabs de ítems de primer nivel (§5.2) -->
        <Tabs v-model="activeTab" class="w-full">
          <TabsList class="grid w-full grid-cols-3">
            <TabsTrigger value="all">
              Todos
            </TabsTrigger>
            <TabsTrigger value="live">
              En vivo<span v-if="liveItemCount > 0" class="ml-1.5 rounded-full bg-warning/20 px-1.5 text-[10px] font-semibold text-warning tabular-nums">{{ liveItemCount }}</span>
            </TabsTrigger>
            <TabsTrigger value="finished">
              Finalizados
            </TabsTrigger>
          </TabsList>

          <TabsContent v-for="t in TABS" :key="t.value" :value="t.value" class="mt-4 flex flex-col gap-4 focus-visible:outline-none">
            <!-- Estado vacío por tab (§5.2) -->
            <div v-if="tabIsEmpty(t.value)" class="flex flex-col items-center gap-2 py-12 text-center">
              <component :is="t.value === 'finished' ? CircleCheck : Radio" class="size-8 text-muted-foreground" />
              <p class="text-sm text-muted-foreground">
                {{ t.value === 'finished' ? 'Todavía no terminó ningún cupón ni partido.' : 'No hay nada en vivo ahora.' }}
              </p>
            </div>

            <template v-else>
              <!-- Cupones -->
              <CouponCard
                v-for="coupon in couponsForTab(t.value)"
                :key="coupon.id"
                :coupon="coupon"
                :now="now"
                @remove="removeCoupon"
              />

              <!-- Sección de partidos sueltos (§7.4), solo si hay al menos uno -->
              <template v-if="looseForTab(t.value).length > 0">
                <p class="px-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Partidos sueltos
                </p>

                <Card v-for="match in looseForTab(t.value)" :key="match.id" class="overflow-hidden">
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
                                Dejamos de monitorear este partido. Esta acción no se puede deshacer.
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

                    <MatchStatsRow v-if="!isAwaitingData(match)" :match="match" />
                  </button>

                  <!-- Pie: estado de actualización (§1.5) -->
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
          </TabsContent>
        </Tabs>
      </template>
    </main>

    <!-- FAB (§5.3) -->
    <button
      v-if="!isInitialLoading && !loadError && hasAnyItem"
      type="button"
      aria-label="Agregar partido o cupón"
      class="fixed bottom-6 right-4 z-10 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[var(--shadow-elevated)] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:right-6 lg:right-8"
      style="margin-bottom: env(safe-area-inset-bottom)"
      @click="openAddSheet"
    >
      <Plus class="size-6" />
    </button>

    <MatchFormSheet v-model:open="isSheetOpen" />
  </div>
</template>
