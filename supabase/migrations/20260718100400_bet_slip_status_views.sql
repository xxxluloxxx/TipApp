-- =============================================================================
-- bet_slip_status_views
-- -----------------------------------------------------------------------------
-- Estado derivado de un cupón multi-partido -- NUNCA cacheado en una
-- columna (mismo criterio que debt_balances/account_balances de este mismo
-- proyecto), siempre calculado acá. with (security_invoker = true) en
-- ambas vistas: heredan las policies select_own de bet_slips/
-- bet_slip_matches/bet_slip_legs/live_matches de quien consulta, sin
-- bypass de RLS.
--
-- Dos niveles, un nivel por vista (mismo criterio que exponer
-- account_balances Y debt_balances por separado, no una sola vista
-- monolítica):
--
--   bet_slip_match_status: 1 fila por bet_slip_match (un partido dentro de
--   un cupón) -- status de 4 valores (spec del Product Owner, no se
--   rediscute):
--     'lost' si CUALQUIER leg del grupo está 'lost'
--     'won'  si TODOS los legs del grupo están 'won' (y hay al menos 1 leg
--            -- un grupo sin legs nunca es 'won', ver el "count(l.id) > 0"
--            explícito abajo, si no un grupo vacío calificaría
--            vacuamente)
--     'live' si no aplica lo anterior y el live_match vinculado está EN
--            CANCHA ahora mismo -- heurística elegida: stage_code in
--            (12, 38, 13) (1ª parte / descanso / 2ª parte, ver comment on
--            column live_matches.stage_code). Deliberadamente NO se mira
--            live_matches.state (estado de MONITOREO: pausado/finalizado
--            por el usuario) -- 'live' acá describe la realidad del
--            partido en cancha, no si el usuario sigue polleándolo.
--     'pending' en cualquier otro caso -- incluye grupos sin
--            live_match_id resuelto (nunca van a poder evaluarse) y
--            partidos que todavía no arrancaron.
--
--   bet_slip_summary: 1 fila por bet_slip (el cupón completo) -- status de
--   3 valores agregando los bet_slip_match de ese cupón ('lost' si
--   cualquiera es 'lost'; 'won' solo si TODOS son 'won'; si no,
--   'in_progress'), más los conteos por status que el "anillo" de 4
--   estados del frontend necesita (Ganados/En juego/Pendientes/Perdidos,
--   "X/Y acertados" = won_matches/match_count) y total_odds/
--   potential_winnings ya resueltos server-side.
--
--   total_odds = producto de bet_slip_legs.odds de TODOS los legs del
--   cupón (a través de bet_slip_matches). Postgres no tiene un agregado
--   PRODUCT nativo -- se usa exp(sum(ln(odds))) (válido porque odds > 0 ya
--   está reforzado por el check de la columna). Si CUALQUIER leg del
--   cupón tiene odds NULL (nunca se capturó, p.ej. legs backfilleados de
--   antes del rediseño), total_odds sale NULL para el cupón entero -- no
--   se asume 1 por cada leg sin cuota, sería mostrar una cuota total
--   falsa/subestimada. legs_missing_odds expone cuántos legs faltan para
--   que el frontend pueda explicar por qué no hay cuota total en vez de
--   mostrar un guion sin contexto.
--
--   potential_winnings = stake_amount * total_odds, calculado ACÁ (no en
--   el frontend) por el mismo principio de "el frontend nunca deriva un
--   número que ya puede pedir resuelto" ya establecido en el resto del
--   esquema -- aunque en este caso particular el frontend ya va a tener
--   ambos valores en memoria (son 2 columnas de la misma fila), calcularlo
--   en la vista evita que la fórmula se repita/desincronice entre
--   cualquier pantalla que la necesite. NULL si falta cualquiera de los
--   dos factores (stake_amount o total_odds).
-- =============================================================================

