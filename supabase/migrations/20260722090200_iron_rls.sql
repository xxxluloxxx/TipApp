-- =============================================================================
-- iron_rls
-- -----------------------------------------------------------------------------
-- Row Level Security para las 2 tablas de Iron (iron_cigarettes, iron_packs).
-- Mismo patrón exacto que debts_rls/account_transfers_rls/
-- accounts_incomes_rls: policy explícita por operación (select/insert/
-- update/delete), sin policy "for all" genérica. 100% propiedad del usuario
-- dueño, sin filas compartidas ni concepto de fila "default del sistema"
-- (a diferencia de categories).
--
-- Nota: las funciones no-optimistas (close_pending_half/discard_pending_half
-- /create_iron_pack_linked/update_iron_pack/delete_iron_pack, migraciones
-- siguientes) son SECURITY INVOKER -- dependen exactamente de estas
-- policies para poder insertar/actualizar/borrar, igual que
-- create_account_transfer depende de account_transfers_insert_own.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- iron_cigarettes: el usuario solo puede leer/escribir sus propios registros
-- de consumo.
-- -----------------------------------------------------------------------------
alter table public.iron_cigarettes enable row level security;

create policy "iron_cigarettes_select_own"
on public.iron_cigarettes
for select
to authenticated
using (user_id = auth.uid());

create policy "iron_cigarettes_insert_own"
on public.iron_cigarettes
for insert
to authenticated
with check (user_id = auth.uid());

create policy "iron_cigarettes_update_own"
on public.iron_cigarettes
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "iron_cigarettes_delete_own"
on public.iron_cigarettes
for delete
to authenticated
using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- iron_packs: el usuario solo puede leer/escribir sus propias compras de
-- cajetilla.
-- -----------------------------------------------------------------------------
alter table public.iron_packs enable row level security;

create policy "iron_packs_select_own"
on public.iron_packs
for select
to authenticated
using (user_id = auth.uid());

create policy "iron_packs_insert_own"
on public.iron_packs
for insert
to authenticated
with check (user_id = auth.uid());

create policy "iron_packs_update_own"
on public.iron_packs
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "iron_packs_delete_own"
on public.iron_packs
for delete
to authenticated
using (user_id = auth.uid());
