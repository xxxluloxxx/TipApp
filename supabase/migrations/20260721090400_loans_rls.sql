-- =============================================================================
-- loans_rls
-- -----------------------------------------------------------------------------
-- Row Level Security para las 4 tablas de la feature nueva "Préstamos"
-- (loans, loan_installments, loan_debtors, loan_debtor_payments). Mismo
-- patrón exacto que 20260716142025_debts_rls.sql / 20260720090200_fixed_
-- expenses_rls.sql: policy explícita por operación (select/insert/update/
-- delete), sin policy "for all" genérica. Sin concepto de fila "default del
-- sistema": las 4 tablas son 100% propiedad del usuario dueño.
--
-- Nota sobre loan_installments/loan_debtor_payments: igual que
-- fixed_expense_instances, el RLS acá es coarse-grained por fila (no por
-- columna) -- nada impide que el cliente actualice status/paid_at de una
-- cuota, o inserte un pago, directamente vía la policy update_own/
-- insert_own en vez de una RPC dedicada. Es una decisión deliberada (ver
-- 20260721090500_create_loan_function.sql): a diferencia de
-- pay_fixed_expense_instance, acá no hay ningún efecto de lado en otra
-- tabla que proteger con atomicidad server-side.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- loans
-- -----------------------------------------------------------------------------
alter table public.loans enable row level security;

create policy "loans_select_own"
on public.loans
for select
to authenticated
using (user_id = auth.uid());

create policy "loans_insert_own"
on public.loans
for insert
to authenticated
with check (user_id = auth.uid());

create policy "loans_update_own"
on public.loans
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "loans_delete_own"
on public.loans
for delete
to authenticated
using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- loan_installments
-- -----------------------------------------------------------------------------
alter table public.loan_installments enable row level security;

create policy "loan_installments_select_own"
on public.loan_installments
for select
to authenticated
using (user_id = auth.uid());

create policy "loan_installments_insert_own"
on public.loan_installments
for insert
to authenticated
with check (user_id = auth.uid());

create policy "loan_installments_update_own"
on public.loan_installments
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "loan_installments_delete_own"
on public.loan_installments
for delete
to authenticated
using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- loan_debtors
-- -----------------------------------------------------------------------------
alter table public.loan_debtors enable row level security;

create policy "loan_debtors_select_own"
on public.loan_debtors
for select
to authenticated
using (user_id = auth.uid());

create policy "loan_debtors_insert_own"
on public.loan_debtors
for insert
to authenticated
with check (user_id = auth.uid());

create policy "loan_debtors_update_own"
on public.loan_debtors
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "loan_debtors_delete_own"
on public.loan_debtors
for delete
to authenticated
using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- loan_debtor_payments
-- -----------------------------------------------------------------------------
alter table public.loan_debtor_payments enable row level security;

create policy "loan_debtor_payments_select_own"
on public.loan_debtor_payments
for select
to authenticated
using (user_id = auth.uid());

create policy "loan_debtor_payments_insert_own"
on public.loan_debtor_payments
for insert
to authenticated
with check (user_id = auth.uid());

create policy "loan_debtor_payments_update_own"
on public.loan_debtor_payments
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "loan_debtor_payments_delete_own"
on public.loan_debtor_payments
for delete
to authenticated
using (user_id = auth.uid());
