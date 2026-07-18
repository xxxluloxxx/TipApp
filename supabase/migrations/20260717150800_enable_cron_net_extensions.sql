-- =============================================================================
-- enable_cron_net_extensions
-- -----------------------------------------------------------------------------
-- Habilita pg_cron (programar la corrida periódica de la Edge Function
-- poll-matches) y pg_net (hacer el POST HTTP saliente hacia esa función
-- desde SQL, vía cron.schedule + net.http_post). Ambas confirmadas
-- disponibles pero no instaladas en el proyecto remoto real
-- (select * from pg_available_extensions where name in ('pg_cron','pg_net')
-- dio default_version con installed_version null antes de esta migración).
--
-- En Supabase hosted, ambas extensions se instalan en el schema `extensions`
-- (no `public`) por convención de la plataforma — mismo criterio que usa
-- Supabase para pgcrypto/uuid-ossp ya instaladas de fábrica en este proyecto.
-- =============================================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
