-- =============================================================================
-- schedule_poll_matches_cron
-- -----------------------------------------------------------------------------
-- Programa la corrida periódica de la Edge Function poll-matches vía
-- pg_cron + pg_net (net.http_post). Dispara el algoritmo de polling
-- adaptativo de la feature de Partidos en vivo (PLAN.md sección 6.3).
--
-- GRANULARIDAD -- VERIFICADO EMPÍRICAMENTE, no asumido: se confirmó contra
-- el proyecto remoto real que la versión de pg_cron instalada (1.6.4)
-- SÍ soporta sintaxis de intervalo en segundos ('20 seconds') además del
-- cron estándar de 5 campos (mínimo 1 minuto) -- se probó programando un
-- job de prueba cada 10 segundos contra una tabla temporal y se confirmó
-- que insertó 42 filas en ~7 minutos de corrida real (limpiado antes de
-- esta migración, no queda rastro en el esquema). Esto es MEJOR que la
-- limitación anticipada originalmente (un piso de 60s por granularidad
-- estándar de cron) -- se programa acá cada 20s, calcando el intervalo
-- BASE real de PLAN.md sección 6.3 (15-20s), no un fallback degradado.
--
-- El algoritmo adaptativo real (backoff/crecimiento hasta 120s/180s) sigue
-- viviendo a nivel de dato en live_matches.poll_interval_seconds/
-- next_poll_at (poll-matches/index.ts): esta corrida de 20s es solo el
-- "tick" que dispara la función; la función internamente solo procesa las
-- filas con next_poll_at <= now(), así que partidos con intervalo más largo
-- (sin cambios recientes) simplemente no hacen nada útil en los ticks donde
-- todavía no les toca -- no se re-pollea el feed de Flashscore más seguido
-- de lo que el algoritmo adaptativo indica.
--
-- El bearer secreto (CRON_SECRET) se guardó en Supabase Vault ANTES de esta
-- migración, vía un comando puntual fuera de git
-- (`supabase db query --linked`, no versionado) -- acá solo se referencia
-- por NOMBRE (`poll_matches_cron_bearer`), nunca el valor. El mismo valor
-- se configuró como secret de la Edge Function
-- (`supabase secrets set CRON_SECRET=...`) -- ambos deben coincidir para
-- que poll-matches acepte la llamada (ver Deno.serve en
-- supabase/functions/poll-matches/index.ts).
-- =============================================================================

select cron.schedule(
  'poll_matches_every_20s',
  '20 seconds',
  $$
  select net.http_post(
    url := 'https://jgdenlrceubawwmknzcb.supabase.co/functions/v1/poll-matches',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'poll_matches_cron_bearer'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);

comment on extension pg_cron is 'Programa la corrida periódica (cada 20s) de poll-matches. Ver cron.job para el estado del schedule; cron.job_run_details para el historial de corridas.';
