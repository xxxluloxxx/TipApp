-- =============================================================================
-- bet_slips_reference
-- -----------------------------------------------------------------------------
-- Fast-follow pedido por el Product Owner tras revisar el esquema final del
-- rediseño multi-partido contra docs/features/live-coupons-ux.md sección
-- 6.1: `bet_slips` necesita un campo `reference` (texto libre, opcional --
-- p.ej. "Cupón #25481", leído por el OCR del cupón si aparece impreso; si
-- no está, el frontend ya tiene un fallback visual "Cupón" genérico). Sin
-- constraint de formato a propósito -- es texto crudo/opcional, no un
-- identificador estructurado que la BD deba validar.
--
-- Toca 3 lugares que ya asumían el esquema de bet_slips SIN esta columna:
--   1. La columna en sí (alter table).
--   2. create_bet_slip (RPC de alta atómica) -- gana un p_reference nuevo.
--      DROP + CREATE (no CREATE OR REPLACE): agregar un parámetro cambia la
--      lista de tipos de argumentos, que en Postgres es parte de la
--      identidad de la función -- un CREATE OR REPLACE con una firma de
--      argumentos distinta NO reemplaza la función existente, crea un
--      OVERLOAD nuevo y deja el de 2 argumentos huérfano (y ambiguo para
--      llamadas con notación de argumentos nombrados, que es como
--      supabase-js invoca .rpc()). Mismo criterio ya usado en
--      20260718100600_create_live_match_drop_legs_support.sql.
--   3. bet_slip_summary (vista) -- selecciona columnas explícitas de
--      bet_slips, no `select *`, así que reference no aparecía sin este
--      cambio. Se recrea completa (drop+create, no CREATE OR REPLACE VIEW)
--      para poder ubicar la columna nueva junto a stake_amount en el
--      select list en vez de forzarla al final (CREATE OR REPLACE VIEW solo
--      permite *agregar* columnas al final, no reordenar).
-- =============================================================================

alter table public.bet_slips add column reference text;

comment on column public.bet_slips.reference is 'Referencia/número de cupón, texto libre y opcional (ej. "Cupón #25481") -- leído por el OCR client-side si aparece impreso en la foto, o NULL si no se detectó/no aplica. Sin constraint de formato: es texto crudo, no un identificador que la BD valide. Ver docs/features/live-coupons-ux.md sección 6.1.';

-- --- RPC: gana p_reference (tercer parámetro, con default) -----------------
drop function public.create_bet_slip(numeric, jsonb);

