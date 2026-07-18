// =============================================================================
// add-match
// -----------------------------------------------------------------------------
// Alta de un partido monitoreado. Recibe { url?, matchId?, homeTeam?,
// awayTeam?, competition?, legs? } del frontend YA AUTENTICADO (ver bloque
// de comentario más abajo para el contrato completo) — usa el JWT del
// usuario que llama (nunca service_role) para
// que el insert respete RLS naturalmente, mismo espíritu atómico que
// create_debt pero acá corre en una Edge Function (no una función SQL pura)
// porque necesita hacer fetch HTTP saliente a Flashscore antes de insertar.
//
// Hace SINCRÓNICAMENTE el primer poll completo (los 3 feeds, parseo
// completo) para poblar el snapshot inicial de una — el usuario ve datos
// reales apenas se cierra el Sheet de alta, sin depender de que pase la
// primera corrida del cron (docs/features/live-matches-ux.md sección 5.5).
// Si el primer poll falla (feed caído/token rotado), el partido se crea
// igual con last_poll_ok=false — el cron reintentará en su próxima corrida
// (next_poll_at ya queda en el pasado por default).
//
// legs (si el usuario subió foto de cupón y confirmó el preview de
// ocr-betslip) llegan YA clasificados por marketMapper — acá se evalúan una
// vez contra el snapshot recién obtenido (puede haber decisión temprana
// desde el arranque) y se insertan junto con la cabecera en una sola
// transacción atómica vía la función rpc create_live_match.
//
// Desde que existe el picker de search-matches (docs/features/
// live-matches-ux.md, buscador de partidos), el frontend YA tiene
// matchId/homeTeam/awayTeam/league de ese listado — pedirle igual una URL
// real y volver a scrapear su HTML (fetchMeta) sería trabajo redundante y
// frágil. Payload extendido de forma retrocompatible: si vienen matchId +
// homeTeam + awayTeam, se usan directo (sin extractMatchId ni fetchMeta);
// si solo viene `url`, camino legacy sin cambios (compat con clientes
// viejos/no actualizados). flashscore_url sigue siendo NOT NULL en
// live_matches: si el cliente no mandó `url`, se construye uno sintético
// `https://www.flashscore.com.ar/?mid=<matchId>` (mismo formato de URL que
// el propio FottStat original trata como válido en sus tests,
// android/app/src/test/java/com/fottstat/data/MatchStoreTest.kt) — sirve
// como link "Ver en Flashscore" en MatchDetailView.vue.
// =============================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, handlePreflight } from '../_shared/cors.ts'
import { extractMatchId, fetchFeed, fetchMeta } from '../_shared/flashscoreClient.ts'
import { epochToIso, parseDetail, parseIncidents, parseStats } from '../_shared/flashscoreFeed.ts'
import { evaluateCondition, type MatchSnapshotForRules } from '../_shared/betRuleEngine.ts'
import type { MarketType } from '../_shared/marketMapper.ts'

interface IncomingLeg {
  marketType: MarketType
  marketLabel: string
  selectionLabel: string
  threshold: number | null
  selector: string | null
  rawText: string | null
}

interface AddMatchBody {
  url?: string
  matchId?: string
  homeTeam?: string
  awayTeam?: string
  competition?: string
  legs?: IncomingLeg[]
}

