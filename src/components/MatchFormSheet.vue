<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import {
  CalendarX,
  Camera,
  CircleCheck,
  CircleX,
  Loader2,
  Radio,
  Search,
  SearchX,
  TriangleAlert,
} from '@lucide/vue'
import { createWorker, type Worker } from 'tesseract.js'
import { toast } from 'vue-sonner'
import { useLiveMatchesStore, type SearchMatch } from '@/stores/liveMatches'
import { useBetSlipsStore, type CreateBetSlipGroup } from '@/stores/betSlips'
import { betSlipFromOcrBlocks, type RecognizedBlock } from '@/lib/betSlipOcr'
import { formatKickoffTime } from '@/lib/matchClock'
import { formatOdds } from '@/lib/currency'
import { translateCountryEsToEn } from '@/lib/countryNames'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

// Alta de partido/cupón — wizard de dos caminos (live-coupons-ux.md §9).
// `step: 'entry' | 'processing' | 'review'`, `mode: 'search' | 'photo'`.
//
// Camino A ("Buscar un partido", default): reusa el buscador contra
// `search-matches` (debounce 350ms, selector de día) → crea un PARTIDO SUELTO
// (sin legs, sin cupón).
//
// Camino B ("Subir foto del cupón"): OCR client-side (Tesseract.js) → detecta N
// grupos (partidos) → resuelve cada uno contra `search-matches` → review
// multi-grupo → crea un CUPÓN multi-partido vía la Edge Function
// `create-bet-slip` (atómica, NO optimista). El buscador se reusa por dentro
// del review para resolver a mano un grupo que no vinculó.

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const liveMatchesStore = useLiveMatchesStore()
const betSlipsStore = useBetSlipsStore()

type Step = 'entry' | 'processing' | 'review'
type Mode = 'search' | 'photo'

interface ReviewPrediction {
  tempId: string
  marketType: string
  marketLabel: string
  selectionLabel: string
  threshold: number | null
  selector: string | null
  odds: number | null
  rawText: string | null
}
interface ReviewGroup {
  tempId: string
  teams: [string, string] | null
  resolved: SearchMatch | null
  predictions: ReviewPrediction[]
}

const step = ref<Step>('entry')
const mode = ref<Mode>('search')
const isSubmitting = ref(false)

const form = reactive({
  // Camino A
  selectedMatch: null as SearchMatch | null,
  // Camino B (review)
  detectedGroups: [] as ReviewGroup[],
  reference: null as string | null,
  stakeAmount: '',
  // Cuando el usuario resuelve a mano un grupo, se reusa el buscador acotado.
  resolvingGroupId: null as string | null,
})

const fileInputRef = ref<HTMLInputElement | null>(null)

// --- Buscador de partidos (§9.2, reusado en camino A y en el resolver) -------

const dayOptions = [
  { value: 0, label: 'Hoy' },
  { value: 1, label: 'Mañana' },
  { value: 2, label: 'Pasado mañana' },
  { value: 3, label: 'En 3 días' },
]
const DAY_LABELS_LOWERCASE = ['hoy', 'mañana', 'pasado mañana', 'en 3 días']
function dayLabelLowercase(offset: number): string {
  return DAY_LABELS_LOWERCASE[offset] ?? ''
}

const searchQuery = ref('')
const dayOffset = ref(0)
const searchResults = ref<SearchMatch[]>([])
const searchState = ref<'loading' | 'ready' | 'error'>('loading')

const hasActiveQuery = computed(() => searchQuery.value.trim().length >= 2)

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
let searchRequestId = 0

async function runSearch() {
  const requestId = ++searchRequestId
  searchState.value = 'loading'

  const result = await liveMatchesStore.searchMatches(dayOffset.value, searchQuery.value)
  if (requestId !== searchRequestId) return

  if ('errorCode' in result) {
    searchResults.value = []
    searchState.value = 'error'
    return
  }

  searchResults.value = result.matches
  searchState.value = 'ready'
}

