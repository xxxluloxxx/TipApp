-- =============================================================================
-- create_bet_slip_function
-- -----------------------------------------------------------------------------
-- Alta atómica de un cupón multi-partido -- mismo motivo exacto que
-- create_debt/create_live_match: 1 bet_slips + N bet_slip_matches + sus
-- bet_slip_legs son inserts DEPENDIENTES que no pueden quedar sueltos si
-- alguno falla a mitad de camino (cupón huérfano, o peor, un grupo sin
-- ninguna predicción por un error parcial).
--
-- SECURITY INVOKER (no DEFINER, mismo criterio que create_debt/
-- create_live_match): corre con los permisos y el RLS de quien llama -- la
-- Edge Function create-bet-slip invoca esto con el JWT del usuario, nunca
-- service_role. Los triggers *_validate_owner de bet_slip_matches/
-- bet_slip_legs ya refuerzan a nivel de datos que cada fila quede asociada
-- al usuario correcto, no hace falta duplicar ese chequeo acá.
--
-- FIND-OR-CREATE de live_matches, resuelto con UN SOLO insert por grupo:
-- `insert ... on conflict (user_id, flashscore_mid) do update set
-- updated_at = now() returning id`. Si el partido ya estaba trackeado
-- (desde este cupón u otro), el conflicto descarta los valores del INSERT
-- (nunca pisa un snapshot bueno con nulls) y devuelve el id existente sin
-- tocar nada más -- si es nuevo, se inserta con el snapshot que la Edge
-- Function ya resolvió sincrónicamente (mismo "primer poll" que hacía
-- add-match/create_live_match). Por eso p_groups siempre trae
-- flashscore_mid+flashscore_url cuando el grupo resolvió a un partido
-- (flashscore_url puede ser sintético), y el resto de columnas de snapshot
-- solo importan cuando el grupo es realmente nuevo (se ignoran en el
-- conflicto).
--
-- p_groups es un array jsonb, cada elemento:
--   { flashscore_mid, flashscore_url, home_team, away_team, competition,
--     score_home, score_away, stage_code, stage_anchor_ts,
--     scheduled_kickoff_ts, corners_home, corners_away,
--     shots_on_target_home, shots_on_target_away, clear_chances_home,
--     clear_chances_away, yellow_cards_home, yellow_cards_away,
--     red_cards_home, red_cards_away, first_half_score_home,
--     first_half_score_away, incidents, last_poll_ok,
--     poll_interval_seconds,
--     legs: [ { market_type, market_label, selection_label, threshold,
--       selector, odds, raw_text, status } ] }
-- flashscore_mid puede ser null (grupo que NO resolvió a un partido real --
-- live_match_id queda null en bet_slip_matches). legs ya vienen
-- clasificados por _shared/marketMapper.ts y con su status YA evaluado por
-- la Edge Function (evaluateCondition contra el snapshot resuelto de cada
-- grupo) -- esta función no interpreta texto de OCR ni corre el motor de
-- reglas, solo persiste.
--
-- BACKSTOP: si un grupo no resolvió flashscore_mid (live_match_id queda
-- null), CUALQUIER status que haya venido en el leg se pisa acá a
-- 'not_monitorable' -- nunca puede evaluarse won/lost sin un live_match
-- vinculado (poll-matches solo evalúa legs de bet_slip_matches con
-- live_match_id resuelto), así que dejar 'pending' sería engañoso (nunca
-- va a transicionar). Refuerza la regla aunque la Edge Function ya debería
-- mandarlo así.
-- =============================================================================

create function public.create_bet_slip(
  p_stake_amount numeric default null,
  p_groups jsonb default '[]'::jsonb
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

  insert into public.bet_slips (user_id, stake_amount)
  values (v_user_id, p_stake_amount)
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

comment on function public.create_bet_slip is 'Crea un cupón multi-partido (bet_slips) + sus bet_slip_matches (find-or-create de live_matches por grupo) + sus bet_slip_legs, todo de forma atómica. SECURITY INVOKER: respeta RLS de quien llama (la Edge Function create-bet-slip invoca esto con el JWT del usuario, nunca service_role). legs con status ya evaluado por la Edge Function contra el snapshot resuelto de cada grupo; se fuerza a not_monitorable si el grupo no resolvió live_match_id (backstop, ver cabecera del archivo).';

grant execute on function public.create_bet_slip(numeric, jsonb) to authenticated;
