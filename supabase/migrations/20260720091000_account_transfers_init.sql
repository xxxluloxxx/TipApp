-- =============================================================================
-- account_transfers_init
-- -----------------------------------------------------------------------------
-- Transferencia de dinero entre dos cuentas propias del mismo usuario, con
-- comisión bancaria opcional. Modelo de 2 impactos distintos, mismo
-- criterio de "decisión de producto ya cerrada" que
-- 20260716142027_account_balances_debt_impact.sql aplicó a debt_movements:
--
--   - El MONTO transferido (amount) nunca genera una fila en
--     expenses/incomes: mover $100 de "Banco" a "Efectivo" no es ni un gasto
--     ni un ingreso, sigue siendo la misma plata del mismo usuario, solo que
--     en otra cuenta. Ajusta account_balances directamente (ver
--     20260720091200_account_balances_transfer_impact.sql), igual que un
--     debt_movement vinculado a cuenta.
--   - La COMISIÓN (commission_amount) SÍ es plata perdida de verdad (el
--     banco se la queda) — por eso, y a diferencia del monto, genera una
--     fila real en public.expenses (categoría default "Comisiones
--     bancarias", ver 20260720090900_categories_bank_commissions.sql),
--     visible en Transacciones/Estadísticas/dona, igual que cualquier otro
--     gasto. expense_id es la FK hacia esa fila.
--
-- La comisión siempre la paga la cuenta ORIGEN (from_account_id): la cuenta
-- destino (to_account_id) recibe exactamente `amount`, nunca `amount -
-- commission_amount` ni nada que dependa de la comisión.
--
-- expense_id on delete set null (no cascade, no restrict): si por algún
-- motivo externo se borra la fila de expenses de la comisión (hoy no hay
-- ningún flujo del frontend que borre gastos de esta categoría de forma
-- directa, pero nada en el esquema lo impide — expenses.category_id/
-- account_id son on delete restrict, no la propia fila de expenses), la
-- transferencia en sí sigue siendo una fila válida y consultable (el monto
-- transferido entre cuentas ya ocurrió, es independiente de que su comisión
-- asociada exista o no como gasto visible) — simplemente pierde el vínculo
-- trazable a ese gasto, en vez de arrastrar en cascada el borrado de un
-- registro de movimiento que sigue siendo cierto.
-- =============================================================================

create table public.account_transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  from_account_id uuid not null references public.accounts (id) on delete restrict,
  to_account_id uuid not null references public.accounts (id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  commission_amount numeric(12, 2) not null default 0 check (commission_amount >= 0),
  expense_id uuid references public.expenses (id) on delete set null,
  transfer_date date not null default (now() at time zone 'utc')::date,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_transfers_distinct_accounts check (from_account_id <> to_account_id)
);

comment on table public.account_transfers is 'Transferencia de dinero entre dos cuentas propias del mismo usuario. El monto transferido (amount) NUNCA genera una fila en expenses/incomes -- es un ajuste puro de saldo entre cuentas (ver account_balances), mismo criterio ya aplicado a debt_movements vinculados a cuenta. Solo la comisión (commission_amount), cuando es > 0, genera una fila real en expenses (categoría "Comisiones bancarias"), porque esa sí es plata perdida de verdad. La comisión siempre la descuenta la cuenta origen; la cuenta destino recibe el monto completo.';
comment on column public.account_transfers.amount is 'Monto transferido de from_account_id hacia to_account_id. Nunca aparece como fila de expenses/incomes -- ver comment on table.';
comment on column public.account_transfers.commission_amount is 'Comisión bancaria cobrada por la transferencia, siempre a cargo de from_account_id. 0 = sin comisión (no genera fila en expenses). Se guarda desnormalizada acá ademas de en el expense generado para poder mostrar/filtrar transferencias sin necesidad de joinear expenses.';
comment on column public.account_transfers.expense_id is 'FK al gasto real generado por la comisión (categoría "Comisiones bancarias"), NULL si commission_amount = 0. on delete set null: la transferencia sigue siendo un registro válido aunque, por algún motivo externo, su expense asociado deje de existir.';
comment on column public.account_transfers.transfer_date is 'Fecha de la transferencia (mismo patrón que expense_date/movement_date en el resto del esquema): default a la fecha UTC actual, no depende del timezone de sesión del servidor.';

create trigger account_transfers_set_updated_at
before update on public.account_transfers
for each row
execute function public.set_updated_at();

-- Refuerza a nivel de datos que from_account_id, to_account_id y (si no es
-- NULL) expense_id pertenezcan todos al mismo user_id de la transferencia.
-- Mismo patrón exacto que expenses_validate_owner/debts_validate_owner/
-- card_expenses_validate_owner.
create function public.account_transfers_validate_owner()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.accounts a
    where a.id = new.from_account_id and a.user_id = new.user_id
  ) then
    raise exception 'from_account_id % no pertenece al usuario %', new.from_account_id, new.user_id;
  end if;

  if not exists (
    select 1 from public.accounts a
    where a.id = new.to_account_id and a.user_id = new.user_id
  ) then
    raise exception 'to_account_id % no pertenece al usuario %', new.to_account_id, new.user_id;
  end if;

  if new.expense_id is not null and not exists (
    select 1 from public.expenses e
    where e.id = new.expense_id and e.user_id = new.user_id
  ) then
    raise exception 'expense_id % no pertenece al usuario %', new.expense_id, new.user_id;
  end if;

  return new;
end;
$$;

create trigger account_transfers_validate_owner_trigger
before insert or update of from_account_id, to_account_id, expense_id, user_id on public.account_transfers
for each row
execute function public.account_transfers_validate_owner();

create index account_transfers_user_id_idx on public.account_transfers (user_id);
-- Usados por el subquery de account_balances (ver 20260720091200) que
-- agrega por separado los roles origen/destino, y candidatos naturales para
-- un futuro guard de borrado de cuenta en el frontend (hoy ya existen los
-- guards "cuenta con movimientos"/"nunca la última cuenta" sobre
-- incomes/expenses; sumar account_transfers a ese conteo no es tarea de
-- esta migración, solo se deja el índice listo).
create index account_transfers_from_account_id_idx on public.account_transfers (from_account_id);
create index account_transfers_to_account_id_idx on public.account_transfers (to_account_id);
