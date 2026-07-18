// =============================================================================
// matchSnapshot.ts
// -----------------------------------------------------------------------------
// Primer poll sincrónico completo de un partido nuevo (los 3 feeds de
// Flashscore + meta opcional) -- extraído como helper compartido del
// rediseño multi-partido (20260718) porque ahora DOS Edge Functions
// necesitan la misma lógica: add-match (alta de un partido suelto, sin
// apuesta) y create-bet-slip (alta de un cupón, que puede traer 1+ partidos
// NUEVOS dentro de sus grupos). Antes vivía duplicada solo en add-match --
// no se duplica de nuevo acá, ambas funciones importan este módulo.
//
// Nunca lanza: si el poll falla (feed caído/token rotado), devuelve
// ok=false con el resto de campos en null/0 -- el partido se crea igual
// (mismo criterio ya establecido: el cron reintentará en su próxima
// corrida, next_poll_at ya queda en el pasado por default).
// =============================================================================
import { fetchFeed, fetchMeta } from './flashscoreClient.ts'
import { epochToIso, parseDetail, parseIncidents, parseStats } from './flashscoreFeed.ts'

export interface MatchSnapshot {
  scoreHome: number | null
  scoreAway: number | null
  statusId: string | null
  stageCode: number | null
  stageAnchorTs: string | null
  scheduledKickoffTs: string | null
  cornersHome: number | null
  cornersAway: number | null
  shotsOnTargetHome: number | null
  shotsOnTargetAway: number | null
  clearChancesHome: number | null
  clearChancesAway: number | null
  yellowCardsHome: number
  yellowCardsAway: number
  redCardsHome: number
  redCardsAway: number
  firstHalfScoreHome: number
  firstHalfScoreAway: number
  incidents: unknown[]
  homeTeam: string | null
  awayTeam: string | null
  competition: string | null
  ok: boolean
}

/** URL sintética cuando no hay una URL real de Flashscore (el picker de search-matches solo da matchId/nombres, nunca una URL). */
export function syntheticFlashscoreUrl(matchId: string): string {
  return `https://www.flashscore.com.ar/?mid=${encodeURIComponent(matchId)}`
}

/**
 * Hace el primer poll sincrónico completo (3 feeds + meta opcional si no se
 * proveyeron nombres) para un partido nuevo. `namesProvided`: true cuando el
 * picker de search-matches ya dio homeTeam/awayTeam/competition -- en ese
 * caso NUNCA se pisan con fetchMeta (scrape de HTML), mismo criterio que
 * add-match usaba antes de esta extracción.
 */
export async function fetchInitialSnapshot(
  mid: string,
  flashscoreUrl: string,
  fsign: string,
  namesProvided: boolean,
  providedHomeTeam: string | null,
  providedAwayTeam: string | null,
  providedCompetition: string | null,
): Promise<MatchSnapshot> {
  const snapshot: MatchSnapshot = {
    scoreHome: null,
    scoreAway: null,
    statusId: null,
    stageCode: null,
    stageAnchorTs: null,
    scheduledKickoffTs: null,
    cornersHome: null,
    cornersAway: null,
    shotsOnTargetHome: null,
    shotsOnTargetAway: null,
    clearChancesHome: null,
    clearChancesAway: null,
    yellowCardsHome: 0,
    yellowCardsAway: 0,
    redCardsHome: 0,
    redCardsAway: 0,
    firstHalfScoreHome: 0,
    firstHalfScoreAway: 0,
    incidents: [],
    homeTeam: namesProvided ? providedHomeTeam : null,
    awayTeam: namesProvided ? providedAwayTeam : null,
    competition: namesProvided ? providedCompetition : null,
    ok: true,
  }

  try {
    const metaPromise = namesProvided
      ? Promise.resolve({ homeTeam: null, awayTeam: null, competition: null })
      : fetchMeta(flashscoreUrl)
    const [dc, dfSt, dfSu, meta] = await Promise.all([
      fetchFeed(mid, 'dc', fsign),
      fetchFeed(mid, 'df_st', fsign),
      fetchFeed(mid, 'df_su', fsign),
      metaPromise,
    ])

    const detail = parseDetail(dc.body)
    const stats = parseStats(dfSt.body)
    const inc = parseIncidents(dfSu.body)

    snapshot.scoreHome = detail.scoreHome
    snapshot.scoreAway = detail.scoreAway
    snapshot.statusId = detail.statusId
    snapshot.stageCode = detail.stageCode
    snapshot.stageAnchorTs = epochToIso(detail.stageAnchorEpoch)
    snapshot.scheduledKickoffTs = epochToIso(detail.scheduledKickoffEpoch)
    snapshot.cornersHome = stats.cornersHome
    snapshot.cornersAway = stats.cornersAway
    snapshot.shotsOnTargetHome = stats.shotsOnTargetHome
    snapshot.shotsOnTargetAway = stats.shotsOnTargetAway
    snapshot.clearChancesHome = stats.clearChancesHome
    snapshot.clearChancesAway = stats.clearChancesAway
    snapshot.yellowCardsHome = inc.yellowHome
    snapshot.yellowCardsAway = inc.yellowAway
    snapshot.redCardsHome = inc.redHome
    snapshot.redCardsAway = inc.redAway
    snapshot.firstHalfScoreHome = inc.firstHalfHome
    snapshot.firstHalfScoreAway = inc.firstHalfAway
    snapshot.incidents = inc.events
    if (!namesProvided) {
      snapshot.homeTeam = meta.homeTeam
      snapshot.awayTeam = meta.awayTeam
      snapshot.competition = meta.competition
    }
  } catch (e) {
    console.error(`matchSnapshot: primer poll falló para mid=${mid}, se crea igual (el cron reintentará)`, e)
    snapshot.ok = false
  }

  return snapshot
}