/** URL sintética cuando el frontend manda matchId/nombres sin una URL real de Flashscore (ver comentario de cabecera). */
function syntheticFlashscoreUrl(matchId: string): string {
  return `https://www.flashscore.com.ar/?mid=${encodeURIComponent(matchId)}`
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return json({ error: 'missing_authorization' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData?.user) {
    return json({ error: 'invalid_session' }, 401)
  }

  let body: AddMatchBody
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const hasMatchId = typeof body?.matchId === 'string' && body.matchId.length > 0
  const hasUrl = typeof body?.url === 'string' && body.url.length > 0
  if (!hasMatchId && !hasUrl) {
    return json({ error: 'missing_match_reference' }, 400)
  }

  // Nombres provistos directo por el picker (search-matches) — evita
  // fetchMeta (scrape de HTML) más abajo, ver comentario de cabecera.
  const namesProvided = typeof body?.homeTeam === 'string' && body.homeTeam.length > 0 &&
    typeof body?.awayTeam === 'string' && body.awayTeam.length > 0

  let mid: string
  if (hasMatchId) {
    mid = body.matchId as string
  } else {
    try {
      mid = extractMatchId(body.url as string)
    } catch (e) {
      return json({ error: 'invalid_url', message: (e as Error).message }, 400)
    }
  }

  const flashscoreUrl = hasUrl ? (body.url as string) : syntheticFlashscoreUrl(mid)

  // Chequeo de duplicado — red de seguridad server-side real (el frontend
  // ya hace un chequeo barato en cliente contra la lista en memoria,
  // docs/features/live-matches-ux.md sección 5.1; esto es lo que de verdad
  // impide la carrera). La constraint unique(user_id, flashscore_mid) y el
  // chequeo dentro de create_live_match son el backstop final.
  const { data: existing } = await supabase
    .from('live_matches')
    .select('id')
    .eq('flashscore_mid', mid)
    .maybeSingle()
  if (existing) {
    return json({ error: 'duplicate_match' }, 409)
  }

  const fsign = Deno.env.get('FLASHSCORE_FSIGN') ?? 'SW9D1eZo'

  let scoreHome: number | null = null
  let scoreAway: number | null = null
  let statusId: string | null = null
  let stageCode: number | null = null
  let stageAnchorTs: string | null = null
  let scheduledKickoffTs: string | null = null
  let cornersHome: number | null = null
  let cornersAway: number | null = null
  let shotsOnTargetHome: number | null = null
  let shotsOnTargetAway: number | null = null
  let clearChancesHome: number | null = null
  let clearChancesAway: number | null = null
  let yellowCardsHome = 0
  let yellowCardsAway = 0
  let redCardsHome = 0
  let redCardsAway = 0
  let firstHalfScoreHome = 0
  let firstHalfScoreAway = 0
  let incidents: unknown[] = []
  let lastPollOk = true
  // Provisto directo por el picker (search-matches): se fija de entrada y
  // NUNCA se pisa con fetchMeta, ver comentario de cabecera.
  let homeTeam: string | null = namesProvided ? (body.homeTeam as string) : null
  let awayTeam: string | null = namesProvided ? (body.awayTeam as string) : null
  let competition: string | null = namesProvided ? (typeof body.competition === 'string' && body.competition.length > 0 ? body.competition : null) : null

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

    scoreHome = detail.scoreHome
    scoreAway = detail.scoreAway
    statusId = detail.statusId
    stageCode = detail.stageCode
    stageAnchorTs = epochToIso(detail.stageAnchorEpoch)
    scheduledKickoffTs = epochToIso(detail.scheduledKickoffEpoch)
    cornersHome = stats.cornersHome
    cornersAway = stats.cornersAway
    shotsOnTargetHome = stats.shotsOnTargetHome
    shotsOnTargetAway = stats.shotsOnTargetAway
    clearChancesHome = stats.clearChancesHome
    clearChancesAway = stats.clearChancesAway
    yellowCardsHome = inc.yellowHome
    yellowCardsAway = inc.yellowAway
    redCardsHome = inc.redHome
    redCardsAway = inc.redAway
    firstHalfScoreHome = inc.firstHalfHome
    firstHalfScoreAway = inc.firstHalfAway
    incidents = inc.events
    if (!namesProvided) {
      homeTeam = meta.homeTeam
      awayTeam = meta.awayTeam
      competition = meta.competition
    }
  } catch (e) {
    console.error('add-match: el primer poll falló, se crea igual el partido (el cron reintentará)', e)
    lastPollOk = false
  }

  const snapshotForRules: MatchSnapshotForRules = {
    statusId,
    stageCode,
    scoreHome,
    scoreAway,
    cornersHome,
    cornersAway,
    yellowHome: yellowCardsHome,
    yellowAway: yellowCardsAway,
    redHome: redCardsHome,
    redAway: redCardsAway,
    firstHalfHome: firstHalfScoreHome,
    firstHalfAway: firstHalfScoreAway,
  }

  const legsPayload = (body.legs ?? []).map((leg) => {
    const marketType = leg.marketType ?? 'unknown'
    return {
      market_type: marketType,
      market_label: leg.marketLabel ?? '',
      selection_label: leg.selectionLabel ?? '',
      threshold: leg.threshold,
      selector: leg.selector,
      raw_text: leg.rawText,
      status: evaluateCondition({ marketType, threshold: leg.threshold ?? null, selector: leg.selector ?? null }, snapshotForRules),
    }
  })

  const { data: matchId, error: rpcError } = await supabase.rpc('create_live_match', {
    p_flashscore_mid: mid,
    p_flashscore_url: flashscoreUrl,
    p_home_team: homeTeam,
    p_away_team: awayTeam,
    p_competition: competition,
    p_score_home: scoreHome,
    p_score_away: scoreAway,
    p_stage_code: stageCode,
    p_stage_anchor_ts: stageAnchorTs,
    p_scheduled_kickoff_ts: scheduledKickoffTs,
    p_corners_home: cornersHome,
    p_corners_away: cornersAway,
    p_shots_on_target_home: shotsOnTargetHome,
    p_shots_on_target_away: shotsOnTargetAway,
    p_clear_chances_home: clearChancesHome,
    p_clear_chances_away: clearChancesAway,
    p_yellow_cards_home: yellowCardsHome,
    p_yellow_cards_away: yellowCardsAway,
    p_red_cards_home: redCardsHome,
    p_red_cards_away: redCardsAway,
    p_first_half_score_home: firstHalfScoreHome,
    p_first_half_score_away: firstHalfScoreAway,
    p_incidents: incidents,
    p_last_poll_ok: lastPollOk,
    p_poll_interval_seconds: 20,
    p_legs: legsPayload,
  })

  if (rpcError) {
    const isDuplicate = rpcError.code === '23505' || (rpcError.message ?? '').includes('Ya estás siguiendo')
    return json({ error: isDuplicate ? 'duplicate_match' : 'insert_failed', message: rpcError.message }, isDuplicate ? 409 : 500)
  }

  const { data: created, error: fetchAfterError } = await supabase
    .from('live_matches')
    .select('*, bet_slip_legs(*)')
    .eq('id', matchId as string)
    .single()

  if (fetchAfterError) {
    return json({ error: 'fetch_after_insert_failed', message: fetchAfterError.message }, 500)
  }

  return json({ match: created }, 201)
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
