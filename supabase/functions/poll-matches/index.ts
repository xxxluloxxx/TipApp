// =============================================================================
// poll-matches
// -----------------------------------------------------------------------------
// Disparada por pg_cron (20260717150900_schedule_poll_matches_cron.sql) vía
// net.http_post cada 20s. Usa SERVICE_ROLE (cruza usuarios, no hay sesión
// de un usuario particular en un cron) — autenticada con un bearer secreto
// propio (CRON_SECRET, distinto de cualquier JWT de Supabase) para que
// nadie más pueda invocar este endpoint público y forzar polls fuera de
// horario / gastar la cuota del feed no oficial de Flashscore. La función
// se despliega con --no-verify-jwt (ver comentario en el comando de
// deploy) porque el llamador no es un usuario con sesión de Supabase.
//
// Por cada partido con state='monitoring' y next_poll_at<=now(): pollea los
// 3 feeds (ETag condicional — si un feed responde 304 se conservan los
// campos derivados de ESE feed tal como estaban, ver PLAN.md sección 6.3),
// parsea, compara contra el snapshot guardado, actualiza la fila (snapshot +
// intervalo adaptativo + next_poll_at + last_polled_at/last_poll_ok), evalúa
// cada leg de cupón asociado (motor de reglas, decisión temprana) y dispara
// Web Push cuando corresponde (prioridades fijas: gol/tarjeta/leg decidido =
// alta; córner/remate a puerta = normal). Marca 'finished' automáticamente
// cuando el feed indica partido terminado (DA=3/DB=3), dejando de pollearlo
// (el filtro state='monitoring' de la query principal ya lo excluye de la
// próxima corrida).
//
// Rediseño multi-partido (20260718): bet_slip_legs ya NO cuelga directo de
// live_matches (match_id) -- pasa por bet_slip_matches (un partido dentro
// de un cupón). Un mismo live_match puede estar referenciado por
// bet_slip_matches de VARIOS cupones distintos (find-or-create de
// create_bet_slip, ver 20260718100500_create_bet_slip_function.sql) -- la
// query de legs de abajo ya no filtra por match_id=match.id directo, sino
// por bet_slip_matches.live_match_id=match.id vía embed + !inner (fuerza
// join interno para poder filtrar sobre la tabla embebida), trayendo TODOS
// los legs de TODOS los cupones que referencian este partido en una sola
// llamada.
// =============================================================================
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { fetchFeed } from '../_shared/flashscoreClient.ts'
import { epochToIso, parseDetail, parseIncidents, parseStats } from '../_shared/flashscoreFeed.ts'
import { evaluateCondition, type LegStatus, type MatchSnapshotForRules } from '../_shared/betRuleEngine.ts'
import type { MarketType } from '../_shared/marketMapper.ts'
import { sendPush, type PushSubscriptionRow } from '../_shared/webpush.ts'

const BASE_INTERVAL = 20
const IDLE_GROWTH = 1.5
const IDLE_MAX = 120
const ERROR_MAX = 180
const BATCH_LIMIT = 100

interface LiveMatchRow {
  id: string
  user_id: string
  flashscore_mid: string
  home_team: string | null
  away_team: string | null
  state: string
  score_home: number | null
  score_away: number | null
  stage_code: number | null
  corners_home: number | null
  corners_away: number | null
  shots_on_target_home: number | null
  shots_on_target_away: number | null
  clear_chances_home: number | null
  clear_chances_away: number | null
  yellow_cards_home: number | null
  yellow_cards_away: number | null
  red_cards_home: number | null
  red_cards_away: number | null
  first_half_score_home: number | null
  first_half_score_away: number | null
  incidents: unknown[]
  poll_interval_seconds: number
  etag_dc: string | null
  etag_df_st: string | null
  etag_df_su: string | null
}

interface BetSlipLegRow {
  id: string
  market_type: MarketType
  threshold: number | null
  selector: string | null
  status: LegStatus
  selection_label: string
  market_label: string
  bet_slip_match_id: string
}

interface NotificationEvent {
  title: string
  body: string
  urgent: boolean
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get('CRON_SECRET')
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const fsign = Deno.env.get('FLASHSCORE_FSIGN') ?? 'SW9D1eZo'

  const { data: matches, error: fetchError } = await supabase
    .from('live_matches')
    .select('*')
    .eq('state', 'monitoring')
    .lte('next_poll_at', new Date().toISOString())
    .limit(BATCH_LIMIT)

  if (fetchError) {
    console.error('poll-matches: no se pudo leer live_matches', fetchError)
    return new Response(JSON.stringify({ error: 'fetch_failed', message: fetchError.message }), { status: 500 })
  }

  let processed = 0
  let errored = 0