watch(searchQuery, () => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  searchDebounceTimer = setTimeout(() => {
    void runSearch()
  }, 350)
})

function selectDay(value: number) {
  if (dayOffset.value === value) return
  dayOffset.value = value
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  void runSearch()
}

function retrySearch() {
  void runSearch()
}

/** ¿Se muestra el buscador? Camino A (entry sin partido elegido) o el resolver
 * de un grupo dentro del review. */
const searchVisible = computed(() =>
  (step.value === 'entry' && mode.value === 'search' && !form.selectedMatch)
  || (step.value === 'review' && form.resolvingGroupId !== null),
)
const searchContext = computed<'entry' | 'resolver'>(() =>
  form.resolvingGroupId !== null ? 'resolver' : 'entry',
)

/** Partido ya seguido (§5.1.3): solo deshabilita en el camino A (en el resolver
 * de cupón se permite igual — un cupón puede incluir un partido ya seguido, el
 * backend hace find-or-create). */
function isAlreadyFollowed(result: SearchMatch): boolean {
  return liveMatchesStore.matches.some(match => match.flashscore_mid === result.matchId)
}
function isResultDisabled(result: SearchMatch): boolean {
  return searchContext.value === 'entry' && isAlreadyFollowed(result)
}

function onPickResult(result: SearchMatch) {
  if (searchContext.value === 'resolver') {
    const groupId = form.resolvingGroupId
    if (!groupId) return
    const group = form.detectedGroups.find(g => g.tempId === groupId)
    if (group) group.resolved = result
    form.resolvingGroupId = null
    return
  }
  if (isAlreadyFollowed(result)) return
  form.selectedMatch = result
}

function changeMatch() {
  form.selectedMatch = null
}

// --- Camino B: foto → OCR → resolución de grupos -----------------------------

let ocrWorker: Worker | null = null

async function terminateOcrWorker() {
  if (!ocrWorker) return
  const worker = ocrWorker
  ocrWorker = null
  try {
    await worker.terminate()
  } catch {
    // El worker ya podría estar terminado; nada útil que hacer acá.
  }
}

function startPhotoFlow() {
  fileInputRef.value?.click()
}

const firstToken = (s: string) => s.toLowerCase().split(/\s+/).find(t => t.length >= 3) ?? s.toLowerCase()

/** ¿"Suenan" al mismo equipo? Sustring en cualquier dirección, o — si eso
 * falla — mismo prefijo de 5+ caracteres. El prefijo cubre errores de OCR en
 * la cola del nombre (ej. Tesseract leyó "Argentine" en vez de "Argentina"
 * en una foto real de esta sesión: ninguna de las dos es substring de la
 * otra, pero comparten "argent"). 5 caracteres es lo bastante largo para que
 * dos selecciones/equipos distintos no coincidan por casualidad. */
function namesLikelyMatch(a: string, b: string): boolean {
  if (a.includes(b) || b.includes(a)) return true
  const n = Math.min(a.length, b.length, 6)
  return n >= 5 && a.slice(0, n) === b.slice(0, n)
}

/** Un intento de resolución: busca por el equipo local y toma un resultado que
 * comparta un token con ambos equipos del grupo. */
async function tryResolveTeams(teams: [string, string]): Promise<SearchMatch | null> {
  const query = teams[0].trim()
  if (query.length < 2) return null

  const result = await liveMatchesStore.searchMatches(0, query)
  if ('errorCode' in result) return null

  const home = firstToken(teams[0])
  const away = firstToken(teams[1])
  return (
    result.matches.find((m) => namesLikelyMatch(home, firstToken(m.homeTeam)) && namesLikelyMatch(away, firstToken(m.awayTeam))) ?? null
  )
}

