-- =============================================================================
-- create_live_match_drop_legs_support
-- -----------------------------------------------------------------------------
-- Tras el rediseño multi-partido (20260718), TODA alta de bet_slip_legs
-- pasa exclusivamente por create_bet_slip (20260718100500) -- ya no hay dos
-- caminos distintos para crear predicciones. create_live_match deja de
-- aceptar p_legs/insertar en bet_slip_legs (esa tabla ya no cuelga de
-- match_id, ver 20260718100200) y vuelve a ser lo que su nombre siempre
-- dijo: crear (con find-or-create implícito vía el check de duplicado) UN
-- live_match, nada más. Sigue siendo el respaldo de add-match para "solo
-- quiero trackear este partido en vivo, sin apostar nada" (caso real hoy en
-- el proyecto remoto: el live_match "Baumberg-Bayer Leverkusen" no tiene
-- ningún leg asociado).
--
-- Se DROPea la función vieja (no se puede CREATE OR REPLACE quitando un
-- parámetro sin cambiar la identidad de la firma) y se recrea con el mismo
-- nombre y los mismos parámetros de snapshot, menos p_legs.
-- =============================================================================

drop function public.create_live_match(
  text, text, text, text, text,
  integer, integer, integer, timestamptz, timestamptz,
  integer, integer, integer, integer, integer, integer, integer, integer, integer, integer,
  integer, integer, jsonb, boolean, integer, jsonb
);

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
  p_poll_interval_seconds integer default 20
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_match_id uuid;
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

  return v_match_id;
end;
$$;

comment on function public.create_live_match is 'Crea un live_match trackeado (find-or-create implícito vía el check de duplicado -- unique(user_id, flashscore_mid)). Ya NO acepta legs (ver 20260718100500_create_bet_slip_function.sql: toda alta de bet_slip_legs pasa por create_bet_slip). SECURITY INVOKER: respeta RLS/policies insert_own de quien llama (la Edge Function add-match invoca esto con el JWT del usuario, nunca service_role).';

grant execute on function public.create_live_match(
  text, text, text, text, text,
  integer, integer, integer, timestamptz, timestamptz,
  integer, integer, integer, integer, integer, integer, integer, integer, integer, integer,
  integer, integer, jsonb, boolean, integer
) to authenticated;
