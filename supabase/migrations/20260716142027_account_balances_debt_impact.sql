-- =============================================================================
-- account_balances_debt_impact
-- -----------------------------------------------------------------------------
-- Extiende account_balances para reflejar el impacto de caja de los
-- debt_movements que tengan account_id no nulo (vínculo opcional a una
-- cuenta real, ver 20260716142024_debt_movements_init.sql), SIN que eso cree
-- ninguna fila en expenses/incomes.
--
-- Por qué no una fila en expenses/incomes (decisión de producto, no técnica):
-- expenses.category_id es NOT NULL y no existe ninguna categoría real para
-- "presté plata" — forzar una categoría sintética tipo "Préstamos"
-- contaminaría el conteo de categorías, monthTotal, presupuestos y
-- estadísticas con algo que conceptualmente NO es un gasto (prestar plata no
-- es gastarla, sigue siendo del usuario). Un ingreso registrado como "me
-- prestaron" tampoco es un ingreso real en el sentido de la app (no es plata
-- ganada). El vínculo a cuenta de un debt_movement es, entonces, un ajuste
-- puro de saldo de cuenta: nunca aparece como fila de "gasto" o "ingreso" en
-- ningún listado. El frontend debe explicarle esto al usuario en el
-- selector de cuenta del formulario de deuda.
--
-- Fórmula del signo (cash_delta por movimiento, no ambigua, 100% derivable
-- de direction + amount):
--   direction = 'lent'     (yo presté)    → cash_delta = -amount
--     (subir el préstamo, amount > 0, es plata que SALE de la cuenta;
--      un abono/cobro, amount < 0, es plata que ENTRA)
--   direction = 'borrowed' (me prestaron) → cash_delta =  amount
--     (que me presten más, amount > 0, es plata que ENTRA a la cuenta;
--      pagar/abonar, amount < 0, es plata que SALE)
--
-- Mismo patrón defensivo que inc/exp: se agrega primero por account_id en su
-- propia subquery (uniendo debt_movements a debts solo para leer direction)
-- y recién después se hace el join final 1-a-1 contra accounts, para no
-- cartesian-joinear tres/cuatro tablas 1-a-muchos directo.
-- =============================================================================

create or replace view public.account_balances
with (security_invoker = true)
as
select
  a.id as account_id,
  a.user_id,
  a.name,
  a.initial_balance
    + coalesce(inc.total, 0)
    - coalesce(exp.total, 0)
    + coalesce(debt.total, 0) as balance
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
) exp on exp.account_id = a.id
left join (
  select
    dm.account_id,
    sum(
      case d.direction
        when 'lent' then -dm.amount
        when 'borrowed' then dm.amount
      end
    ) as total
  from public.debt_movements dm
  join public.debts d on d.id = dm.debt_id
  where dm.account_id is not null
  group by dm.account_id
) debt on debt.account_id = a.id;

comment on view public.account_balances is 'Saldo all-time por cuenta del usuario autenticado: saldo inicial + ingresos - gastos + impacto de caja de movimientos de deuda vinculados a esta cuenta (debt_movements.account_id). El signo del impacto de deuda depende de debts.direction: lent → -amount (prestar saca plata, cobrar la trae), borrowed → +amount (que te presten trae plata, pagar la saca). Los debt_movements vinculados a una cuenta NUNCA generan una fila en expenses/incomes (ver 20260716142027_account_balances_debt_impact.sql): es un ajuste puro de saldo de cuenta. security_invoker=true: corre con el RLS del usuario que consulta, nunca expone cuentas/movimientos de otro usuario.';
