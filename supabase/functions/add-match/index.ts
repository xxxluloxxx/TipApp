// =============================================================================
// add-match
// -----------------------------------------------------------------------------
// Alta de un partido monitoreado SIN apuesta -- "solo quiero seguirlo en
// vivo" (ej. el live_match real "Baumberg-Bayer Leverkusen" del proyecto,
// que nunca tuvo ningún leg). Recibe { url?, matchId?, homeTeam?, awayTeam?,
// competition? } del frontend YA AUTENTICADO -- usa el JWT del usuario que
// llama (nunca service_role) para que el insert respete RLS naturalmente.
//
// Tras el rediseño multi-partido (20260718), esta función YA NO acepta
// `legs`: toda alta de bet_slip_legs (con o sin foto, 1 partido o varios)
// pasa exclusivamente por la Edge Function create-bet-slip + la RPC
// create_bet_slip -- un único camino, sin dos formas divergentes de crear
// una predicción. add-match vuelve a ser lo que su nombre siempre dijo:
// agregar un partido a la lista de seguimiento, nada más.
//
// Hace SINCRÓNICAMENTE el primer poll completo (los 3 feeds, parseo
// completo, vía _shared/matchSnapshot.ts -- compartido con create-bet-slip)
// para poblar el snapshot inicial de una -- el usuario ve datos reales
// apenas se cierra el Sheet de alta, sin depender de que pase la primera
// corrida del cron. Si el primer poll falla (feed caído/token rotado), el
// partido se crea igual con last_poll_ok=false -- el cron reintentará en su
// próxima corrida (next_poll_at ya queda en el pasado por default).
//
// Desde que existe el picker de search-matches, el frontend YA tiene
// matchId/homeTeam/awayTeam/league de ese listado -- pedirle igual una URL
// real y volver a scrapear su HTML (fetchMeta) sería trabajo redundante y
// frágil. Payload extendido de forma retrocompatible: si vienen matchId +
// homeTeam + awayTeam, se usan directo (sin extractMatchId ni fetchMeta);
// si solo viene `url`, camino legacy sin cambios (compat con clientes
// viejos/no actualizados). flashscore_url sigue siendo NOT NULL en
// live_matches: si el cliente no mandó `url`, se construye uno sintético.
// =============================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, handlePreflight } from '../_shared/cors.ts'
import { extractMatchId } from '../_shared/flashscoreClient.ts'
import { fetchInitialSnapshot, syntheticFlashscoreUrl } from '../_shared/matchSnapshot.ts'

interface AddMatchBody {
  url?: string
  matchId?: string
  homeTeam?: string
  awayTeam?: string
  competition?: string
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

  // Nombres provistos directo por el picker (search-matches) -- evita
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

  // Chequeo de duplicado -- red de seguridad server-side real (el frontend
  // ya hace un chequeo barato en cliente contra la lista en memoria). La
  // constraint unique(user_id, flashscore_mid) y el chequeo dentro de
  // create_live_match son el backstop final.
  const { data: existing } = await supabase
    .from('live_matches')
    .select('id')
    .eq('flashscore_mid', mid)
    .maybeSingle()
  if (existing) {
    return json({ error: 'duplicate_match' }, 409)
  }

  const fsign = Deno.env.get('FLASHSCORE_FSIGN') ?? 'SW9D1eZo'

  const snapshot = await fetchInitialSnapshot(
    mid,
    flashscoreUrl,
    fsign,
    namesProvided,
    namesProvided ? (body.homeTeam as string) : null,
    namesProvided ? (body.awayTeam as string) : null,
    namesProvided ? (typeof body.competition === 'string' && body.competition.length > 0 ? body.competition : null) : null,
  )

  const { data: matchId, error: rpcError } = await supabase.rpc('create_live_match', {
    p_flashscore_mid: mid,
    p_flashscore_url: flashscoreUrl,
    p_home_team: snapshot.homeTeam,
    p_away_team: snapshot.awayTeam,
    p_competition: snapshot.competition,
    p_score_home: snapshot.scoreHome,
    p_score_away: snapshot.scoreAway,
    p_stage_code: snapshot.stageCode,
    p_stage_anchor_ts: snapshot.stageAnchorTs,
    p_scheduled_kickoff_ts: snapshot.scheduledKickoffTs,
    p_corners_home: snapshot.cornersHome,
    p_corners_away: snapshot.cornersAway,
    p_shots_on_target_home: snapshot.shotsOnTargetHome,
    p_shots_on_target_away: snapshot.shotsOnTargetAway,
    p_clear_chances_home: snapshot.clearChancesHome,
    p_clear_chances_away: snapshot.clearChancesAway,
    p_yellow_cards_home: snapshot.yellowCardsHome,
    p_yellow_cards_away: snapshot.yellowCardsAway,
    p_red_cards_home: snapshot.redCardsHome,
    p_red_cards_away: snapshot.redCardsAway,
    p_first_half_score_home: snapshot.firstHalfScoreHome,
    p_first_half_score_away: snapshot.firstHalfScoreAway,
    p_incidents: snapshot.incidents,
    p_last_poll_ok: snapshot.ok,
    p_poll_interval_seconds: 20,
  })

  if (rpcError) {
    const isDuplicate = rpcError.code === '23505' || (rpcError.message ?? '').includes('Ya estás siguiendo')
    return json({ error: isDuplicate ? 'duplicate_match' : 'insert_failed', message: rpcError.message }, isDuplicate ? 409 : 500)
  }

  const { data: created, error: fetchAfterError } = await supabase
    .from('live_matches')
    .select('*')
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
