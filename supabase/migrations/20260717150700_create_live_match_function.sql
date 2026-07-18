-- =============================================================================
-- create_live_match_function
-- -----------------------------------------------------------------------------
-- Agregar un partido implica 2 inserts dependientes: la cabecera
-- (live_matches, ya poblada con el snapshot inicial completo que la Edge
-- Function add-match trajo sincrónicamente) + sus legs de cupón (si el
-- usuario subió foto). Mismo criterio exacto que create_debt
-- (20260716142028): esto no puede quedar como 2 inserts sueltos del cliente
-- (riesgo de partido huérfano sin legs, o peor, sin forma atómica de
-- detectar duplicado justo antes de insertar) — se resuelve con esta
-- función rpc, atómica (plpgsql: si cualquier insert falla, rollback
-- completo, no queda ninguna fila).
--
-- SECURITY INVOKER (no DEFINER): corre con los permisos y el RLS del
-- usuario que llama (la Edge Function add-match invoca esto pasando el JWT
-- del usuario, nunca service_role) — no hay ninguna razón para bypassear
-- RLS acá. El trigger bet_slip_legs_validate_owner_trigger ya refuerza a
-- nivel de datos que cada leg quede asociado al match recién creado del
-- mismo usuario, no hace falta duplicar ese chequeo en el body.
--
-- p_legs es un array jsonb de objetos con las claves de bet_slip_legs
-- (market_type/market_label/selection_label/threshold/selector/status/
-- raw_text) — ya vienen resueltos por _shared/marketMapper.ts dentro de la
-- Edge Function, esta función no interpreta texto de OCR.
-- =============================================================================

create function public.create_live_match(
  p_flashscore_mid text,
  p_flashscore_url text,
  p_home_team text default null,
  p_away_team text default null,
  p_competition text default null,
  p_score_home integer default null,
  p_score_away integer default null,
  p_stage_code integer default null,
  p_stage_anchor_ts timestamptz default null,
  p_scheduled_kickoff_ts timestamptz default null,
  p_corners_home integer default null,
  p_corners_away integer default null,
  p_shots_on_target_home integer default null,
  p_shots_on_target_away integer default null,
  p_clear_chances_home integer default null,
  p_clear_chances_away integer default null,
  p_yellow_cards_home integer default null,
  p_yellow_cards_away integer default null,
  p_red_cards_home integer default null,
  p_red_cards_away integer default null,
  p_first_half_score_home integer default null,
  p_first_half_score_away integer default null,
  p_incidents jsonb default '[]'::jsonb,
  p_last_poll_ok boolean default true,
  p_poll_interval_seconds integer default 20,
  p_legs jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_match_id uuid;
  v_leg jsonb;
begin
  if v_user_id is null then
    raise exception 'create_live_match requiere un usuario autenticado';
  end if;

  if exists (
    select 1 from public.live_matches
    where user_id = v_user_id and flashscore_mid = p_flashscore_mid
  ) then
    raise exception 'Ya estás siguiendo este partido (mid %)', p_flashscore_mid
      using errcode = '23505';
  end if;

  insert into public.live_matches (
    user_id, flashscore_mid, flashscore_url, home_team, away_team, competition,
    score_home, score_away, stage_code, stage_anchor_ts, scheduled_kickoff_ts,
    corners_home, corners_away, shots_on_target_home, shots_on_target_away,
    clear_chances_home, clear_chances_away, yellow_cards_home, yellow_cards_away,
    red_cards_home, red_cards_away, first_half_score_home, first_half_score_away,
    incidents, last_polled_at, last_poll_ok, poll_interval_seconds, next_poll_at,
    last_changed_at
  ) values (
    v_user_id, p_flashscore_mid, p_flashscore_url, p_home_team, p_away_team, p_competition,
    p_score_home, p_score_away, p_stage_code, p_stage_anchor_ts, p_scheduled_kickoff_ts,
    p_corners_home, p_corners_away, p_shots_on_target_home, p_shots_on_target_away,
    p_clear_chances_home, p_clear_chances_away, p_yellow_cards_home, p_yellow_cards_away,
    p_red_cards_home, p_red_cards_away, p_first_half_score_home, p_first_half_score_away,
    coalesce(p_incidents, '[]'::jsonb), now(), p_last_poll_ok, p_poll_interval_seconds,
    now() + make_interval(secs => p_poll_interval_seconds), now()
  )
  returning id into v_match_id;

  for v_leg in select * from jsonb_array_elements(coalesce(p_legs, '[]'::jsonb))
  loop
    insert into public.bet_slip_legs (
      user_id, match_id, market_type, market_label, selection_label, threshold, selector, status, raw_text
    ) values (
      v_user_id,
      v_match_id,
      coalesce(v_leg ->> 'market_type', 'unknown'),
      coalesce(v_leg ->> 'market_label', ''),
      coalesce(v_leg ->> 'selection_label', ''),
      nullif(v_leg ->> 'threshold', '')::numeric,
      v_leg ->> 'selector',
      coalesce(v_leg ->> 'status', 'pending'),
      v_leg ->> 'raw_text'
    );
  end loop;

  return v_match_id;
end;
$$;

comment on function public.create_live_match is 'Crea un partido monitoreado (live_matches, ya con el snapshot inicial completo) + sus legs de cupón (bet_slip_legs) de forma atómica. SECURITY INVOKER: respeta el RLS y las policies insert_own de quien llama (la Edge Function add-match invoca esto con el JWT del usuario, nunca service_role).';

grant execute on function public.create_live_match(
  text, text, text, text, text,
  integer, integer, integer, timestamptz, timestamptz,
  integer, integer, integer, integer, integer, integer, integer, integer, integer, integer,
  integer, integer, jsonb, boolean, integer, jsonb
) to authenticated;
