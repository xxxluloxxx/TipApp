-- =============================================================================
-- bet_slips_rls
-- -----------------------------------------------------------------------------
-- RLS para las 2 tablas nuevas del rediseño multi-partido (bet_slips,
-- bet_slip_matches). Mismo patrón exacto que el resto del esquema: policy
-- explícita por operación, scoped a user_id = auth.uid(). bet_slip_legs ya
-- tenía RLS activo desde 20260717150600_live_matches_rls.sql -- sus
-- policies siguen siendo válidas sin cambios (siguen filtrando por
-- user_id = auth.uid(), columna que no se tocó en la migración de
-- bet_slip_match_id).
-- =============================================================================

alter table public.bet_slips enable row level security;

create policy "bet_slips_select_own"
on public.bet_slips
for select
to authenticated
using (user_id = auth.uid());

create policy "bet_slips_insert_own"
on public.bet_slips
for insert
to authenticated
with check (user_id = auth.uid());

create policy "bet_slips_update_own"
on public.bet_slips
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "bet_slips_delete_own"
on public.bet_slips
for delete
to authenticated
using (user_id = auth.uid());

alter table public.bet_slip_matches enable row level security;

create policy "bet_slip_matches_select_own"
on public.bet_slip_matches
for select
to authenticated
using (user_id = auth.uid());

create policy "bet_slip_matches_insert_own"
on public.bet_slip_matches
for insert
to authenticated
with check (user_id = auth.uid());

create policy "bet_slip_matches_update_own"
on public.bet_slip_matches
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "bet_slip_matches_delete_own"
on public.bet_slip_matches
for delete
to authenticated
using (user_id = auth.uid());
