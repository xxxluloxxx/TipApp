-- =============================================================================
-- live_matches_init
-- -----------------------------------------------------------------------------
-- Partidos de fútbol que un usuario sigue en vivo (feed no oficial de
-- Flashscore, ver docs/features/live-matches-ux.md sección 1 y
-- /home/lulo/Proyectos/Propios/FottStat/PLAN.md secciones 2/5/6.3). Guarda
-- SOLO el último snapshot conocido del partido (nunca historial de
-- snapshots, mismo criterio ya confirmado por el Product Owner en el
-- proyecto original FottStat) — con la única excepción de `incidents`, que
-- Flashscore ya devuelve completo en cada consulta (no hay que reconstruir
-- histórico, ver comment on column más abajo).
--
-- El polling/parseo/motor de reglas corren 100% server-side (Edge Functions
-- `add-match`/`poll-matches` + pg_cron) — el frontend nunca reparsea el feed
-- ni deriva marcador/minuto/stats, solo pinta este snapshot (mismo principio
-- que account_balances/debt_balances: nunca confiar en el cliente para un
-- número que se compara entre sesiones/dispositivos).
-- =============================================================================

create table public.live_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- Identificación del partido (Flashscore).
  flashscore_mid text not null,
  flashscore_url text not null,
  home_team text,
  away_team text,
  competition text,

  -- Estado de monitoreo (distinto del estado del partido en cancha, ver
  -- stage_code más abajo — un partido puede estar 'finished' en cancha y
  -- 'paused' acá si el usuario lo pausó antes de que terminara).
  state text not null default 'monitoring' check (state in ('monitoring', 'paused', 'finished')),

  -- Marcador actual.
  score_home integer,
  score_away integer,

  -- Reloj: 3 campos crudos (NO un string ya formateado), requisito explícito
  -- de docs/features/live-matches-ux.md sección 1.4/10.2 — el cliente los
  -- usa para tickear el minuto localmente entre polls sin volver a pedir
  -- nada al servidor. Mapeo exacto a los campos del feed `dc` de Flashscore,
  -- ver PLAN.md sección 5 "Minuto real":
  --   stage_code           = DB (1=no empezado, 12=1ª parte, 38=descanso,
  --                          13=2ª parte, 3=finalizado)
  --   stage_anchor_ts       = DD (ancla epoch del cronómetro de la parte actual)
  --   scheduled_kickoff_ts  = DC (hora programada de inicio, solo para el
  --                          label "Empieza HH:MM" antes de que arranque)
  stage_code integer,
  stage_anchor_ts timestamptz,
  scheduled_kickoff_ts timestamptz,

  -- Las 5 stats clave del encargo (córners id 16, remates a puerta id 13,
  -- ocasiones claras id 459 del feed df_st periodo "Match"; tarjetas del
  -- feed de incidencias df_su, no de stats).
  corners_home integer,
  corners_away integer,
  shots_on_target_home integer,
  shots_on_target_away integer,
  clear_chances_home integer,
  clear_chances_away integer,
  yellow_cards_home integer,
  yellow_cards_away integer,
  red_cards_home integer,
  red_cards_away integer,

  -- Marcador AL DESCANSO (goles de 1ª parte por equipo), fuente autoritativa
  -- para el mercado "ambos marcan 1ª parte": IG/IH del registro-cabecera
  -- `AC÷1st Half` de df_su (PLAN.md sección 5 "Marcador POR PARTE") — NO se
  -- deriva contando IK÷Goal a mano (pierde penaltis/goles en propia/descuento).
  first_half_score_home integer,
  first_half_score_away integer,

  -- Array completo de incidencias (goles/tarjetas/cambios) tal como llega en
  -- cada poll del feed df_su — se REEMPLAZA entero en cada actualización, no
  -- se va acumulando fila a fila (Flashscore ya lo devuelve completo, ver
  -- docs/features/live-matches-ux.md sección 1.6). Forma de cada elemento:
  -- {type, team: 'home'|'away'|null, minute: "63'", player, period,
  -- description, score: [home, away] | null}.
  incidents jsonb not null default '[]'::jsonb,

  -- Estado de poll (sección 1.5 del doc de UX): el feed es no oficial y
  -- puede fallar puntualmente sin que eso deba alarmar al usuario.
  last_polled_at timestamptz,
  last_poll_ok boolean not null default true,
  last_poll_error text,
  -- Distinto de last_polled_at: se actualiza solo cuando un poll detecta un
  -- cambio real vs. el snapshot anterior (no en cada intento). Usado por el
  -- frontend para ordenar "el que tuvo el cambio más reciente" dentro del
  -- grupo de partidos en vivo (docs/features/live-matches-ux.md sección 3.3).
  last_changed_at timestamptz not null default now(),

  -- Algoritmo de polling adaptativo (PLAN.md sección 6.3), a nivel de dato:
  -- next_poll_at es lo que filtra qué partidos procesa cada corrida de
  -- pg_cron (ver caveat de granularidad de pg_cron en
  -- 20260717151000_schedule_poll_matches_cron.sql). poll_interval_seconds es
  -- el intervalo adaptativo actual (crece con calma sin cambios, vuelve a la
  -- base con un cambio, backoff en error) — se guarda para que el próximo
  -- poll pueda seguir la progresión sin recalcular desde cero.
  poll_interval_seconds integer not null default 20,
  next_poll_at timestamptz not null default now(),

  -- ETags por feed para peticiones condicionales (If-None-Match) — evita
  -- re-descargar un feed que no cambió (PLAN.md sección 6.3).
  etag_dc text,
  etag_df_st text,
  etag_df_su text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, flashscore_mid)
);