  for (const match of (matches ?? []) as LiveMatchRow[]) {
    try {
      await pollOneMatch(supabase, match, fsign)
      processed++
    } catch (e) {
      console.error(`poll-matches: fallo procesando match ${match.id}`, e)
      errored++
      const nextInterval = Math.min(Math.max(match.poll_interval_seconds, BASE_INTERVAL) * 2, ERROR_MAX)
      await supabase
        .from('live_matches')
        .update({
          last_polled_at: new Date().toISOString(),
          last_poll_ok: false,
          last_poll_error: ((e as Error).message ?? 'error desconocido').slice(0, 500),
          poll_interval_seconds: nextInterval,
          next_poll_at: new Date(Date.now() + nextInterval * 1000).toISOString(),
        })
        .eq('id', match.id)
    }
  }

  return new Response(JSON.stringify({ processed, errored, total: (matches ?? []).length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})

async function pollOneMatch(supabase: SupabaseClient, match: LiveMatchRow, fsign: string) {
  const [dc, dfSt, dfSu] = await Promise.all([
    fetchFeed(match.flashscore_mid, 'dc', fsign, match.etag_dc),
    fetchFeed(match.flashscore_mid, 'df_st', fsign, match.etag_df_st),
    fetchFeed(match.flashscore_mid, 'df_su', fsign, match.etag_df_su),
  ])

  // Campos derivados de dc (marcador/estado/reloj) — si 304, se conservan
  // los valores ya guardados en la fila (el feed no cambió).
  let scoreHome = match.score_home
  let scoreAway = match.score_away
  let statusId: string | null = null
  let stageCode = match.stage_code
  let stageAnchorTs: string | null = null
  let scheduledKickoffTs: string | null = null
  if (!dc.notModified) {
    const detail = parseDetail(dc.body)
    scoreHome = detail.scoreHome
    scoreAway = detail.scoreAway
    statusId = detail.statusId
    stageCode = detail.stageCode
    stageAnchorTs = epochToIso(detail.stageAnchorEpoch)
    scheduledKickoffTs = epochToIso(detail.scheduledKickoffEpoch)
  }

  let cornersHome = match.corners_home
  let cornersAway = match.corners_away
  let shotsOnTargetHome = match.shots_on_target_home
  let shotsOnTargetAway = match.shots_on_target_away
  let clearChancesHome = match.clear_chances_home
  let clearChancesAway = match.clear_chances_away
  if (!dfSt.notModified) {
    const stats = parseStats(dfSt.body)
    cornersHome = stats.cornersHome
    cornersAway = stats.cornersAway
    shotsOnTargetHome = stats.shotsOnTargetHome
    shotsOnTargetAway = stats.shotsOnTargetAway
    clearChancesHome = stats.clearChancesHome
    clearChancesAway = stats.clearChancesAway
  }

  let yellowCardsHome = match.yellow_cards_home ?? 0
  let yellowCardsAway = match.yellow_cards_away ?? 0
  let redCardsHome = match.red_cards_home ?? 0
  let redCardsAway = match.red_cards_away ?? 0
  let firstHalfScoreHome = match.first_half_score_home ?? 0
  let firstHalfScoreAway = match.first_half_score_away ?? 0
  let incidents: unknown[] = match.incidents ?? []
  if (!dfSu.notModified) {
    const inc = parseIncidents(dfSu.body)
    yellowCardsHome = inc.yellowHome
    yellowCardsAway = inc.yellowAway
    redCardsHome = inc.redHome
    redCardsAway = inc.redAway
    firstHalfScoreHome = inc.firstHalfHome
    firstHalfScoreAway = inc.firstHalfAway
    incidents = inc.events
  }

  const changed =
    scoreHome !== match.score_home || scoreAway !== match.score_away ||
    stageCode !== match.stage_code ||
    cornersHome !== match.corners_home || cornersAway !== match.corners_away ||
    shotsOnTargetHome !== match.shots_on_target_home || shotsOnTargetAway !== match.shots_on_target_away ||
    clearChancesHome !== match.clear_chances_home || clearChancesAway !== match.clear_chances_away ||
    yellowCardsHome !== match.yellow_cards_home || yellowCardsAway !== match.yellow_cards_away ||
    redCardsHome !== match.red_cards_home || redCardsAway !== match.red_cards_away

  const isFinished = statusId === '3' || stageCode === 3

  const nextInterval = Math.round(changed ? BASE_INTERVAL : Math.min(match.poll_interval_seconds * IDLE_GROWTH, IDLE_MAX))
  const nowIso = new Date().toISOString()

  const updatePayload: Record<string, unknown> = {
    score_home: scoreHome,
    score_away: scoreAway,
    stage_code: stageCode,
    corners_home: cornersHome,
    corners_away: cornersAway,
    shots_on_target_home: shotsOnTargetHome,
    shots_on_target_away: shotsOnTargetAway,
    clear_chances_home: clearChancesHome,
    clear_chances_away: clearChancesAway,
    yellow_cards_home: yellowCardsHome,
    yellow_cards_away: yellowCardsAway,
    red_cards_home: redCardsHome,
    red_cards_away: redCardsAway,
    first_half_score_home: firstHalfScoreHome,
    first_half_score_away: firstHalfScoreAway,
    incidents,
    last_polled_at: nowIso,
    last_poll_ok: true,
    last_poll_error: null,
    poll_interval_seconds: nextInterval,
    next_poll_at: new Date(Date.now() + nextInterval * 1000).toISOString(),
    etag_dc: dc.etag,
    etag_df_st: dfSt.etag,
    etag_df_su: dfSu.etag,
    state: isFinished ? 'finished' : match.state,
  }
  if (!dc.notModified) {
    updatePayload.stage_anchor_ts = stageAnchorTs
    updatePayload.scheduled_kickoff_ts = scheduledKickoffTs
  }
  if (changed) updatePayload.last_changed_at = nowIso

  await supabase.from('live_matches').update(updatePayload).eq('id', match.id)

  // --- Notificaciones de stats/goles/tarjetas (prioridades fijas, docs/features/live-matches-ux.md sección 6.5) ---
  const events: NotificationEvent[] = []
  const homeLabel = match.home_team ?? 'Local'
  const awayLabel = match.away_team ?? 'Visitante'
  if ((scoreHome ?? 0) > (match.score_home ?? 0) || (scoreAway ?? 0) > (match.score_away ?? 0)) {
    events.push({ title: '⚽ Gol', body: `${homeLabel} ${scoreHome ?? 0}-${scoreAway ?? 0} ${awayLabel}`, urgent: true })
  }
  if ((yellowCardsHome ?? 0) > (match.yellow_cards_home ?? 0)) {
    events.push({ title: '🟨 Tarjeta amarilla', body: homeLabel, urgent: true })
  }
  if ((yellowCardsAway ?? 0) > (match.yellow_cards_away ?? 0)) {
    events.push({ title: '🟨 Tarjeta amarilla', body: awayLabel, urgent: true })
  }
  if ((redCardsHome ?? 0) > (match.red_cards_home ?? 0)) {
    events.push({ title: '🟥 Tarjeta roja', body: homeLabel, urgent: true })
  }
  if ((redCardsAway ?? 0) > (match.red_cards_away ?? 0)) {
    events.push({ title: '🟥 Tarjeta roja', body: awayLabel, urgent: true })
  }
  const cornersTotalBefore = (match.corners_home ?? 0) + (match.corners_away ?? 0)
  const cornersTotalAfter = (cornersHome ?? 0) + (cornersAway ?? 0)
  if (cornersTotalAfter > cornersTotalBefore) {
    events.push({ title: '🚩 Córner', body: `${homeLabel} ${cornersHome ?? 0}-${cornersAway ?? 0} ${awayLabel}`, urgent: false })
  }
  const shotsTotalBefore = (match.shots_on_target_home ?? 0) + (match.shots_on_target_away ?? 0)
  const shotsTotalAfter = (shotsOnTargetHome ?? 0) + (shotsOnTargetAway ?? 0)
  if (shotsTotalAfter > shotsTotalBefore) {
    events.push({
      title: '🎯 Remate a puerta',
      body: `${homeLabel} ${shotsOnTargetHome ?? 0}-${shotsOnTargetAway ?? 0} ${awayLabel}`,
      urgent: false,
    })
  }

  // --- Motor de reglas: evaluar cada leg pendiente contra el snapshot nuevo ---
  // bet_slip_legs ya no tiene match_id -- se filtra vía el embed de
  // bet_slip_matches (!inner fuerza join interno para que el .eq() sobre la
  // tabla embebida realmente filtre las filas, no solo el objeto anidado).
  // Trae los legs de TODOS los cupones que tengan un bet_slip_match
  // apuntando a este live_match (mismo partido puede estar en 2+ cupones).
  const { data: legs } = await supabase
    .from('bet_slip_legs')
    .select('id, market_type, threshold, selector, status, selection_label, market_label, bet_slip_match_id, bet_slip_matches!inner(live_match_id)')
    .eq('bet_slip_matches.live_match_id', match.id)

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

  for (const leg of (legs ?? []) as BetSlipLegRow[]) {
    if (leg.status === 'won' || leg.status === 'lost' || leg.status === 'not_monitorable') continue
    const newStatus = evaluateCondition(
      { marketType: leg.market_type, threshold: leg.threshold, selector: leg.selector },
      snapshotForRules,
    )
    if (newStatus !== leg.status) {
      await supabase.from('bet_slip_legs').update({ status: newStatus }).eq('id', leg.id)
      if (newStatus === 'won' || newStatus === 'lost') {
        events.push({
          title: newStatus === 'won' ? '✅ Selección ganada' : '❌ Selección perdida',
          body: `${leg.selection_label} · ${leg.market_label}`,
          urgent: true,
        })
      }
    }
  }

  if (events.length > 0) {
    await notifyUser(supabase, match.user_id, match.id, events)
  }
}

async function notifyUser(supabase: SupabaseClient, userId: string, matchId: string, events: NotificationEvent[]) {
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)

  if (!subs || subs.length === 0) return

  for (const sub of subs as (PushSubscriptionRow & { id: string })[]) {
    for (const event of events) {
      const alive = await sendPush(sub, { title: event.title, body: event.body, matchId, urgent: event.urgent })
      if (!alive) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id)
        break // esta suscripción ya no sirve, no seguir mandándole el resto de eventos de esta corrida
      }
    }
  }
}
