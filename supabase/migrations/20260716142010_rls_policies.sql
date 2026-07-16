-- =============================================================================
-- rls_policies
-- -----------------------------------------------------------------------------
-- Row Level Security para todas las tablas accesibles desde el cliente.
-- Política explícita por operación (select/insert/update/delete) en vez de
-- una policy genérica "for all", para que quede auditable qué puede hacer
-- cada usuario en cada tabla.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles: el usuario solo ve/edita su propio perfil.
-- No hay policy de INSERT: el registro se crea únicamente vía el trigger
-- on_auth_user_created (SECURITY DEFINER, corre como el owner de la función y
-- por tanto bypassa RLS). No hay policy de DELETE: no se expone borrado de
-- perfil propio en v1 (borrar la cuenta se maneja aparte, vía auth.users).
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;

create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- -----------------------------------------------------------------------------
-- categories: lectura de las default (user_id IS NULL) + las propias.
-- Escritura (insert/update/delete) solo sobre las propias custom; las
-- categorías default nunca son editables/borrables por un usuario común.
-- -----------------------------------------------------------------------------
alter table public.categories enable row level security;

create policy "categories_select_default_or_own"
on public.categories
for select
to authenticated
using (user_id is null or user_id = auth.uid());

create policy "categories_insert_own"
on public.categories
for insert
to authenticated
with check (user_id = auth.uid());

create policy "categories_update_own"
on public.categories
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "categories_delete_own"
on public.categories
for delete
to authenticated
using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- expenses: el usuario solo puede leer/escribir sus propios gastos.
-- -----------------------------------------------------------------------------
alter table public.expenses enable row level security;

create policy "expenses_select_own"
on public.expenses
for select
to authenticated
using (user_id = auth.uid());

create policy "expenses_insert_own"
on public.expenses
for insert
to authenticated
with check (user_id = auth.uid());

create policy "expenses_update_own"
on public.expenses
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "expenses_delete_own"
on public.expenses
for delete
to authenticated
using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- budgets: el usuario solo puede leer/escribir sus propios presupuestos.
-- -----------------------------------------------------------------------------
alter table public.budgets enable row level security;

create policy "budgets_select_own"
on public.budgets
for select
to authenticated
using (user_id = auth.uid());

create policy "budgets_insert_own"
on public.budgets
for insert
to authenticated
with check (user_id = auth.uid());

create policy "budgets_update_own"
on public.budgets
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "budgets_delete_own"
on public.budgets
for delete
to authenticated
using (user_id = auth.uid());
