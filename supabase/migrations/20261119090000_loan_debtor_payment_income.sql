-- =============================================================================
-- loan_debtor_payment_income
-- -----------------------------------------------------------------------------
-- El efectivo recibido de una persona del préstamo (amount - offset_amount) ahora
-- entra como un ingreso real en la cuenta elegida. La parte compensada
-- (offset_amount) sigue sin mover plata: solo baja counter_debt_remaining.
-- Pedido del usuario (2026-11-19): antes Préstamos estaba 100% aislado de incomes.
-- =============================================================================

alter table public.loan_debtor_payments
  add column income_id uuid references public.incomes (id) on delete set null;

comment on column public.loan_debtor_payments.income_id is 'Ingreso generado por el efectivo recibido (null si todo fue compensado).';

drop function public.record_loan_debtor_payment(uuid, numeric, numeric, date);

create function public.record_loan_debtor_payment(
  p_loan_debtor_id uuid,
  p_cash numeric,
  p_offset numeric default 0,
  p_payment_date date default (now() at time zone 'utc')::date,
  p_account_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_remaining numeric(12, 2);
  v_person_name text;
  v_loan_name text;
  v_income_id uuid;
  v_payment_id uuid;
begin
  if v_user_id is null then
    raise exception 'record_loan_debtor_payment requiere un usuario autenticado';
  end if;

  if p_cash < 0 or p_offset < 0 or (p_cash + p_offset) <= 0 then
    raise exception 'Monto inválido: efectivo % y compensado % (el total debe ser > 0)', p_cash, p_offset;
  end if;

  select b.counter_debt_remaining, dp.name, l.name
    into v_remaining, v_person_name, v_loan_name
  from public.loan_debtor_balances b
  join public.loan_debtors ld on ld.id = b.loan_debtor_id
  join public.debt_people dp on dp.id = ld.debt_person_id
  join public.loans l on l.id = ld.loan_id
  where b.loan_debtor_id = p_loan_debtor_id and b.user_id = v_user_id;

  if not found then
    raise exception 'loan_debtor % no encontrado o no pertenece al usuario', p_loan_debtor_id;
  end if;

  if p_offset > v_remaining then
    raise exception 'Lo compensado (%) supera lo que le debes a esta persona (%)', p_offset, v_remaining;
  end if;

  if p_cash > 0 then
    if p_account_id is null then
      raise exception 'Hay que indicar la cuenta donde entra el efectivo (p_account_id)';
    end if;
    insert into public.incomes (user_id, account_id, amount, income_date, description)
    values (v_user_id, p_account_id, p_cash, p_payment_date,
            left('Pago de ' || v_person_name || ' · ' || v_loan_name, 200))
    returning id into v_income_id;
  end if;

  insert into public.loan_debtor_payments (user_id, loan_debtor_id, amount, payment_date, offset_amount, income_id)
  values (v_user_id, p_loan_debtor_id, p_cash + p_offset, p_payment_date, p_offset, v_income_id)
  returning id into v_payment_id;

  return v_payment_id;
end;
$$;

comment on function public.record_loan_debtor_payment is 'Registra un pago recibido de una persona del préstamo: el efectivo crea un ingreso en p_account_id y p_offset se descuenta de counter_debt_remaining. Atómico, SECURITY INVOKER.';

grant execute on function public.record_loan_debtor_payment(uuid, numeric, numeric, date, uuid) to authenticated;
notify pgrst, 'reload schema';