create function public.create_bet_slip(
  p_stake_amount numeric default null,
  p_groups jsonb default '[]'::jsonb,
  p_reference text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_slip_id uuid;
  v_group jsonb;
  v_leg jsonb;
  v_live_match_id uuid;
  v_bet_slip_match_id uuid;
  v_flashscore_mid text;
  v_poll_interval integer;
begin
  if v_user_id is null then
    raise exception 'create_bet_slip requiere un usuario autenticado';
  end if;

  insert into public.bet_slips (user_id, stake_amount, reference)
  values (v_user_id, p_stake_amount, nullif(p_reference, ''))
  returning id into v_slip_id;

  for v_group in select * from jsonb_array_elements(coalesce(p_groups, '[]'::jsonb))
  loop
    v_flashscore_mid := nullif(v_group ->> 'flashscore_mid', '');
    v_live_match_id := null;

    if v_flashscore_mid is not null then
      v_poll_interval := coalesce((v_group ->> 'poll_interval_seconds')::integer, 20);

      insert into public.live_matches (
        user_id, flashscore_mid, flashscore_url, home_team, away_team, competition,
        score_home, score_away, stage_code, stage_anchor_ts, scheduled_kickoff_ts,
        corners_home, corners_away, shots_on_target_home, shots_on_target_away,
        clear_chances_home, clear_chances_away, yellow_cards_home, yellow_cards_away,
        red_cards_home, red_cards_away, first_half_score_home, first_half_score_away,
        incidents, last_polled_at, last_poll_ok, poll_interval_seconds, next_poll_at,
        last_changed_at
      ) values (
        v_user_id,
        v_flashscore_mid,
        coalesce(nullif(v_group ->> 'flashscore_url', ''), 'https://www.flashscore.com.ar/?mid=' || v_flashscore_mid),
        nullif(v_group ->> 'home_team', ''),
        nullif(v_group ->> 'away_team', ''),
        nullif(v_group ->> 'competition', ''),
        nullif(v_group ->> 'score_home', '')::integer,
        nullif(v_group ->> 'score_away', '')::integer,
        nullif(v_group ->> 'stage_code', '')::integer,
        nullif(v_group ->> 'stage_anchor_ts', '')::timestamptz,
        nullif(v_group ->> 'scheduled_kickoff_ts', '')::timestamptz,
        nullif(v_group ->> 'corners_home', '')::integer,
        nullif(v_group ->> 'corners_away', '')::integer,
        nullif(v_group ->> 'shots_on_target_home', '')::integer,
        nullif(v_group ->> 'shots_on_target_away', '')::integer,
        nullif(v_group ->> 'clear_chances_home', '')::integer,
        nullif(v_group ->> 'clear_chances_away', '')::integer,
        nullif(v_group ->> 'yellow_cards_home', '')::integer,
        nullif(v_group ->> 'yellow_cards_away', '')::integer,
        nullif(v_group ->> 'red_cards_home', '')::integer,
        nullif(v_group ->> 'red_cards_away', '')::integer,
        nullif(v_group ->> 'first_half_score_home', '')::integer,
        nullif(v_group ->> 'first_half_score_away', '')::integer,
        coalesce(v_group -> 'incidents', '[]'::jsonb),
        now(),
        coalesce((v_group ->> 'last_poll_ok')::boolean, true),
        v_poll_interval,
        now() + make_interval(secs => v_poll_interval),
        now()
      )
      on conflict (user_id, flashscore_mid)
      do update set updated_at = now()
      returning id into v_live_match_id;
    end if;

    insert into public.bet_slip_matches (user_id, bet_slip_id, live_match_id)
    values (v_user_id, v_slip_id, v_live_match_id)
    returning id into v_bet_slip_match_id;

    for v_leg in select * from jsonb_array_elements(coalesce(v_group -> 'legs', '[]'::jsonb))
    loop
      insert into public.bet_slip_legs (
        user_id, bet_slip_match_id, market_type, market_label, selection_label,
        threshold, selector, odds, status, raw_text
      ) values (
        v_user_id,
        v_bet_slip_match_id,
        coalesce(v_leg ->> 'market_type', 'unknown'),
        coalesce(v_leg ->> 'market_label', ''),
        coalesce(v_leg ->> 'selection_label', ''),
        nullif(v_leg ->> 'threshold', '')::numeric,
        v_leg ->> 'selector',
        nullif(v_leg ->> 'odds', '')::numeric,
        case
          when v_live_match_id is null then 'not_monitorable'
          else coalesce(v_leg ->> 'status', 'pending')
        end,
        v_leg ->> 'raw_text'
      );
    end loop;
  end loop;

  return v_slip_id;
end;
$$;

comment on function public.create_bet_slip is 'Crea un cupón multi-partido (bet_slips, incluyendo reference opcional) + sus bet_slip_matches (find-or-create de live_matches por grupo) + sus bet_slip_legs, todo de forma atómica. SECURITY INVOKER: respeta RLS de quien llama (la Edge Function create-bet-slip invoca esto con el JWT del usuario, nunca service_role). legs con status ya evaluado por la Edge Function contra el snapshot resuelto de cada grupo; se fuerza a not_monitorable si el grupo no resolvió live_match_id (backstop, ver 20260718100500_create_bet_slip_function.sql).';

grant execute on function public.create_bet_slip(numeric, jsonb, text) to authenticated;

-- --- bet_slip_summary: reexpone reference junto a stake_amount -------------
drop view public.bet_slip_summary;

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
  bs.reference,
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
group by bs.id, bs.user_id, bs.reference, bs.stake_amount, oa.leg_count, oa.legs_missing_odds, oa.total_odds;

comment on view public.bet_slip_summary is 'Estado + cuota total + ganancia potencial de un cupón completo, NUNCA cacheado. Incluye reference (texto libre/opcional del cupón). status: lost/won/in_progress. total_odds = producto de odds de TODOS los legs del cupón (exp(sum(ln(odds)))), NULL si falta la cuota de cualquier leg. potential_winnings = stake_amount * total_odds, NULL si falta cualquiera de los dos. security_invoker=true: hereda RLS de bet_slips/bet_slip_matches/bet_slip_legs/live_matches de quien consulta.';
