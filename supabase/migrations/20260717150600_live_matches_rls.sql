-- =============================================================================
-- live_matches_rls
-- -----------------------------------------------------------------------------
-- Row Level Security para las 3 tablas nuevas de la feature de Partidos en
-- vivo (live_matches, bet_slip_legs, push_subscriptions). Mismo patrón
-- exacto que 20260716142025_debts_rls.sql: policy explícita por operación
-- (select/insert/update/delete), sin policy "for all" genérica, scoped a
-- user_id = auth.uid(). Sin concepto de fila "default del sistema": las 3
-- tablas son 100% propiedad del usuario dueño.
--
-- Nota importante: la Edge Function poll-matches usa la service_role key
-- (bypassea RLS por diseño, ver comentario en supabase/functions/
-- poll-matches/index.ts) porque corre en un cron sin sesión de usuario y
-- necesita actualizar partidos de todos los usuarios en una sola corrida.
-- add-match y ocr-betslip, en cambio, usan el JWT del usuario que llama
-- (respetan estas policies igual que create_debt/create_live_match).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- live_matches
-- -----------------------------------------------------------------------------
alter table public.live_matches enable row level security;

create policy "live_matches_select_own"
on public.live_matches
for select
to authenticated
using (user_id = auth.uid());

create policy "live_matches_insert_own"
on public.live_matches
for insert
to authenticated
with check (user_id = auth.uid());

create policy "live_matches_update_own"
on public.live_matches
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "live_matches_delete_own"
on public.live_matches
for delete
to authenticated
using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- bet_slip_legs
-- -----------------------------------------------------------------------------
alter table public.bet_slip_legs enable row level security;

create policy "bet_slip_legs_select_own"
on public.bet_slip_legs
for select
to authenticated
using (user_id = auth.uid());

create policy "bet_slip_legs_insert_own"
on public.bet_slip_legs
for insert
to authenticated
with check (user_id = auth.uid());

create policy "bet_slip_legs_update_own"
on public.bet_slip_legs
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "bet_slip_legs_delete_own"
on public.bet_slip_legs
for delete
to authenticated
using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- push_subscriptions
-- -----------------------------------------------------------------------------
alter table public.push_subscriptions enable row level security;

create policy "push_subscriptions_select_own"
on public.push_subscriptions
for select
to authenticated
using (user_id = auth.uid());

create policy "push_subscriptions_insert_own"
on public.push_subscriptions
for insert
to authenticated
with check (user_id = auth.uid());

create policy "push_subscriptions_update_own"
on public.push_subscriptions
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "push_subscriptions_delete_own"
on public.push_subscriptions
for delete
to authenticated
using (user_id = auth.uid());
