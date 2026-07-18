<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  EllipsisVertical,
  Radio,
  Ticket,
  Trash2,
} from '@lucide/vue'
import type { Coupon, CouponMatch } from '@/stores/betSlips'
import { isLiveStage, matchClockLabel } from '@/lib/matchClock'
import { legStatusDisplay } from '@/lib/matchDisplay'
import { formatAmount, formatOdds } from '@/lib/currency'
import MatchStatsRow from '@/components/MatchStatsRow.vue'
import CouponStatusRing from '@/components/charts/CouponStatusRing.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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

// Card de un cupón multi-partido (live-coupons-ux.md §6/§7). Presentacional:
// consume el `Coupon` ya ensamblado por el store (estados server-side, §1) y
// solo pinta/expande. La card NO es un único botón: el menú `⋮` y cada fila de
// partido son hermanos, nada interactivo anidado en otro (a11y §6).

const props = defineProps<{
  coupon: Coupon
  /** Reloj compartido del dashboard (tickea 1s) para el minuto en vivo. */
  now: number
}>()

const emit = defineEmits<{
  remove: [id: string]
}>()

// Se permite tener varias filas expandidas a la vez (§7.2, sin costo real).
const expandedIds = ref<Set<string>>(new Set())
function isExpanded(id: string): boolean {
  return expandedIds.value.has(id)
}
function toggleExpand(id: string): void {
  const next = new Set(expandedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedIds.value = next
}

// --- Estado del cupón (badge del encabezado) ------------------------------

interface CouponStatusChip {
  label: string
  variant: 'secondary' | 'destructive' | 'outline'
  class?: string
}
function couponStatusChip(status: Coupon['status']): CouponStatusChip {
  if (status === 'won') return { label: 'Ganado', variant: 'outline', class: 'border-success text-success' }
  if (status === 'lost') return { label: 'Perdido', variant: 'destructive' }
  return { label: 'En progreso', variant: 'secondary' }
}

// --- Estado de apuesta de un partido (glyph + sr-only, §3.1/§7.1) ---------

function betStatusLabel(match: CouponMatch): string {
  if (match.betStatus === 'won') return 'Ganado'
  if (match.betStatus === 'lost') return 'Perdido'
  if (match.betStatus === 'live') return 'En juego'
  if (!match.isLinked) return 'No vinculado'
  return 'Pendiente'
}

// --- Reloj / marcador del partido -----------------------------------------

function isLive(match: CouponMatch): boolean {
  return match.liveMatch != null && isLiveStage(match.liveMatch.stage_code)
}
function clockLabel(match: CouponMatch): string {
  const lm = match.liveMatch
  if (!lm) return ''
  return matchClockLabel(lm.stage_code, lm.stage_anchor_ts, lm.scheduled_kickoff_ts, props.now)
}
function hasScore(match: CouponMatch): boolean {
  return match.liveMatch != null && (match.liveMatch.score_home !== null || match.liveMatch.score_away !== null)
}
function scoreText(value: number | null | undefined): string {
  return value === null || value === undefined ? '-' : String(value)
}
function isAwaitingData(match: CouponMatch): boolean {
  // §7.3: recién agregado, sin primer poll todavía (solo si está vinculado).
  return match.isLinked && match.liveMatch != null && match.liveMatch.last_polled_at === null
}
</script>

<template>
  <Card class="overflow-hidden">
    <!-- Encabezado: referencia + estado + menú (§6.1) -->
    <div class="flex items-center justify-between gap-2 px-4 pt-3 pb-1">
      <div class="flex min-w-0 items-center gap-2">
        <Ticket class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p class="truncate text-sm font-semibold">
          {{ coupon.reference ?? 'Cupón' }}
        </p>
        <Badge
          :variant="couponStatusChip(coupon.status).variant"
          :class="couponStatusChip(coupon.status).class"
          class="shrink-0 text-[10px]"
        >
          {{ couponStatusChip(coupon.status).label }}
        </Badge>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="icon" aria-label="Más opciones del cupón" class="-mr-2 size-9">
            <EllipsisVertical class="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <AlertDialog>
            <AlertDialogTrigger as-child>
              <DropdownMenuItem variant="destructive" @select="(e: Event) => e.preventDefault()">
                <Trash2 class="size-4" />
                Quitar cupón
              </DropdownMenuItem>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Quitar este cupón?</AlertDialogTitle>
                <AlertDialogDescription>
                  Dejamos de seguir el cupón y todos sus partidos. Esta acción no se puede deshacer.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction @click="emit('remove', coupon.id)">
                  Quitar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <!-- Anillo + leyenda (§6.2) -->
    <div class="flex items-center gap-4 px-4 py-3">
      <CouponStatusRing
        :won="coupon.wonMatches"
        :live="coupon.liveMatchesCount"
        :pending="coupon.pendingMatches"
        :lost="coupon.lostMatches"
        class="size-24 shrink-0"
      />
      <ul class="flex flex-1 flex-col gap-1.5 text-sm">
        <li class="flex items-center gap-2" :class="{ 'opacity-60': coupon.wonMatches === 0 }">
          <CircleCheck class="size-4 text-success" aria-hidden="true" />
          <span class="flex-1 text-muted-foreground">Ganados</span>
          <span class="font-semibold tabular-nums">{{ coupon.wonMatches }}</span>
        </li>
        <!-- `Radio` en `warning` acá a propósito: es la leyenda del anillo
             (paleta de estado del PO), atada al tramo ámbar. En las FILAS de
             partido el `Radio` "en vivo" es azul (§4.2). -->
        <li class="flex items-center gap-2" :class="{ 'opacity-60': coupon.liveMatchesCount === 0 }">
          <Radio class="size-4 text-warning" aria-hidden="true" />
          <span class="flex-1 text-muted-foreground">En juego</span>
          <span class="font-semibold tabular-nums">{{ coupon.liveMatchesCount }}</span>
        </li>
        <li class="flex items-center gap-2" :class="{ 'opacity-60': coupon.pendingMatches === 0 }">
          <Clock class="size-4 text-muted-foreground" aria-hidden="true" />
          <span class="flex-1 text-muted-foreground">Pendientes</span>
          <span class="font-semibold tabular-nums">{{ coupon.pendingMatches }}</span>
        </li>
        <li class="flex items-center gap-2" :class="{ 'opacity-60': coupon.lostMatches === 0 }">
          <CircleX class="size-4 text-destructive" aria-hidden="true" />
          <span class="flex-1 text-muted-foreground">Perdidos</span>
          <span class="font-semibold tabular-nums">{{ coupon.lostMatches }}</span>
        </li>
      </ul>
    </div>

    <!-- Tira de cuotas (§6.3) -->
    <div class="grid grid-cols-3 gap-2 border-t border-border px-4 py-3 text-center">
      <div class="flex flex-col gap-0.5">
        <span class="text-xs text-muted-foreground">Cuota total</span>
        <span class="text-sm font-semibold tabular-nums">{{ formatOdds(coupon.totalOdds) }}</span>
      </div>
      <div class="flex flex-col gap-0.5">
        <span class="text-xs text-muted-foreground">Apostado</span>
        <span class="text-sm font-semibold tabular-nums">
          {{ coupon.stakeAmount != null ? '$' + formatAmount(coupon.stakeAmount) : '—' }}
        </span>
      </div>
      <div class="flex flex-col gap-0.5">
        <span class="text-xs text-muted-foreground">Posible ganancia</span>
        <span class="text-sm font-semibold tabular-nums text-success">
          {{ coupon.potentialWinnings != null ? '$' + formatAmount(coupon.potentialWinnings) : '—' }}
        </span>
      </div>
    </div>

    <!-- Filas de partido (acordeón, §7) -->
    <div v-for="match in coupon.matches" :key="match.id" class="border-t border-border">
      <button
        type="button"
        class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        :aria-expanded="isExpanded(match.id)"
        :aria-controls="`match-panel-${match.id}`"
        @click="toggleExpand(match.id)"
      >
        <!-- Glyph de bet_status (el 'live' reusa el pulso azul establecido) -->
        <span class="shrink-0">
          <Radio v-if="match.betStatus === 'live'" class="size-4 animate-pulse text-primary" aria-hidden="true" />
          <CircleCheck v-else-if="match.betStatus === 'won'" class="size-4 text-success" aria-hidden="true" />
          <CircleX v-else-if="match.betStatus === 'lost'" class="size-4 text-destructive" aria-hidden="true" />
          <CircleDashed v-else-if="!match.isLinked" class="size-4 text-muted-foreground" aria-hidden="true" />
          <Clock v-else class="size-4 text-muted-foreground" aria-hidden="true" />
          <span class="sr-only">{{ betStatusLabel(match) }}: </span>
        </span>

        <!-- Equipos apilados (o rótulo si no se pudo vincular → sin nombres) -->
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <template v-if="match.liveMatch">
            <p class="truncate text-sm font-medium">{{ match.liveMatch.home_team ?? 'Local' }}</p>
            <p class="truncate text-sm font-medium">{{ match.liveMatch.away_team ?? 'Visitante' }}</p>
          </template>
          <p v-else class="truncate text-sm font-medium">Partido no vinculado</p>
          <p v-if="!match.isLinked" class="text-xs text-warning">No se pudo vincular · no se sigue en vivo</p>
          <p v-else-if="isAwaitingData(match)" class="text-xs text-muted-foreground">Buscando datos del partido…</p>
        </div>

        <!-- Marcador (solo si vinculado y arrancó) -->
        <div v-if="hasScore(match)" class="flex flex-col items-end gap-0.5 tabular-nums">
          <span class="text-sm font-bold">{{ scoreText(match.liveMatch?.score_home) }}</span>
          <span class="text-sm font-bold">{{ scoreText(match.liveMatch?.score_away) }}</span>
        </div>

        <!-- Minuto/estado -->
        <div v-if="match.isLinked && !isAwaitingData(match)" class="flex shrink-0 flex-col items-end gap-1">
          <span v-if="isLive(match)" class="flex items-center gap-1 text-xs font-semibold text-primary">
            <Radio class="size-3 animate-pulse" aria-hidden="true" />{{ clockLabel(match) }}
          </span>
          <Badge v-else variant="secondary" class="text-[10px]">{{ clockLabel(match) }}</Badge>
        </div>
        <component :is="isExpanded(match.id) ? ChevronDown : ChevronRight" class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>

      <!-- Panel expandido: "Tus pronósticos" + stats en vivo (§7.2) -->
      <div v-if="isExpanded(match.id)" :id="`match-panel-${match.id}`" class="flex flex-col gap-3 px-4 pb-4">
        <div class="flex flex-col gap-1.5">
          <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tus pronósticos</p>
          <div
            v-for="leg in match.legs"
            :key="leg.id"
            class="flex items-start gap-2.5 rounded-md bg-muted/40 px-3 py-2"
          >
            <component
              :is="legStatusDisplay(leg.status).icon"
              class="mt-0.5 size-4 shrink-0"
              :class="legStatusDisplay(leg.status).iconClass"
              aria-hidden="true"
            />
            <div class="flex min-w-0 flex-1 flex-col">
              <p class="text-sm font-medium">{{ leg.selection_label }}</p>
              <p class="text-xs text-muted-foreground">{{ leg.market_label }}</p>
            </div>
            <div class="flex shrink-0 flex-col items-end gap-1">
              <span class="text-xs font-semibold tabular-nums text-muted-foreground">{{ formatOdds(leg.odds) }}</span>
              <Badge
                :variant="legStatusDisplay(leg.status).badgeVariant"
                :class="legStatusDisplay(leg.status).badgeClass"
                class="text-[10px]"
              >
                {{ legStatusDisplay(leg.status).label }}
              </Badge>
            </div>
          </div>
          <p v-if="match.legs.length === 0" class="text-sm text-muted-foreground">Sin pronósticos.</p>
        </div>

        <!-- Stats en vivo compactas, solo si el partido está en curso -->
        <MatchStatsRow v-if="isLive(match) && match.liveMatch" :match="match.liveMatch" />

        <!-- Link al detalle completo (solo si hay un partido real vinculado) -->
        <RouterLink
          v-if="match.isLinked && match.liveMatchId"
          :to="{ name: 'match-detail', params: { id: match.liveMatchId } }"
          class="flex min-h-9 items-center justify-center gap-1.5 rounded-md text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Ver detalle del partido
          <ChevronRight class="size-4" aria-hidden="true" />
        </RouterLink>
      </div>
    </div>
  </Card>
</template>
