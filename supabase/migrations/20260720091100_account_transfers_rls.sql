-- =============================================================================
-- account_transfers_rls
-- -----------------------------------------------------------------------------
-- Row Level Security para account_transfers. Mismo patrón exacto que
-- 20260716142025_debts_rls.sql / 20260716142015_card_expenses_rls.sql:
-- policy explícita por operación (select/insert/update/delete), sin policy
-- "for all" genérica. 100% propiedad del usuario dueño, sin filas
-- compartidas. Migración separada del init (mismo criterio ya usado en todo
-- el proyecto: init nunca bundlea RLS).
--
-- Sin guard de conteo para el borrado directo de una fila de
-- account_transfers (ver comentario de la migración init): es un registro
-- de movimiento, no un recurso de clasificación compartido -- equivalente a
-- borrar un gasto/ingreso propio.
-- =============================================================================

alter table public.account_transfers enable row level security;

create policy "account_transfers_select_own"
on public.account_transfers
for select
to authenticated
using (user_id = auth.uid());

create policy "account_transfers_insert_own"
on public.account_transfers
for insert
to authenticated
with check (user_id = auth.uid());

create policy "account_transfers_update_own"
on public.account_transfers
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "account_transfers_delete_own"
on public.account_transfers
for delete
to authenticated
using (user_id = auth.uid());