comment on table public.live_matches is 'Un partido de Flashscore que un usuario sigue en vivo. Guarda solo el último snapshot conocido (nunca historial), poblado/actualizado 100% server-side por las Edge Functions add-match/poll-matches. El frontend nunca reparsea el feed ni deriva estos valores.';
comment on column public.live_matches.state is 'Estado de MONITOREO (decisión del usuario: pausar/reanudar/finalizado automático al terminar el partido) — distinto de stage_code (estado del partido EN CANCHA). Ambos coexisten sin ser redundantes, ver docs/features/live-matches-ux.md sección 3.4.';
comment on column public.live_matches.stage_code is 'DB del feed dc de Flashscore: 1=no empezado, 12=1ª parte, 38=descanso, 13=2ª parte, 3=finalizado. Crudo, sin traducir a texto — el cliente arma el label localmente (docs/features/live-matches-ux.md sección 1.4).';
comment on column public.live_matches.stage_anchor_ts is 'DD del feed dc: timestamp ancla desde el que corre el cronómetro de la parte ACTUAL. Junto con stage_code es lo que permite al cliente tickear el minuto real localmente entre polls (PLAN.md sección 5 "Minuto real"). NO usar scheduled_kickoff_ts para esto, se desvía significativamente en 2ª parte (documentado en PLAN.md).';
comment on column public.live_matches.scheduled_kickoff_ts is 'DC del feed dc: hora programada de inicio. Solo se usa para el label "Empieza HH:MM" antes de que el partido arranque (stage_code = 1) — no sirve para calcular el minuto en curso.';
comment on column public.live_matches.incidents is 'Array completo de incidencias (goles/tarjetas/cambios) del feed df_su, reemplazado entero en cada poll (Flashscore ya lo devuelve completo). No es una tabla aparte a propósito: no hay que reconstruir histórico, ver docs/features/live-matches-ux.md sección 1.6.';
comment on column public.live_matches.first_half_score_home is 'Goles LOCAL de la 1ª parte, leídos de IG del registro-cabecera "AC÷1st Half" del feed df_su (PLAN.md sección 5) — fuente autoritativa para el mercado "ambos marcan 1ª parte", NO contar goles de tipo Goal a mano (ignora penaltis/goles en propia/descuento).';
comment on column public.live_matches.first_half_score_away is 'Ídem first_half_score_home pero IH (visitante).';
comment on column public.live_matches.last_poll_ok is 'false si el último intento de poll falló (feed caído, 429, token x-fsign rotado, etc.) — no pausa el monitoreo automáticamente, solo se refleja como aviso no alarmante en el frontend (sección 1.5 del doc de UX).';
comment on column public.live_matches.last_changed_at is 'Se actualiza solo cuando un poll detecta un cambio real de snapshot (no en cada intento) — usado para ordenar "cambio más reciente primero" dentro de "En vivo y por empezar".';
comment on column public.live_matches.poll_interval_seconds is 'Intervalo adaptativo actual en segundos (PLAN.md sección 6.3: base 15-20s, crece x1.5 sin cambios hasta 120s, backoff x2 en error hasta 180s). El "piso real" de ejecución está limitado por la granularidad de pg_cron, ver caveat en 20260717151000_schedule_poll_matches_cron.sql.';
comment on column public.live_matches.next_poll_at is 'Cuándo corresponde el próximo poll de este partido. poll-matches solo procesa filas con state=''monitoring'' y next_poll_at <= now().';

create trigger live_matches_set_updated_at
before update on public.live_matches
for each row
execute function public.set_updated_at();

create index live_matches_user_id_idx on public.live_matches (user_id);
-- Índice parcial: la query de poll-matches siempre filtra
-- state='monitoring' AND next_poll_at <= now(), este índice cubre
-- exactamente esa consulta sin escanear partidos pausados/finalizados.
create index live_matches_pending_poll_idx on public.live_matches (next_poll_at) where state = 'monitoring';