/** Resolución best-effort de un grupo detectado contra `search-matches` (día 0,
 * §9.4). El feed de Flashscore siempre devuelve nombres de país/selección en
 * inglés ("England", "Germany"...) — el OCR (modelo `spa`) los lee en español
 * ("Inglaterra", "Alemania"...), así que un partido de selecciones nunca
 * matchea con el nombre tal cual. Se intenta primero con los nombres del OCR
 * (funciona para nombres de club, que no se traducen) y, si no encuentra nada,
 * se reintenta traduciendo países conocidos (`countryNames.ts`) al inglés —
 * ver esa nota de cabecera para el detalle de por qué no alcanza con pedirle
 * el feed en otro idioma. Si ninguno de los dos intentos resuelve (partido de
 * otro día, país no cubierto por el diccionario, o el OCR erró los nombres),
 * no resuelve — el usuario lo vincula a mano con "Buscar este partido". */
async function autoResolveGroup(teams: [string, string] | null): Promise<SearchMatch | null> {
  if (!teams) return null

  const direct = await tryResolveTeams(teams)
  if (direct) return direct

  const translated: [string, string] = [translateCountryEsToEn(teams[0]), translateCountryEsToEn(teams[1])]
  if (translated[0] === teams[0] && translated[1] === teams[1]) return null // nada para traducir, no reintentar en vano
  return tryResolveTeams(translated)
}

async function onFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // Permite volver a elegir el mismo archivo si el usuario reintenta.
  input.value = ''
  if (!file) return

  mode.value = 'photo'
  step.value = 'processing'
  try {
    // OCR client-side con Tesseract.js (§9.4). El cupón está en español → `spa`.
    ocrWorker = await createWorker('spa')
    const { data } = await ocrWorker.recognize(file)
    const result = betSlipFromOcrBlocks(data.blocks as RecognizedBlock[] | null)

    // Resolución de cada grupo contra el buscador (en paralelo).
    const resolvedList = await Promise.all(result.groups.map(g => autoResolveGroup(g.teams)))

    form.reference = result.reference
    form.stakeAmount = result.stakeAmount != null ? String(result.stakeAmount) : ''
    form.detectedGroups = result.groups.map((group, idx) => ({
      tempId: group.tempId,
      teams: group.teams,
      resolved: resolvedList[idx] ?? null,
      predictions: group.predictions.map(p => ({ ...p })),
    }))

    step.value = 'review'
  } catch (ocrError) {
    console.error('OCR del cupón (Tesseract.js) falló', ocrError)
    mode.value = 'search'
    step.value = 'entry'
    toast.error('No pudimos leer la foto. Probá de nuevo o buscá los partidos a mano.')
  } finally {
    await terminateOcrWorker()
  }
}

function discardGroup(tempId: string) {
  form.detectedGroups = form.detectedGroups.filter(g => g.tempId !== tempId)
}
function discardPrediction(groupId: string, predId: string) {
  const group = form.detectedGroups.find(g => g.tempId === groupId)
  if (!group) return
  group.predictions = group.predictions.filter(p => p.tempId !== predId)
}

function openResolverFor(groupId: string) {
  const group = form.detectedGroups.find(g => g.tempId === groupId)
  form.resolvingGroupId = groupId
  dayOffset.value = 0
  // Prefill con el equipo local del grupo para acotar la búsqueda.
  searchQuery.value = group?.teams?.[0] ?? ''
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  void runSearch()
}
function cancelResolver() {
  form.resolvingGroupId = null
}

const groupsWithPredictions = computed(() => form.detectedGroups.filter(g => g.predictions.length > 0))
const confirmLabel = computed(() => (groupsWithPredictions.value.length > 0 ? 'Crear cupón' : 'Continuar sin cupón'))

/** Parseo es-AR del monto apostado ("1.500,50" → 1500.5). `null` si vacío/NaN. */
function parseStake(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  let normalized = trimmed.replace(/[$\s]/g, '')
  if (normalized.includes('.') && normalized.includes(',')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.')
  } else {
    normalized = normalized.replace(',', '.')
  }
  const value = Number(normalized)
  return Number.isNaN(value) || value <= 0 ? null : value
}

