-- Elimina por completo la feature "Partidos en vivo" + cupones de apuestas
-- (pedido del usuario, 2026-11-17).
--
-- Motivo inmediato: el cron `poll_matches_every_20s` dejaba una fila en
-- `cron.job_run_details` cada 20 s (528 k filas, 1,4 GB) y el proyecto superó
-- la cuota de 500 MB del plan free (`exceed_db_size_quota`, HTTP 402): Auth y
-- la API quedaron bloqueadas. Todas las tablas de la feature estaban vacías.
--
-- Las migraciones originales (20260717*, 20260718*) se conservan en el repo
-- como historial; esta migración deshace su efecto.

-- 1. Cron + secreto del bearer ------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'poll_matches_every_20s') then
    perform cron.unschedule('poll_matches_every_20s');
  end if;
end $$;

delete from vault.secrets where name = 'poll_matches_cron_bearer';

-- 2. Vistas -------------------------------------------------------------------
drop view if exists public.bet_slip_summary;
drop view if exists public.bet_slip_match_status;

-- 3. Tablas (hijas primero) ---------------------------------------------------
drop table if exists public.bet_slip_legs;
drop table if exists public.bet_slip_matches;
drop table if exists public.bet_slips;
drop table if exists public.live_matches;
drop table if exists public.push_subscriptions;

-- 4. Funciones ----------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'create_live_match',
        'create_bet_slip',
        'bet_slip_legs_validate_owner',
        'bet_slip_matches_validate_owner'
      )
  loop
    execute format('drop function if exists %s', f.sig);
  end loop;
end $$;