create view public.bet_slip_match_status
with (security_invoker = true) as
select
  bm.id as bet_slip_match_id,
  bm.bet_slip_id,
  bm.user_id,
  bm.live_match_id,
  count(l.id) as leg_count,
  count(*) filter (where l.status = 'won') as won_legs,
  count(*) filter (where l.status = 'lost') as lost_legs,
  count(*) filter (where l.status = 'pending') as pending_legs,
  count(*) filter (where l.status = 'not_monitorable') as not_monitorable_legs,
  case
    when count(*) filter (where l.status = 'lost') > 0 then 'lost'
    when count(l.id) > 0 and count(*) filter (where l.status = 'won') = count(l.id) then 'won'
    when lm.stage_code in (12, 38, 13) then 'live'
    else 'pending'
  end as status
from public.bet_slip_matches bm
left join public.bet_slip_legs l on l.bet_slip_match_id = bm.id
left join public.live_matches lm on lm.id = bm.live_match_id
group by bm.id, bm.bet_slip_id, bm.user_id, bm.live_match_id, lm.stage_code;

comment on view public.bet_slip_match_status is 'Status derivado de un bet_slip_match (un partido dentro de un cupón), NUNCA cacheado -- 4 valores: lost/won/live/pending (ver comment de cabecera del archivo para el criterio exacto de cada uno). security_invoker=true: hereda RLS de bet_slip_matches/bet_slip_legs/live_matches de quien consulta.';

create view public.bet_slip_summary
with (security_invoker = true) as
with match_status as (
  select
    bm.id as bet_slip_match_id,
    bm.bet_slip_id,
    case
      when count(*) filter (where l.status = 'lost') > 0 then 'lost'
      when count(l.id) > 0 and count(*) filter (where l.status = 'won') = count(l.id) then 'won'
      when lm.stage_code in (12, 38, 13) then 'live'
      else 'pending'
    end as status
  from public.bet_slip_matches bm
  left join public.bet_slip_legs l on l.bet_slip_match_id = bm.id
  left join public.live_matches lm on lm.id = bm.live_match_id
  group by bm.id, bm.bet_slip_id, lm.stage_code
),
odds_agg as (
  select
    bm.bet_slip_id,
    count(l.id) as leg_count,
    count(*) filter (where l.odds is null) as legs_missing_odds,
    case
      when count(l.id) > 0 and bool_and(l.odds is not null)
        then exp(sum(ln(l.odds)))
      else null
    end as total_odds
  from public.bet_slip_matches bm
  join public.bet_slip_legs l on l.bet_slip_match_id = bm.id
  group by bm.bet_slip_id
)
select
  bs.id as bet_slip_id,
  bs.user_id,
  bs.stake_amount,
  count(ms.bet_slip_match_id) as match_count,
  count(*) filter (where ms.status = 'won') as won_matches,
  count(*) filter (where ms.status = 'lost') as lost_matches,
  count(*) filter (where ms.status = 'live') as live_matches_count,
  count(*) filter (where ms.status = 'pending') as pending_matches,
  case
    when count(*) filter (where ms.status = 'lost') > 0 then 'lost'
    when count(ms.bet_slip_match_id) > 0 and count(*) filter (where ms.status = 'won') = count(ms.bet_slip_match_id) then 'won'
    else 'in_progress'
  end as status,
  coalesce(oa.leg_count, 0) as leg_count,
  coalesce(oa.legs_missing_odds, 0) as legs_missing_odds,
  oa.total_odds,
  case
    when bs.stake_amount is not null and oa.total_odds is not null
      then bs.stake_amount * oa.total_odds
    else null
  end as potential_winnings
from public.bet_slips bs
left join match_status ms on ms.bet_slip_id = bs.id
left join odds_agg oa on oa.bet_slip_id = bs.id
group by bs.id, bs.user_id, bs.stake_amount, oa.leg_count, oa.legs_missing_odds, oa.total_odds;

comment on view public.bet_slip_summary is 'Estado + cuota total + ganancia potencial de un cupón completo, NUNCA cacheado. status: lost/won/in_progress (ver criterio en cabecera del archivo). total_odds = producto de odds de TODOS los legs del cupón (exp(sum(ln(odds))) -- Postgres no tiene PRODUCT nativo), NULL si falta la cuota de cualquier leg (nunca asume 1 por leg sin cuota). potential_winnings = stake_amount * total_odds, NULL si falta cualquiera de los dos. security_invoker=true: hereda RLS de bet_slips/bet_slip_matches/bet_slip_legs/live_matches de quien consulta.';