// --- Confirmaciones ----------------------------------------------------------

async function confirmLooseMatch() {
  if (isSubmitting.value) return
  const selected = form.selectedMatch
  if (!selected) return

  isSubmitting.value = true
  try {
    const result = await liveMatchesStore.addMatch({
      matchId: selected.matchId,
      homeTeam: selected.homeTeam,
      awayTeam: selected.awayTeam,
      league: selected.league,
    })

    if ('errorCode' in result) {
      if (result.errorCode === 'duplicate_match') {
        form.selectedMatch = null
        toast.error('Ya estás siguiendo este partido.')
        return
      }
      toast.error('No pudimos agregar el partido. Revisá tu conexión e intentá de nuevo.')
      return
    }

    toast.success('¡Listo! Ya estamos siguiendo este partido.')
    emit('update:open', false)
  } finally {
    isSubmitting.value = false
  }
}

async function confirmCoupon() {
  if (isSubmitting.value) return

  const usableGroups = groupsWithPredictions.value
  if (usableGroups.length === 0) {
    // El usuario descartó todo: no hay cupón que crear, solo cerrar (§9.4).
    emit('update:open', false)
    return
  }

  isSubmitting.value = true
  try {
    const groups: CreateBetSlipGroup[] = usableGroups.map(group => ({
      matchId: group.resolved?.matchId,
      homeTeam: group.resolved?.homeTeam ?? group.teams?.[0],
      awayTeam: group.resolved?.awayTeam ?? group.teams?.[1],
      competition: group.resolved?.league ?? undefined,
      legs: group.predictions.map(p => ({
        marketType: p.marketType,
        marketLabel: p.marketLabel,
        selectionLabel: p.selectionLabel,
        threshold: p.threshold,
        selector: p.selector,
        odds: p.odds,
        rawText: p.rawText,
      })),
    }))

    const result = await betSlipsStore.createBetSlip({
      stakeAmount: parseStake(form.stakeAmount),
      reference: form.reference,
      groups,
    })

    if ('errorCode' in result) {
      toast.error('No pudimos crear el cupón. Revisá tu conexión e intentá de nuevo.')
      return
    }

    toast.success('¡Listo! Ya estamos siguiendo tu cupón.')
    emit('update:open', false)
  } finally {
    isSubmitting.value = false
  }
}

// --- Ciclo de vida del Sheet ------------------------------------------------

function resetForm() {
  step.value = 'entry'
  mode.value = 'search'
  isSubmitting.value = false
  searchQuery.value = ''
  dayOffset.value = 0
  searchResults.value = []
  searchState.value = 'loading'
  form.selectedMatch = null
  form.detectedGroups = []
  form.reference = null
  form.stakeAmount = ''
  form.resolvingGroupId = null

  void nextTick(() => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
    void runSearch()
  })
}

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    resetForm()
  } else {
    void terminateOcrWorker()
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  }
})

onBeforeUnmount(() => {
  void terminateOcrWorker()
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
})

function closeSheet() {
  emit('update:open', false)
}
function handleOpenChange(value: boolean) {
  emit('update:open', value)
}

// El Sheet no se cierra por tap-fuera/Escape mientras hay un roundtrip en vuelo.
const isBlocking = () => isSubmitting.value || step.value === 'processing'
function preventCloseWhileBusy(event: Event) {
  if (isBlocking()) event.preventDefault()
}
</script>

