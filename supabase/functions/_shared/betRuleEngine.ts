// =============================================================================
// betRuleEngine.ts
// -----------------------------------------------------------------------------
// Puerto 1:1 a TypeScript de BetRuleEngine.kt
// (/home/lulo/Proyectos/Propios/FottStat/android/app/src/main/java/com/fottstat/domain/BetRuleEngine.kt,
// domain PURO y testeado en el proyecto original, ver PLAN.md sección 6.5).
// Evalúa una condición de mercado (marketType+threshold+selector, ya
// resuelta por marketMapper.ts) contra un snapshot del partido y devuelve
// won/lost/pending/not_monitorable, con DECISIÓN TEMPRANA: un leg puede
// pasar a won/lost antes de que termine el partido (ej. "Más de 0.5 goles"
// se decide won apenas hay 1 gol total, sin esperar al final).
//
// Corre exclusivamente server-side (Edge Function poll-matches, y también
// add-match para el snapshot inicial) — el frontend NUNCA recalcula esto,
// docs/features/live-matches-ux.md sección 1.7.
//
// Convenciones del snapshot (paridad con el feed de Flashscore, ver
// flashscoreFeed.ts):
//   - statusId === '3'  => partido finalizado (DA=3).
//   - stageCode: código de ETAPA DB (12=1ª parte, 38=descanso, 13=2ª parte,
//     3=finalizado) — se usa para saber si el 1er tiempo ya cerró.
// =============================================================================

import type { MarketType } from './marketMapper.ts'

export type LegStatus = 'pending' | 'won' | 'lost' | 'not_monitorable'

export interface LiveCondition {
  marketType: MarketType
  threshold: number | null
  selector: string | null
}

/** Subconjunto de campos de live_matches necesarios para evaluar legs. */
export interface MatchSnapshotForRules {
  statusId: string | null
  stageCode: number | null
  scoreHome: number | null
  scoreAway: number | null
  cornersHome: number | null
  cornersAway: number | null
  yellowHome: number | null
  yellowAway: number | null
  redHome: number | null
  redAway: number | null
  firstHalfHome: number | null
  firstHalfAway: number | null
}

const FIRST_HALF_OVER_STAGES = new Set([38, 13, 3]) // descanso, 2ª parte, fin

// need = primer entero que SUPERA la línea: 0.5->1, 3.5->4, 10.5->11.
//   Over  N.5 -> won en cuanto total>=need; si finaliza sin llegar -> lost.
//   Under N.5 -> lost en cuanto total>=need; won solo al finalizar si no se superó.
function overUnder(
  total: number | null,
  ready: boolean,
  threshold: number | null,
  over: boolean,
  finished: boolean,
): LegStatus {
  if (threshold == null) return 'not_monitorable'
  if (!ready || total == null) return 'pending'
  const need = Math.ceil(threshold)
  if (over) {
    if (total >= need) return 'won'
    return finished ? 'lost' : 'pending'
  }
  if (total >= need) return 'lost'
  return finished ? 'won' : 'pending'
}

function goalsTotal(s: MatchSnapshotForRules): number {
  return (s.scoreHome ?? 0) + (s.scoreAway ?? 0)
}
function goalsReady(s: MatchSnapshotForRules): boolean {
  return s.scoreHome != null || s.scoreAway != null
}
function cornersTotal(s: MatchSnapshotForRules): number {
  return (s.cornersHome ?? 0) + (s.cornersAway ?? 0)
}
function cornersReady(s: MatchSnapshotForRules): boolean {
  return s.cornersHome != null || s.cornersAway != null
}
function cardsTotal(s: MatchSnapshotForRules): number {
  return (s.yellowHome ?? 0) + (s.yellowAway ?? 0) + (s.redHome ?? 0) + (s.redAway ?? 0)
}
function cardsReady(s: MatchSnapshotForRules): boolean {
  return s.yellowHome != null || s.yellowAway != null || s.redHome != null || s.redAway != null
}

