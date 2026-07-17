-- =============================================================================
-- debt_balances_view
-- -----------------------------------------------------------------------------
-- Saldo corriente por deuda: sum(debt_movements.amount), agregado en el
-- servidor. Mismo criterio ya usado en account_balances
-- (20260716142021/20260716142022): vista con security_invoker = true (corre
-- con el RLS del usuario que consulta, nunca expone deudas/movimientos de
-- otro usuario) y subquery agregada por debt_id antes del join contra debts,
-- para devolver una fila por deuda sin fan-out.
--
-- Se incluyen user_id y direction (vía join a debts) para que el frontend no
-- tenga que hacer un segundo join solo para tener esos dos campos junto al
-- saldo.
--
-- El "estado" (Pendiente/Saldada) NO se materializa como columna acá: se
-- deriva en el frontend de `balance > 0`. Es un valor puramente derivado del
-- saldo, no una fuente de verdad independiente.
-- =============================================================================

create view public.debt_balances
with (security_invoker = true)
as
select
  d.id as debt_id,
  d.user_id,
  d.direction,
  coalesce(m.total, 0) as balance
from public.debts d
left join (
  select debt_id, sum(amount) as total
  from public.debt_movements
  group by debt_id
) m on m.debt_id = d.id;

comment on view public.debt_balances is 'Saldo corriente por deuda (sum(debt_movements.amount)) del usuario autenticado, con direction para evitar un segundo join en el frontend. security_invoker=true: corre con el RLS del usuario que consulta. El estado Pendiente/Saldada NO se materializa como columna: se deriva de balance > 0 en el frontend. Sin constraint que impida un balance negativo por sobrepago (abono mayor al saldo pendiente) — decisión deliberada, no se resuelve con una constraint dura en esta fase.';

grant select on public.debt_balances to authenticated;
