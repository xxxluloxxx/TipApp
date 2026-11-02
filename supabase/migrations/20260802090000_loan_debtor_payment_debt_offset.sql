-- =============================================================================
-- loan_debtor_payment_debt_offset
-- -----------------------------------------------------------------------------
-- Un pago recibido de una persona de un préstamo puede cubrirse en parte con
-- plata que el usuario le debe a esa misma persona (Deudas, direction
-- 'borrowed'): p. ej. el papá debe 150/mes del préstamo, da 75 en efectivo y
-- los otros 75 se abonan a lo que el usuario le debe a él.
--
-- loan_debtor_payments.amount sigue siendo el total que cubre del préstamo
-- (efectivo + compensado), así las vistas loan_debtor_balances no cambian.
-- offset_amount es la parte compensada; offset_debt_movement_id apunta al
-- abono (monto negativo, sin cuenta) creado en debt_movements. Como no tiene
-- account_id, no toca account_balances ni genera expenses/incomes.
--
-- Borrar el pago borra su abono (trigger), para que no quede una deuda
-- reducida sin el pago que la justificaba.
-- =============================================================================

alter table public.loan_debtor_payments
  add column offset_amount numeric(12, 2) not null default 0
    check (offset_amount >= 0 and offset_amount <= amount),
  add column offset_debt_movement_id uuid
    references public.debt_movements (id) on delete set null;

comment on column public.loan_debtor_payments.offset_amount is 'Parte de amount cubierta compensando una deuda del usuario con esta persona (no entró plata). El efectivo recibido es amount - offset_amount.';
comment on column public.loan_debtor_payments.offset_debt_movement_id is 'Abono (amount negativo, sin cuenta) generado en debt_movements por la compensación. Se borra junto con el pago.';

create function public.loan_debtor_payments_delete_offset_movement()
returns trigger
language plpgsql
as $$
begin
  if old.offset_debt_movement_id is not null then
    delete from public.debt_movements where id = old.offset_debt_movement_id;
  end if;
  return old;
end;
$$;

create trigger loan_debtor_payments_delete_offset_movement_trigger
after delete on public.loan_debtor_payments
for each row
execute function public.loan_debtor_payments_delete_offset_movement();

create function public.record_loan_debtor_payment(
  p_loan_debtor_id uuid,
  p_cash numeric,
  p_offset numeric default 0,
  p_debt_id uuid default null,
  p_payment_date date default (now() at time zone 'utc')::date
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_person_id uuid;
  v_movement_id uuid;
  v_payment_id uuid;
begin
  if v_user_id is null then
    raise exception 'record_loan_debtor_payment requiere un usuario autenticado';
  end if;

  if p_cash < 0 or p_offset < 0 or (p_cash + p_offset) <= 0 then
    raise exception 'Monto inválido: efectivo % y compensado % (el total debe ser > 0)', p_cash, p_offset;
  end if;

  select debt_person_id into v_person_id
  from public.loan_debtors
  where id = p_loan_debtor_id and user_id = v_user_id;

  if not found then
    raise exception 'loan_debtor % no encontrado o no pertenece al usuario', p_loan_debtor_id;
  end if;

  if p_offset > 0 then
    if p_debt_id is null then
      raise exception 'Para compensar hay que indicar la deuda (p_debt_id)';
    end if;

    if not exists (
      select 1 from public.debts d
      where d.id = p_debt_id
        and d.user_id = v_user_id
        and d.direction = 'borrowed'
        and d.person_id = v_person_id
    ) then
      raise exception 'La deuda % no es una deuda tuya con esta persona', p_debt_id;
    end if;

    insert into public.debt_movements (user_id, debt_id, account_id, amount, movement_date, description)
    values (v_user_id, p_debt_id, null, -p_offset, p_payment_date, 'Compensado con pago de préstamo')
    returning id into v_movement_id;
  end if;

  insert into public.loan_debtor_payments
    (user_id, loan_debtor_id, amount, payment_date, offset_amount, offset_debt_movement_id)
  values
    (v_user_id, p_loan_debtor_id, p_cash + p_offset, p_payment_date, p_offset, v_movement_id)
  returning id into v_payment_id;

  return v_payment_id;
end;
$$;

comment on function public.record_loan_debtor_payment is 'Registra un pago recibido de una persona de un préstamo, opcionalmente compensando parte contra una deuda del usuario con ella (abono sin cuenta en debt_movements), de forma atómica. SECURITY INVOKER.';

grant execute on function public.record_loan_debtor_payment(uuid, numeric, numeric, uuid, date) to authenticated;
