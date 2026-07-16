-- =============================================================================
-- card_expenses_rls
-- -----------------------------------------------------------------------------
-- Row Level Security para las 3 tablas de la feature de tarjetas de crédito
-- (credit_cards, card_people, card_expenses). Mismo patrón exacto que
-- 20260716142010_rls_policies.sql: policy explícita por operación
-- (select/insert/update/delete), sin policy "for all" genérica. A diferencia
-- de categories, acá no hay concepto de fila "default del sistema": las 3
-- tablas son 100% propiedad del usuario dueño, sin filas compartidas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- credit_cards: el usuario solo puede leer/escribir sus propias tarjetas.
-- -----------------------------------------------------------------------------
alter table public.credit_cards enable row level security;

create policy "credit_cards_select_own"
on public.credit_cards
for select
to authenticated
using (user_id = auth.uid());

create policy "credit_cards_insert_own"
on public.credit_cards
for insert
to authenticated
with check (user_id = auth.uid());

create policy "credit_cards_update_own"
on public.credit_cards
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "credit_cards_delete_own"
on public.credit_cards
for delete
to authenticated
using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- card_people: el usuario solo puede leer/escribir sus propias personas.
-- -----------------------------------------------------------------------------
alter table public.card_people enable row level security;

create policy "card_people_select_own"
on public.card_people
for select
to authenticated
using (user_id = auth.uid());

create policy "card_people_insert_own"
on public.card_people
for insert
to authenticated
with check (user_id = auth.uid());

create policy "card_people_update_own"
on public.card_people
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "card_people_delete_own"
on public.card_people
for delete
to authenticated
using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- card_expenses: el usuario solo puede leer/escribir sus propios gastos de
-- tarjeta.
-- -----------------------------------------------------------------------------
alter table public.card_expenses enable row level security;

create policy "card_expenses_select_own"
on public.card_expenses
for select
to authenticated
using (user_id = auth.uid());

create policy "card_expenses_insert_own"
on public.card_expenses
for insert
to authenticated
with check (user_id = auth.uid());

create policy "card_expenses_update_own"
on public.card_expenses
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "card_expenses_delete_own"
on public.card_expenses
for delete
to authenticated
using (user_id = auth.uid());
