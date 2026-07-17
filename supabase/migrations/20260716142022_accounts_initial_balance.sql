-- =============================================================================
-- accounts_initial_balance
-- -----------------------------------------------------------------------------
-- Saldo inicial opcional de una cuenta: permite que una cuenta arranque en
-- TipApp con el saldo real que ya tenía el usuario en ella (no siempre $0),
-- incluyendo valores negativos (una cuenta puede arrancar en descubierto).
-- Sin check de rango: a diferencia de expenses.amount/incomes.amount (que
-- deben ser > 0 porque representan un movimiento), initial_balance es un
-- saldo de cuenta y puede ser negativo, positivo o cero.
--
-- Backfill: no hace falta ningún `update` manual sobre las filas ya
-- existentes de accounts (incluidas las cuentas "General" creadas por el
-- trigger handle_new_user()/el backfill de 20260716142019). El
-- `not null default 0` de este `alter table` ya completa esas filas con 0,
-- que es el valor correcto para ellas (no tenían noción previa de saldo
-- inicial). A diferencia del backfill de expenses.account_id
-- (20260716142019_expenses_add_account.sql), acá no hay que calcular ni
-- asignar ningún valor real fila por fila.
-- =============================================================================

alter table public.accounts
  add column initial_balance numeric(12, 2) not null default 0;

comment on column public.accounts.initial_balance is 'Saldo inicial de la cuenta al momento de darla de alta en TipApp (ej. plata que el usuario ya tenía antes de empezar a usar la app). Opcional (default 0), admite valores negativos (cuenta que arranca en descubierto). Sin check de rango: a diferencia de amount en expenses/incomes, no representa un movimiento sino un saldo real de cuenta.';

-- -----------------------------------------------------------------------------
-- Recalcula account_balances para sumar el saldo inicial. Mismo criterio que
-- la versión original (20260716142021_account_balances_view.sql):
-- security_invoker = true (corre con el RLS del usuario que consulta) y
-- subqueries separadas por tabla antes del join final, para evitar el
-- fan-out cartesiano de unir dos tablas 1-a-muchos (incomes y expenses)
-- directamente contra accounts.
-- -----------------------------------------------------------------------------
create or replace view public.account_balances
with (security_invoker = true)
as
select
  a.id as account_id,
  a.user_id,
  a.name,
  a.initial_balance + coalesce(inc.total, 0) - coalesce(exp.total, 0) as balance
from public.accounts a
left join (
  select account_id, sum(amount) as total
  from public.incomes
  group by account_id
) inc on inc.account_id = a.id
left join (
  select account_id, sum(amount) as total
  from public.expenses
  group by account_id
) exp on exp.account_id = a.id;

comment on view public.account_balances is 'Saldo all-time (saldo inicial + ingresos - gastos) por cuenta del usuario autenticado. security_invoker=true: corre con el RLS del usuario que consulta, nunca expone cuentas/movimientos de otro usuario.';
