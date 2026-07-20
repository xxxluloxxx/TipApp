-- =============================================================================
-- fixed_expenses_rls
-- -----------------------------------------------------------------------------
-- Row Level Security para las 2 tablas de "Gastos fijos/recurrentes"
-- (fixed_expenses, fixed_expense_instances). Mismo patrón exacto que
-- 20260716142025_debts_rls.sql: policy explícita por operación
-- (select/insert/update/delete), sin policy "for all" genérica. Sin concepto
-- de fila "default del sistema": ambas tablas son 100% propiedad del usuario
-- dueño, sin filas compartidas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- fixed_expenses: el usuario solo puede leer/escribir sus propias plantillas.
-- -----------------------------------------------------------------------------
alter table public.fixed_expenses enable row level security;

create policy "fixed_expenses_select_own"
on public.fixed_expenses
for select
to authenticated
using (user_id = auth.uid());

create policy "fixed_expenses_insert_own"
on public.fixed_expenses
for insert
to authenticated
with check (user_id = auth.uid());

create policy "fixed_expenses_update_own"
on public.fixed_expenses
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "fixed_expenses_delete_own"
on public.fixed_expenses
for delete
to authenticated
using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- fixed_expense_instances: el usuario solo puede leer/escribir sus propias
-- instancias. Nada impide, a nivel de RLS, que el cliente actualice status/
-- expense_id directamente en vez de pasar por pay_fixed_expense_instance
-- (mismo criterio ya aceptado en el proyecto para debt_movements: RLS
-- coarse-grained por fila, no por columna) — el invariante "paid siempre con
-- expense_id real" queda protegido igual por la constraint + el trigger de
-- 20260720090100_fixed_expense_instances_init.sql, no por restringir columnas
-- vía policy.
-- -----------------------------------------------------------------------------
alter table public.fixed_expense_instances enable row level security;

create policy "fixed_expense_instances_select_own"
on public.fixed_expense_instances
for select
to authenticated
using (user_id = auth.uid());

create policy "fixed_expense_instances_insert_own"
on public.fixed_expense_instances
for insert
to authenticated
with check (user_id = auth.uid());

create policy "fixed_expense_instances_update_own"
on public.fixed_expense_instances
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "fixed_expense_instances_delete_own"
on public.fixed_expense_instances
for delete
to authenticated
using (user_id = auth.uid());
