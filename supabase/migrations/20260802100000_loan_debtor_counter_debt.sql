-- =============================================================================
-- loan_debtor_counter_debt
-- -----------------------------------------------------------------------------
-- Rediseño de 20260802090000: la compensación NO usa el módulo Deudas. Lo que
-- el usuario le debe a una persona del préstamo se lleva DENTRO de Préstamos:
-- loan_debtors.counter_debt_amount (lo que yo le debo a esa persona) y cada
-- pago puede cubrir parte con offset_amount (no entra efectivo, se descuenta
-- de esa deuda). counter_debt_remaining = counter_debt_amount - sum(offset).
-- Sin debt_movements, sin cuentas, sin expenses/incomes.
-- =============================================================================

drop trigger loan_debtor_payments_delete_offset_movement_trigger on public.loan_debtor_payments;
drop function public.loan_debtor_payments_delete_offset_movement();
drop function public.record_loan_debtor_payment(uuid, numeric, numeric, uuid, date);
alter table public.loan_debtor_payments drop column offset_debt_movement_id;

comment on column public.loan_debtor_payments.offset_amount is 'Parte de amount cubierta descontándola de loan_debtors.counter_debt_amount (lo que el usuario le debe a esa persona); no entró como efectivo. Efectivo recibido = amount - offset_amount.';

alter table public.loan_debtors
  add column counter_debt_amount numeric(12, 2) not null default 0
    check (counter_debt_amount >= 0);

comment on column public.loan_debtors.counter_debt_amount is 'Lo que el usuario le debe a esta persona (deuda propia, llevada dentro de Préstamos). Se va descontando con loan_debtor_payments.offset_amount.';

-- Columnas nuevas al final (create or replace view exige conservar el orden).
create or replace view public.loan_debtor_balances
with (security_invoker = true)
as
select
  ld.id as loan_debtor_id,
  ld.user_id,
  ld.loan_id,
  ld.debt_person_id,
  ld.amount_owed,
  coalesce(tot.amount_received, 0) as amount_received,
  ld.amount_owed - coalesce(tot.amount_received, 0) as balance_remaining,
  last.payment_date as last_payment_date,
  last.amount as last_payment_amount,
  ld.counter_debt_amount,
  ld.counter_debt_amount - coalesce(tot.offset_total, 0) as counter_debt_remaining
from public.loan_debtors ld
left join lateral (
  select coalesce(sum(ldp.amount), 0) as amount_received,
         coalesce(sum(ldp.offset_amount), 0) as offset_total
  from public.loan_debtor_payments ldp
  where ldp.loan_debtor_id = ld.id
) tot on true
left join lateral (
  select ldp.payment_date, ldp.amount
  from public.loan_debtor_payments ldp
  where ldp.loan_debtor_id = ld.id
  order by ldp.payment_date desc, ldp.created_at desc
  limit 1
) last on true;

create function public.record_loan_debtor_payment(
  p_loan_debtor_id uuid,
  p_cash numeric,
  p_offset numeric default 0,
  p_payment_date date default (now() at time zone 'utc')::date
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_remaining numeric(12, 2);
  v_payment_id uuid;
begin
  if v_user_id is null then
    raise exception 'record_loan_debtor_payment requiere un usuario autenticado';
  end if;

  if p_cash < 0 or p_offset < 0 or (p_cash + p_offset) <= 0 then
    raise exception 'Monto inválido: efectivo % y compensado % (el total debe ser > 0)', p_cash, p_offset;
  end if;

  select counter_debt_remaining into v_remaining
  from public.loan_debtor_balances
  where loan_debtor_id = p_loan_debtor_id and user_id = v_user_id;

  if not found then
    raise exception 'loan_debtor % no encontrado o no pertenece al usuario', p_loan_debtor_id;
  end if;

  if p_offset > v_remaining then
    raise exception 'Lo compensado (%) supera lo que le debes a esta persona (%)', p_offset, v_remaining;
  end if;

  insert into public.loan_debtor_payments (user_id, loan_debtor_id, amount, payment_date, offset_amount)
  values (v_user_id, p_loan_debtor_id, p_cash + p_offset, p_payment_date, p_offset)
  returning id into v_payment_id;

  return v_payment_id;
end;
$$;

comment on function public.record_loan_debtor_payment is 'Registra un pago recibido de una persona de un préstamo; p_offset es la parte cubierta descontándola de lo que el usuario le debe (counter_debt_remaining). SECURITY INVOKER.';

grant execute on function public.record_loan_debtor_payment(uuid, numeric, numeric, date) to authenticated;