function matchResult(s: MatchSnapshotForRules): '1' | 'X' | '2' | null {
  if (s.scoreHome == null || s.scoreAway == null) return null
  if (s.scoreHome > s.scoreAway) return '1'
  if (s.scoreHome < s.scoreAway) return '2'
  return 'X'
}

// --- Ambos equipos anotan (partido completo) ------------------------------
function btts(s: MatchSnapshotForRules, selector: string | null, finished: boolean): LegStatus {
  if (s.scoreHome == null || s.scoreAway == null) return 'pending'
  const both = s.scoreHome >= 1 && s.scoreAway >= 1
  if (selector === 'yes') return both ? 'won' : finished ? 'lost' : 'pending'
  if (selector === 'no') return both ? 'lost' : finished ? 'won' : 'pending'
  return 'not_monitorable'
}

// --- Ambos equipos anotan en el 1er tiempo --------------------------------
function bttsFirstHalf(s: MatchSnapshotForRules, selector: string | null, finished: boolean): LegStatus {
  if (s.firstHalfHome == null || s.firstHalfAway == null) return 'not_monitorable'
  const both = s.firstHalfHome >= 1 && s.firstHalfAway >= 1
  const firstHalfOver = finished || (s.stageCode != null && FIRST_HALF_OVER_STAGES.has(s.stageCode))
  if (selector === 'yes') return both ? 'won' : firstHalfOver ? 'lost' : 'pending'
  if (selector === 'no') return both ? 'lost' : firstHalfOver ? 'won' : 'pending'
  return 'not_monitorable'
}

// --- Doble oportunidad (1X / X2 / 12) -- se decide al FINALIZAR ----------
function doubleChance(s: MatchSnapshotForRules, selector: string | null, finished: boolean): LegStatus {
  if (!finished) return 'pending'
  const r = matchResult(s)
  if (r == null) return 'not_monitorable'
  let covered: boolean
  if (selector === '1X') covered = r === '1' || r === 'X'
  else if (selector === 'X2') covered = r === 'X' || r === '2'
  else if (selector === '12') covered = r === '1' || r === '2'
  else return 'not_monitorable'
  return covered ? 'won' : 'lost'
}

// --- Resultado (1 / X / 2) -------------------------------------------------
function matchResultStatus(s: MatchSnapshotForRules, selector: string | null, finished: boolean): LegStatus {
  if (!finished) return 'pending'
  const r = matchResult(s)
  if (r == null) return 'not_monitorable'
  if (selector !== '1' && selector !== 'X' && selector !== '2') return 'not_monitorable'
  return r === selector ? 'won' : 'lost'
}

/** Evalúa una LiveCondition contra un snapshot. Idéntico a BetRuleEngine.evaluate de Kotlin. */
export function evaluateCondition(c: LiveCondition, s: MatchSnapshotForRules): LegStatus {
  const finished = s.statusId === '3'
  switch (c.marketType) {
    case 'total_goals_over':
      return overUnder(goalsTotal(s), goalsReady(s), c.threshold, true, finished)
    case 'total_goals_under':
      return overUnder(goalsTotal(s), goalsReady(s), c.threshold, false, finished)
    case 'corners_over':
      return overUnder(cornersTotal(s), cornersReady(s), c.threshold, true, finished)
    case 'corners_under':
      return overUnder(cornersTotal(s), cornersReady(s), c.threshold, false, finished)
    case 'cards_over':
      return overUnder(cardsTotal(s), cardsReady(s), c.threshold, true, finished)
    case 'cards_under':
      return overUnder(cardsTotal(s), cardsReady(s), c.threshold, false, finished)
    case 'btts':
      return btts(s, c.selector, finished)
    case 'btts_first_half':
      return bttsFirstHalf(s, c.selector, finished)
    case 'double_chance':
      return doubleChance(s, c.selector, finished)
    case 'match_result':
      return matchResultStatus(s, c.selector, finished)
    default:
      return 'not_monitorable'
  }
}
