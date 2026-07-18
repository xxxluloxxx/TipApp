// =============================================================================
// create-bet-slip
// -----------------------------------------------------------------------------
// Alta de un cupón multi-partido (rediseño 20260718 -- ver
// supabase/migrations/20260718100500_create_bet_slip_function.sql). Recibe
// { stakeAmount?, reference?, groups: [{ matchId?, homeTeam?, awayTeam?,
// competition?, legs: [...] }] } del frontend YA AUTENTICADO -- usa el JWT
// del usuario que llama (nunca service_role), mismo criterio que
// add-match/create_debt. `reference` (fast-follow 20260718100700): texto
// libre y opcional, ej. "Cupón #25481" leído por el OCR client-side si
// aparece impreso en la foto -- se pasa tal cual a create_bet_slip, null si
// no vino o vino vacío.
//
// Reemplaza el único camino que antes tenía add-match para crear
// bet_slip_legs (vía create_live_match p_legs, ya eliminado en
// 20260718100600) -- esta es ahora la ÚNICA forma de crear predicciones,
// sea un cupón de 1 partido o de varios.
//
// Por cada grupo con matchId:
//   1. Chequea si el usuario YA está trackeando ese flashscore_mid (find,
//      optimización -- evita gastar cuota del feed no oficial de Flashscore
//      si el partido ya está siendo polleado desde otro cupón/alta suelta).
//      Si existe, se usa su snapshot YA GUARDADO para evaluar los legs.
//   2. Si NO existe, hace el primer poll sincrónico completo (mismo helper
//      _shared/matchSnapshot.ts que usa add-match) para tener un snapshot
//      fresco contra el que evaluar los legs desde el arranque.
// Grupos SIN matchId (el usuario no encontró/no tipeó un partido real) NO
// disparan ningún fetch -- sus legs se evalúan como 'not_monitorable' (no
// hay snapshot posible), reforzado además como backstop dentro de la RPC
// create_bet_slip por si esta función se equivoca.
//
// El create/creación real (bet_slips + bet_slip_matches + bet_slip_legs +
// el find-or-create DEFINITIVO de live_matches, que corre atómico contra
// la unique(user_id, flashscore_mid) real) vive TODO dentro de la RPC
// create_bet_slip -- esta función solo resuelve datos de red (HTTP) que
// plpgsql no puede hacer, arma el payload, y llama la RPC una sola vez.
// =============================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, handlePreflight } from '../_shared/cors.ts'
import { fetchInitialSnapshot, syntheticFlashscoreUrl } from '../_shared/matchSnapshot.ts'
import { evaluateCondition, type MatchSnapshotForRules } from '../_shared/betRuleEngine.ts'
import type { MarketType } from '../_shared/marketMapper.ts'

interface IncomingLeg {
  marketType: MarketType
  marketLabel: string
  selectionLabel: string
  threshold: number | null
  selector: string | null
  odds: number | null
  rawText: string | null
}

interface IncomingGroup {
  matchId?: string
  homeTeam?: string
  awayTeam?: string
  competition?: string
  legs: IncomingLeg[]
}

interface CreateBetSlipBody {
  stakeAmount?: number | null
  reference?: string | null
  groups: IncomingGroup[]
}

interface ExistingMatchRow {
  id: string
  score_home: number | null
  score_away: number | null
  stage_code: number | null
  corners_home: number | null
  corners_away: number | null
  yellow_cards_home: number | null
  yellow_cards_away: number | null
  red_cards_home: number | null
  red_cards_away: number | null
  first_half_score_home: number | null
  first_half_score_away: number | null
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

  let body: CreateBetSlipBody
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  if (!Array.isArray(body.groups) || body.groups.length === 0) {
    return json({ error: 'missing_groups' }, 400)
  }

  const fsign = Deno.env.get('FLASHSCORE_FSIGN') ?? 'SW9D1eZo'

  const groupPayloads: Record<string, unknown>[] = []

