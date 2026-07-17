-- =============================================================================
-- accounts_incomes_rls
-- -----------------------------------------------------------------------------
-- Row Level Security para accounts e incomes. Mismo patrón exacto que
-- 20260716142010_rls_policies.sql / 20260716142015_card_expenses_rls.sql:
-- policy explícita por operación (select/insert/update/delete), sin policy
-- "for all" genérica. Igual que credit_cards/card_people/card_expenses, acá
-- no hay concepto de fila "default del sistema": ambas tablas son 100%
-- propiedad del usuario dueño, sin filas compartidas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- accounts: el usuario solo puede leer/escribir sus propias cuentas.
-- -----------------------------------------------------------------------------
alter table public.accounts enable row level security;

create policy "accounts_select_own"
on public.accounts
for select
to authenticated
using (user_id = auth.uid());

create policy "accounts_insert_own"
on public.accounts
for insert
to authenticated
with check (user_id = auth.uid());

create policy "accounts_update_own"
on public.accounts
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "accounts_delete_own"
on public.accounts
for delete
to authenticated
using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- incomes: el usuario solo puede leer/escribir sus propios ingresos.
-- -----------------------------------------------------------------------------
alter table public.incomes enable row level security;

create policy "incomes_select_own"
on public.incomes
for select
to authenticated
using (user_id = auth.uid());

create policy "incomes_insert_own"
on public.incomes
for insert
to authenticated
with check (user_id = auth.uid());

create policy "incomes_update_own"
on public.incomes
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "incomes_delete_own"
on public.incomes
for delete
to authenticated
using (user_id = auth.uid());
