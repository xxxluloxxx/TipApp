-- =============================================================================
-- debts_rls
-- -----------------------------------------------------------------------------
-- Row Level Security para las 2 tablas de la feature de deudas/préstamos
-- (debts, debt_movements). Mismo patrón exacto que
-- 20260716142015_card_expenses_rls.sql / 20260716142020_accounts_incomes_rls.sql:
-- policy explícita por operación (select/insert/update/delete), sin policy
-- "for all" genérica. Sin concepto de fila "default del sistema": ambas
-- tablas son 100% propiedad del usuario dueño, sin filas compartidas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- debts: el usuario solo puede leer/escribir sus propias deudas.
-- -----------------------------------------------------------------------------
alter table public.debts enable row level security;

create policy "debts_select_own"
on public.debts
for select
to authenticated
using (user_id = auth.uid());

create policy "debts_insert_own"
on public.debts
for insert
to authenticated
with check (user_id = auth.uid());

create policy "debts_update_own"
on public.debts
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "debts_delete_own"
on public.debts
for delete
to authenticated
using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- debt_movements: el usuario solo puede leer/escribir sus propios movimientos
-- de deuda.
-- -----------------------------------------------------------------------------
alter table public.debt_movements enable row level security;

create policy "debt_movements_select_own"
on public.debt_movements
for select
to authenticated
using (user_id = auth.uid());

create policy "debt_movements_insert_own"
on public.debt_movements
for insert
to authenticated
with check (user_id = auth.uid());

create policy "debt_movements_update_own"
on public.debt_movements
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "debt_movements_delete_own"
on public.debt_movements
for delete
to authenticated
using (user_id = auth.uid());