  for (const group of body.groups) {
    const hasMatchId = typeof group.matchId === 'string' && group.matchId.length > 0
    let snapshotForRules: MatchSnapshotForRules | null = null
    let matchFields: Record<string, unknown> = {}

    if (hasMatchId) {
      const mid = group.matchId as string
      const flashscoreUrl = syntheticFlashscoreUrl(mid)

      const { data: existing } = await supabase
        .from('live_matches')
        .select(
          'id, score_home, score_away, stage_code, corners_home, corners_away, yellow_cards_home, yellow_cards_away, red_cards_home, red_cards_away, first_half_score_home, first_half_score_away',
        )
        .eq('flashscore_mid', mid)
        .maybeSingle()

      if (existing) {
        const row = existing as ExistingMatchRow
        // Ya trackeado (desde este cupón u otro) -- se reusa el snapshot ya
        // guardado, sin gastar otra llamada al feed. statusId no se
        // persiste como columna propia en live_matches -- stage_code=3 es
        // equivalente ("finalizado", mismo criterio que poll-matches usa
        // para decidir isFinished).
        snapshotForRules = {
          statusId: row.stage_code === 3 ? '3' : null,
          stageCode: row.stage_code,
          scoreHome: row.score_home,
          scoreAway: row.score_away,
          cornersHome: row.corners_home,
          cornersAway: row.corners_away,
          yellowHome: row.yellow_cards_home,
          yellowAway: row.yellow_cards_away,
          redHome: row.red_cards_home,
          redAway: row.red_cards_away,
          firstHalfHome: row.first_half_score_home,
          firstHalfAway: row.first_half_score_away,
        }
        // Sin snapshot fields acá a propósito: la RPC hace
        // insert ... on conflict (user_id, flashscore_mid) do update set
        // updated_at = now() -- los valores del insert se descartan en el
        // conflicto, así que mandar null no pisa nada del snapshot real ya
        // guardado. Solo flashscore_mid/flashscore_url son obligatorios
        // (NOT NULL en la tabla).
        matchFields = { flashscore_mid: mid, flashscore_url: flashscoreUrl }
      } else {
        const namesProvided = typeof group.homeTeam === 'string' && group.homeTeam.length > 0 &&
          typeof group.awayTeam === 'string' && group.awayTeam.length > 0

        const snapshot = await fetchInitialSnapshot(
          mid,
          flashscoreUrl,
          fsign,
          namesProvided,
          namesProvided ? (group.homeTeam as string) : null,
          namesProvided ? (group.awayTeam as string) : null,
          namesProvided ? (typeof group.competition === 'string' && group.competition.length > 0 ? group.competition : null) : null,
        )

        snapshotForRules = {
          statusId: snapshot.statusId,
          stageCode: snapshot.stageCode,
          scoreHome: snapshot.scoreHome,
          scoreAway: snapshot.scoreAway,
          cornersHome: snapshot.cornersHome,
          cornersAway: snapshot.cornersAway,
          yellowHome: snapshot.yellowCardsHome,
          yellowAway: snapshot.yellowCardsAway,
          redHome: snapshot.redCardsHome,
          redAway: snapshot.redCardsAway,
          firstHalfHome: snapshot.firstHalfScoreHome,
          firstHalfAway: snapshot.firstHalfScoreAway,
        }

        matchFields = {
          flashscore_mid: mid,
          flashscore_url: flashscoreUrl,
          home_team: snapshot.homeTeam,
          away_team: snapshot.awayTeam,
          competition: snapshot.competition,
          score_home: snapshot.scoreHome,
          score_away: snapshot.scoreAway,
          stage_code: snapshot.stageCode,
          stage_anchor_ts: snapshot.stageAnchorTs,
          scheduled_kickoff_ts: snapshot.scheduledKickoffTs,
          corners_home: snapshot.cornersHome,
          corners_away: snapshot.cornersAway,
          shots_on_target_home: snapshot.shotsOnTargetHome,
          shots_on_target_away: snapshot.shotsOnTargetAway,
          clear_chances_home: snapshot.clearChancesHome,
          clear_chances_away: snapshot.clearChancesAway,
          yellow_cards_home: snapshot.yellowCardsHome,
          yellow_cards_away: snapshot.yellowCardsAway,
          red_cards_home: snapshot.redCardsHome,
          red_cards_away: snapshot.redCardsAway,
          first_half_score_home: snapshot.firstHalfScoreHome,
          first_half_score_away: snapshot.firstHalfScoreAway,
          incidents: snapshot.incidents,
          last_poll_ok: snapshot.ok,
          poll_interval_seconds: 20,
        }
      }
    }

    const legsPayload = (group.legs ?? []).map((leg) => {
      const marketType = leg.marketType ?? 'unknown'
      // Sin snapshot (grupo no resolvió a un partido real) => siempre
      // not_monitorable, nunca puede evaluarse won/lost (poll-matches solo
      // procesa legs de bet_slip_matches con live_match_id resuelto). Con
      // snapshot, se evalúa igual que add-match evaluaba antes del
      // rediseño (decisión temprana posible desde el arranque).
      const status = snapshotForRules
        ? evaluateCondition({ marketType, threshold: leg.threshold ?? null, selector: leg.selector ?? null }, snapshotForRules)
        : 'not_monitorable'
      return {
        market_type: marketType,
        market_label: leg.marketLabel ?? '',
        selection_label: leg.selectionLabel ?? '',
        threshold: leg.threshold,
        selector: leg.selector,
        odds: leg.odds,
        raw_text: leg.rawText,
        status,
      }
    })

    groupPayloads.push({ ...matchFields, legs: legsPayload })
  }

  const { data: slipId, error: rpcError } = await supabase.rpc('create_bet_slip', {
    p_stake_amount: typeof body.stakeAmount === 'number' ? body.stakeAmount : null,
    p_groups: groupPayloads,
    p_reference: typeof body.reference === 'string' && body.reference.length > 0 ? body.reference : null,
  })

  if (rpcError) {
    return json({ error: 'insert_failed', message: rpcError.message }, 500)
  }

  const { data: created, error: fetchAfterError } = await supabase
    .from('bet_slips')
    .select('*, bet_slip_matches(*, live_matches(*), bet_slip_legs(*))')
    .eq('id', slipId as string)
    .single()

  if (fetchAfterError) {
    return json({ error: 'fetch_after_insert_failed', message: fetchAfterError.message }, 500)
  }

  return json({ betSlip: created }, 201)
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
