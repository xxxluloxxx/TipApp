-- =============================================================================
-- account_balances_before
-- -----------------------------------------------------------------------------
-- Saldo de cada cuenta del usuario al INICIO de una fecha (solo movimientos
-- con fecha < p_date). Misma fórmula que la vista account_balances (saldo
-- inicial + ingresos - gastos + impacto de deudas vinculadas - transferencias
-- salientes + entrantes), pero acotada por fecha. La usa Reportes para mostrar
-- "con cuánto empieza el periodo" sin sumar listas en el cliente.
-- SECURITY INVOKER: el RLS de cada tabla filtra por usuario.
-- =============================================================================

create function public.account_balances_before(p_date date)
returns table (account_id uuid, name text, balance numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select
    a.id,
    a.name,
    a.initial_balance
      + coalesce((select sum(i.amount) from public.incomes i
                  where i.account_id = a.id and i.income_date < p_date), 0)
      - coalesce((select sum(e.amount) from public.expenses e
                  where e.account_id = a.id and e.expense_date < p_date), 0)
      + coalesce((select sum(case d.direction when 'lent' then -dm.amount
                                              when 'borrowed' then dm.amount end)
                  from public.debt_movements dm
                  join public.debts d on d.id = dm.debt_id
                  where dm.account_id = a.id and dm.movement_date < p_date), 0)
      - coalesce((select sum(t.amount) from public.account_transfers t
                  where t.from_account_id = a.id and t.transfer_date < p_date), 0)
      + coalesce((select sum(t.amount) from public.account_transfers t
                  where t.to_account_id = a.id and t.transfer_date < p_date), 0)
  from public.accounts a
  order by a.sort_order;
$$;

comment on function public.account_balances_before is 'Saldo por cuenta al inicio de p_date (movimientos con fecha < p_date). Misma fórmula que account_balances. SECURITY INVOKER.';

grant execute on function public.account_balances_before(date) to authenticated;
