-- =============================================================================
-- account_balances_transfer_impact
-- -----------------------------------------------------------------------------
-- Extiende account_balances (última versión: 20260716142027, que ya suma el
-- impacto de debt_movements) con un cuarto ingrediente: el impacto de caja
-- del MONTO de account_transfers (amount). Mismo criterio de "ajuste puro
-- de saldo, sin fila de expenses/incomes" ya documentado para
-- debt_movements y para el monto de una transferencia (ver comment on
-- table account_transfers).
--
-- DESVIACIÓN DELIBERADA del boceto original ("la cuenta origen resta amount
-- + commission_amount"): acá se resta ÚNICAMENTE `amount` en el origen, NO
-- `amount + commission_amount`. Restar también la comisión en este subquery
-- la contaría DOS VECES: create_account_transfer (ver
-- 20260720091300_create_account_transfer_function.sql) ya inserta una fila
-- real en public.expenses (account_id = from_account_id, amount =
-- commission_amount, categoría "Comisiones bancarias") cuando
-- commission_amount > 0, y el subquery `exp` de ESTA MISMA vista ya suma
-- (resta) esa fila. Si acá se restara la comisión de nuevo, el saldo de la
-- cuenta origen quedaría subestimado por el doble de la comisión en cada
-- transferencia con comisión > 0. La comisión, entonces, impacta el saldo
-- exclusivamente a través del expense real que genera -- account_transfers
-- solo aporta el impacto del monto transferido en sí.
--
-- account_transfers tiene DOS roles distintos sobre la misma tabla respecto
-- de una cuenta cualquiera:
--   - como ORIGEN (from_account_id): resta amount.
--   - como DESTINO (to_account_id): suma amount (la comisión nunca la ve/
--     paga la cuenta destino, y de cualquier forma no se toca acá).
-- Se agregan en dos subqueries separadas (transfer_out por from_account_id,
-- transfer_in por to_account_id) antes del join final -- mismo criterio
-- defensivo que inc/exp/debt: evita el fan-out cartesiano de unir
-- directamente una tabla 1-a-muchos (y encima con dos roles distintos)
-- contra accounts.
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
    + coalesce(debt.total, 0)
    - coalesce(transfer_out.total, 0)
    + coalesce(transfer_in.total, 0) as balance
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
) debt on debt.account_id = a.id
left join (
  select from_account_id as account_id, sum(amount) as total
  from public.account_transfers
  group by from_account_id
) transfer_out on transfer_out.account_id = a.id
left join (
  select to_account_id as account_id, sum(amount) as total
  from public.account_transfers
  group by to_account_id
) transfer_in on transfer_in.account_id = a.id;

comment on view public.account_balances is 'Saldo all-time por cuenta del usuario autenticado: saldo inicial + ingresos - gastos + impacto de caja de debt_movements vinculados a esta cuenta - transferencias salientes (amount) + transferencias entrantes (amount). El monto de una transferencia y un debt_movement vinculado a cuenta NUNCA generan fila en expenses/incomes (ajuste puro de saldo); la comisión de una transferencia SI genera una fila real en expenses (categoría "Comisiones bancarias"), ya cubierta por el subquery `exp` -- por eso `transfer_out` resta solo `amount`, nunca `amount + commission_amount` (restarla de nuevo acá la contaría dos veces). security_invoker=true: corre con el RLS del usuario que consulta, nunca expone cuentas/movimientos de otro usuario.';