<template>
  <Sheet :open="props.open" @update:open="handleOpenChange">
    <SheetContent
      side="bottom"
      :show-close-button="!isBlocking()"
      @escape-key-down="preventCloseWhileBusy"
      @interact-outside="preventCloseWhileBusy"
    >
      <!-- ============ Buscador (camino A entry, o resolver de grupo) ========= -->
      <template v-if="searchVisible">
        <SheetHeader>
          <SheetTitle>{{ searchContext === 'resolver' ? 'Buscá este partido' : 'Nuevo partido o cupón' }}</SheetTitle>
          <SheetDescription>
            <template v-if="searchContext === 'resolver'">
              Elegí el partido real que corresponde a esta selección de tu cupón.
            </template>
            <template v-else>
              Buscá un partido para seguirlo, o subí la foto de tu cupón para seguir todas sus selecciones.
            </template>
          </SheetDescription>
        </SheetHeader>

        <!-- Acceso al camino B, solo en el entry (no en el resolver, §9.2) -->
        <template v-if="searchContext === 'entry'">
          <div class="px-4">
            <Button type="button" variant="outline" class="w-full" @click="startPhotoFlow">
              <Camera class="size-4" />
              Subir foto del cupón
            </Button>
          </div>
          <div class="relative px-4 py-2">
            <Separator />
            <span class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-xs text-muted-foreground">o buscá un partido</span>
          </div>
        </template>

        <div class="flex flex-col gap-3 px-4">
          <div class="relative">
            <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              v-model="searchQuery"
              type="search"
              inputmode="search"
              placeholder="Buscar equipo…"
              class="pl-9 text-base"
              aria-label="Buscar equipo"
            />
          </div>

          <div role="radiogroup" aria-label="Día" class="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1">
            <button
              v-for="option in dayOptions"
              :key="option.value"
              type="button"
              role="radio"
              :aria-checked="dayOffset === option.value"
              class="flex min-h-9 items-center justify-center rounded-md px-1 py-1.5 text-center text-[11px] font-medium leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :class="dayOffset === option.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
              @click="selectDay(option.value)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <div class="mt-1 max-h-[45vh] overflow-y-auto overscroll-contain border-t border-border" aria-live="polite">
          <template v-if="searchState === 'loading'">
            <div
              v-for="n in 4"
              :key="n"
              class="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
            >
              <div class="flex flex-1 flex-col gap-1.5">
                <Skeleton class="h-4 w-36" />
                <Skeleton class="h-4 w-28" />
              </div>
              <Skeleton class="h-5 w-14 rounded-full" />
            </div>
          </template>

          <div v-else-if="searchState === 'error'" class="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <TriangleAlert class="size-8 text-warning" />
            <p class="text-sm text-muted-foreground">
              No pudimos buscar partidos ahora mismo. Probá de nuevo en un momento.
            </p>
            <Button type="button" variant="outline" size="sm" @click="retrySearch">
              Reintentar
            </Button>
          </div>

          <template v-else-if="searchResults.length > 0">
            <button
              v-for="result in searchResults"
              :key="result.matchId"
              type="button"
              class="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50"
              :disabled="isResultDisabled(result)"
              @click="onPickResult(result)"
            >
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <p class="truncate text-sm font-medium">{{ result.homeTeam }}</p>
                <p class="truncate text-sm font-medium">{{ result.awayTeam }}</p>
                <p v-if="result.league" class="truncate text-xs text-muted-foreground">{{ result.league }}</p>
              </div>
              <div class="flex shrink-0 flex-col items-end gap-1">
                <span v-if="result.status === 'live'" class="flex items-center gap-1 text-sm font-semibold text-primary">
                  <Radio class="size-3 animate-pulse" aria-hidden="true" />
                  En vivo
                </span>
                <Badge v-else variant="secondary" class="text-[10px]">{{ formatKickoffTime(result.kickoffAt) }}</Badge>
                <Badge v-if="isResultDisabled(result)" variant="outline" class="text-[10px] text-muted-foreground">
                  Ya lo seguís
                </Badge>
              </div>
            </button>
          </template>

          <div v-else-if="hasActiveQuery" class="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <SearchX class="size-8 text-muted-foreground" />
            <p class="text-sm text-muted-foreground">
              No encontramos partidos para "{{ searchQuery.trim() }}" en {{ dayLabelLowercase(dayOffset) }}.
            </p>
          </div>

          <div v-else class="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <CalendarX class="size-8 text-muted-foreground" />
            <p class="text-sm text-muted-foreground">
              No hay partidos programados para {{ dayLabelLowercase(dayOffset) }}. Probá otro día.
            </p>
          </div>
        </div>

        <SheetFooter>
          <Button v-if="searchContext === 'resolver'" type="button" variant="outline" @click="cancelResolver">
            Volver al cupón
          </Button>
          <Button v-else type="button" variant="outline" @click="closeSheet">
            Cancelar
          </Button>
        </SheetFooter>
      </template>

      <!-- ============ Camino A: partido elegido → confirmar ================= -->
      <template v-else-if="step === 'entry' && form.selectedMatch">
        <SheetHeader>
          <SheetTitle>Nuevo partido</SheetTitle>
          <SheetDescription>
            Vas a empezar a seguir este partido en vivo.
          </SheetDescription>
        </SheetHeader>

        <div class="px-4 pb-2">
          <div class="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <p class="truncate text-sm font-medium">{{ form.selectedMatch.homeTeam }}</p>
              <p class="truncate text-sm font-medium">{{ form.selectedMatch.awayTeam }}</p>
              <p v-if="form.selectedMatch.league" class="truncate text-xs text-muted-foreground">{{ form.selectedMatch.league }}</p>
            </div>
            <span v-if="form.selectedMatch.status === 'live'" class="flex shrink-0 items-center gap-1 text-sm font-semibold text-primary">
              <Radio class="size-3 animate-pulse" aria-hidden="true" />
              En vivo
            </span>
            <Badge v-else variant="secondary" class="shrink-0 text-[10px]">{{ formatKickoffTime(form.selectedMatch.kickoffAt) }}</Badge>
            <Button type="button" variant="ghost" size="sm" class="shrink-0" :disabled="isSubmitting" @click="changeMatch">
              Cambiar
            </Button>
          </div>
        </div>

        <SheetFooter class="flex-row gap-2">
          <Button type="button" variant="outline" class="flex-1" :disabled="isSubmitting" @click="closeSheet">
            Cancelar
          </Button>
          <Button type="button" class="flex-1" :disabled="isSubmitting" @click="confirmLooseMatch">
            <Loader2 v-if="isSubmitting" class="size-4 animate-spin" />
            {{ isSubmitting ? 'Guardando…' : 'Agregar partido' }}
          </Button>
        </SheetFooter>
      </template>

      <!-- ============ Camino B paso 2: leyendo el cupón ==================== -->
      <template v-else-if="step === 'processing'">
        <SheetHeader>
          <SheetTitle>Leyendo el cupón…</SheetTitle>
        </SheetHeader>
        <div class="flex flex-col items-center gap-4 px-4 py-10">
          <Loader2 class="size-10 animate-spin text-primary" />
          <p class="text-center text-sm text-muted-foreground">
            Esto puede tardar unos segundos. No cierres esta ventana.
          </p>
        </div>
      </template>

      <!-- ============ Camino B paso 3: review multi-grupo ================== -->
      <template v-else-if="step === 'review'">
        <SheetHeader>
          <SheetTitle>Revisá tu cupón</SheetTitle>
          <SheetDescription>
            Leímos esto de la foto y puede tener errores. Revisá cada partido y sacá lo que no corresponda.
          </SheetDescription>
        </SheetHeader>

        <div class="flex max-h-[50vh] flex-col gap-3 overflow-y-auto overscroll-contain px-4 pb-2">
          <div
            v-for="group in form.detectedGroups"
            :key="group.tempId"
            class="flex flex-col gap-2 rounded-lg border border-border p-3"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <template v-if="group.resolved">
                  <p class="truncate text-sm font-medium">{{ group.resolved.homeTeam }}</p>
                  <p class="truncate text-sm font-medium">{{ group.resolved.awayTeam }}</p>
                </template>
                <template v-else>
                  <p class="truncate text-sm font-medium">{{ group.teams?.[0] ?? 'Partido' }}</p>
                  <p v-if="group.teams" class="truncate text-sm font-medium">{{ group.teams[1] }}</p>
                </template>
                <p v-if="group.resolved" class="flex items-center gap-1 text-xs text-success">
                  <CircleCheck class="size-3.5 shrink-0" />
                  Partido encontrado{{ group.resolved.league ? ' · ' + group.resolved.league : '' }}
                </p>
                <p v-else class="flex items-center gap-1 text-xs text-warning">
                  <TriangleAlert class="size-3.5 shrink-0" />
                  No encontramos este partido · no se va a poder seguir en vivo
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                class="size-9 shrink-0"
                :aria-label="`Quitar partido ${group.teams?.[0] ?? ''} ${group.teams?.[1] ?? ''}`"
                :disabled="isSubmitting"
                @click="discardGroup(group.tempId)"
              >
                <CircleX class="size-4 text-muted-foreground" />
              </Button>
            </div>

            <div class="flex flex-col gap-1.5 border-t border-border pt-2">
              <div v-for="pred in group.predictions" :key="pred.tempId" class="flex items-center gap-2">
                <div class="flex min-w-0 flex-1 flex-col">
                  <p class="truncate text-sm">{{ pred.selectionLabel }}</p>
                  <p class="truncate text-xs text-muted-foreground">{{ pred.marketLabel }}</p>
                </div>
                <Badge v-if="pred.marketType === 'unknown'" variant="outline" class="shrink-0 text-[10px]">No monitoreable</Badge>
                <span class="shrink-0 text-xs font-semibold tabular-nums">{{ formatOdds(pred.odds) }}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  class="size-8 shrink-0"
                  :aria-label="`Quitar selección ${pred.selectionLabel}`"
                  :disabled="isSubmitting"
                  @click="discardPrediction(group.tempId, pred.tempId)"
                >
                  <CircleX class="size-3.5 text-muted-foreground" />
                </Button>
              </div>
              <p v-if="group.predictions.length === 0" class="text-xs text-muted-foreground">
                Sin selecciones en este partido.
              </p>
            </div>

            <Button v-if="!group.resolved" type="button" variant="outline" size="sm" :disabled="isSubmitting" @click="openResolverFor(group.tempId)">
              <Search class="size-4" />
              Buscar este partido
            </Button>
          </div>

          <p v-if="form.detectedGroups.length === 0" class="py-6 text-center text-sm text-muted-foreground">
            No encontramos partidos en la foto.
          </p>
        </div>

        <div class="flex flex-col gap-1.5 border-t border-border px-4 py-3">
          <Label for="stake">Monto apostado (opcional)</Label>
          <Input id="stake" v-model="form.stakeAmount" type="text" inputmode="decimal" placeholder="0,00" class="text-base" :disabled="isSubmitting" />
          <p class="text-xs text-muted-foreground">La usamos para calcular tu posible ganancia. No la registramos como gasto.</p>
        </div>

        <SheetFooter class="flex-row gap-2">
          <Button type="button" variant="outline" class="flex-1" :disabled="isSubmitting" @click="startPhotoFlow">
            Probar con otra foto
          </Button>
          <Button type="button" class="flex-1" :disabled="isSubmitting" @click="confirmCoupon">
            <Loader2 v-if="isSubmitting" class="size-4 animate-spin" />
            {{ isSubmitting ? 'Guardando…' : confirmLabel }}
          </Button>
        </SheetFooter>
      </template>
    </SheetContent>
  </Sheet>

  <!-- Input de archivo oculto (compartido por "Subir foto" y "Probar con otra foto") -->
  <!-- Sin `capture`: un cupón suele ser una captura de pantalla (galería), no
       una foto de cámara — se deja elegir libremente el origen. -->
  <input
    ref="fileInputRef"
    type="file"
    accept="image/*"
    class="sr-only"
    @change="onFileSelected"
  >
</template>
