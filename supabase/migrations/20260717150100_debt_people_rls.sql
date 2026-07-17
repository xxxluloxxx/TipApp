-- =============================================================================
-- debt_people_rls
-- -----------------------------------------------------------------------------
-- Row Level Security para public.debt_people. Mismo patrón exacto que
-- 20260716142015_card_expenses_rls.sql (sección card_people) /
-- 20260716142025_debts_rls.sql: policy explícita por operación
-- (select/insert/update/delete), sin policy "for all" genérica. Sin concepto
-- de fila "default del sistema": 100% propiedad del usuario dueño.
-- =============================================================================

alter table public.debt_people enable row level security;

create policy "debt_people_select_own"
on public.debt_people
for select
to authenticated
using (user_id = auth.uid());

create policy "debt_people_insert_own"
on public.debt_people
for insert
to authenticated
with check (user_id = auth.uid());

create policy "debt_people_update_own"
on public.debt_people
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "debt_people_delete_own"
on public.debt_people
for delete
to authenticated
using (user_id = auth.uid());
