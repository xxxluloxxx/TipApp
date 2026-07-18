// Motor de mapeo de íconos/labels/variantes de estado (live-matches-ux.md
// secciones 3.4/3.5/4.3/4.4/8). Centralizado acá para que la card
// (`MatchLegsSummary`/`MatchStatsRow`), el detalle (`MatchDetailView`) y el
// dashboard usen exactamente el mismo vocabulario visual, sin duplicar los
// `switch` en cada componente. Toda la lógica de dominio (qué estado tiene un
// leg, el marcador, el minuto) vive en el backend (secciones 1.2/1.7): esto
// es pura presentación sobre valores ya resueltos.
import {
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  Goal,
  Repeat,
  type LucideIcon,
} from '@lucide/vue'

// Los `status` posibles de `bet_slip_legs.status` (sección 1.7). Se declaran
// acá como union porque `database.types.ts` los infiere como `string` plano
// (el generador no modela el enum/check de Postgres) — mismo criterio que
// `ThemePreference` en `auth.ts`.
export type LegStatus = 'won' | 'lost' | 'pending' | 'not_monitorable'

// Estado de monitoreo del partido (sección 3.4). Distinto del minuto/etapa en
// cancha (`stage_code`): un partido puede estar "Finalizado" en cancha y
// "Pausado" en el monitoreo.
export type MatchState = 'monitoring' | 'paused' | 'finished'

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'

interface LegStatusDisplay {
  icon: LucideIcon
  /** Clase de color para el ícono (sección 4.4). */
  iconClass: string
  label: string
  badgeVariant: BadgeVariant
  /** Clase extra para el `Badge` cuando el token no es un `variant` estándar
   * (caso `won` → `success`, que no existe como variante de `Badge`, sección
   * 4.4). */
  badgeClass?: string
}

const LEG_STATUS_DISPLAY: Record<LegStatus, LegStatusDisplay> = {
  won: {
    icon: CircleCheck,
    iconClass: 'text-success',
    label: 'Ganado',
    badgeVariant: 'outline',
    badgeClass: 'border-success text-success',
  },
  lost: {
    icon: CircleX,
    iconClass: 'text-destructive',
    label: 'Perdido',
    badgeVariant: 'destructive',
  },
  pending: {
    icon: Clock,
    iconClass: 'text-muted-foreground',
    label: 'Pendiente',
    badgeVariant: 'secondary',
  },
  not_monitorable: {
    icon: CircleDashed,
    iconClass: 'text-muted-foreground',
    label: 'No monitoreable',
    badgeVariant: 'outline',
  },
}

/** Normaliza un `status` crudo (string) al display de un estado conocido —
 * cualquier valor inesperado cae en `not_monitorable` (nunca rompe la UI). */
export function legStatusDisplay(status: string): LegStatusDisplay {
  return LEG_STATUS_DISPLAY[status as LegStatus] ?? LEG_STATUS_DISPLAY.not_monitorable
}

interface StateDisplay {
  label: string
  badgeVariant: BadgeVariant
}

const STATE_DISPLAY: Record<MatchState, StateDisplay> = {
  monitoring: { label: 'Monitoreando', badgeVariant: 'default' },
  paused: { label: 'Pausado', badgeVariant: 'outline' },
  finished: { label: 'Finalizado', badgeVariant: 'secondary' },
}

export function stateDisplay(state: string): StateDisplay {
  return STATE_DISPLAY[state as MatchState] ?? STATE_DISPLAY.monitoring
}

// --- Incidencias (sección 4.3) ---------------------------------------------

/** Forma de cada elemento de `live_matches.incidents` (jsonb), espejo del
 * `FeedIncident` que arma el backend (`_shared/flashscoreFeed.ts`). */
export interface MatchIncident {
  type: string
  rawType?: string | null
  team: 'home' | 'away' | null
  minuteLabel: string | null
  player: string | null
  period: string | null
  description: string | null
  score: [number, number] | null
}

const GOAL_TYPES = new Set(['goal', 'penalty', 'own_goal'])
const YELLOW_TYPES = new Set(['yellow_card', 'second_yellow_card'])
const RED_TYPES = new Set(['red_card'])
const SUB_TYPES = new Set(['substitution_in', 'substitution_out'])

export interface IncidentDisplay {
  /** `icon` es `null` para los casos que se dibujan con un cuadradito de
   * color (tarjetas), mismo criterio literal que `MatchStatsRow` (sección
   * 3.5): amarillo/rojo se pintan con `bg-warning`/`bg-destructive`, no con
   * un ícono. */
  icon: LucideIcon | null
  iconClass: string
  /** Clase de fondo del cuadradito cuando `icon === null`. */
  squareClass?: string
}

export function incidentDisplay(type: string): IncidentDisplay {
  if (GOAL_TYPES.has(type)) return { icon: Goal, iconClass: 'text-primary' }
  if (YELLOW_TYPES.has(type)) return { icon: null, iconClass: '', squareClass: 'bg-warning' }
  if (RED_TYPES.has(type)) return { icon: null, iconClass: '', squareClass: 'bg-destructive' }
  if (SUB_TYPES.has(type)) return { icon: Repeat, iconClass: 'text-muted-foreground' }
  return { icon: CircleDashed, iconClass: 'text-muted-foreground' }
}

/** Texto principal de una incidencia (sección 4.3). Los goles en contra se
 * aclaran explícitamente "(en contra)" — el gol ya viene atribuido por el
 * backend al equipo que se benefició (`IG`/`IH` de PLAN.md), acá solo se
 * rotula. */
export function incidentLabel(incident: MatchIncident): string {
  const base = (() => {
    switch (incident.type) {
      case 'goal':
        return 'Gol'
      case 'penalty':
        return 'Gol de penal'
      case 'own_goal':
        return 'Gol en contra'
      case 'yellow_card':
        return 'Tarjeta amarilla'
      case 'second_yellow_card':
        return 'Segunda amarilla'
      case 'red_card':
        return 'Tarjeta roja'
      case 'substitution_in':
      case 'substitution_out':
        return 'Cambio'
      default:
        return incident.description || 'Incidencia'
    }
  })()

  if (incident.score) return `${base} (${incident.score[0]}-${incident.score[1]})`
  return base
}
