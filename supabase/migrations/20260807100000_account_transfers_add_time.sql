-- Hora opcional en transferencias (igual que expenses.expense_time / incomes.income_time).
-- Puramente informativa: la fecha sigue siendo la única fuente de verdad para filtros y saldos.
alter table public.account_transfers add column transfer_time time null;
comment on column public.account_transfers.transfer_time is 'Hora opcional de la transferencia (sin zona horaria), informativa. NULL = sin hora registrada.';

-- Se reemplazan las firmas (agregan p_transfer_time) para evitar sobrecargas ambiguas.
drop function public.create_account_transfer(uuid, uuid, numeric, numeric, date, text);
drop function public.update_account_transfer(uuid, uuid, uuid, numeric, numeric, date, text);
drop function public._account_transfer_insert(uuid, uuid, numeric, numeric, date, text);

create function public._account_transfer_insert(
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount numeric,
  p_commission_amount numeric,
  p_transfer_date date,
  p_description text,
  p_transfer_time time default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_commission_category_id uuid;
  v_expense_id uuid;
  v_transfer_id uuid;
begin
  if v_user_id is null then
    raise exception '_account_transfer_insert requiere un usuario autenticado';
  end if;
  if p_from_account_id = p_to_account_id then
    raise exception 'from_account_id y to_account_id no pueden ser la misma cuenta (%).', p_from_account_id;
  end if;
  if p_amount <= 0 then
    raise exception 'El monto transferido debe ser positivo (amount > 0), recibido %', p_amount;
  end if;
  if p_commission_amount < 0 then
    raise exception 'La comisión no puede ser negativa, recibido %', p_commission_amount;
  end if;

  if p_commission_amount > 0 then
    select id into v_commission_category_id
    from public.categories
    where user_id is null and lower(name) = lower('Comisiones bancarias')
    limit 1;

    if v_commission_category_id is null then
      raise exception 'No se encontró la categoría default "Comisiones bancarias"';
    end if;

    insert into public.expenses (user_id, category_id, account_id, amount, expense_date, expense_time, description)
    values (v_user_id, v_commission_category_id, p_from_account_id, p_commission_amount,
            p_transfer_date, p_transfer_time, 'Comisión transferencia')
    returning id into v_expense_id;
  end if;

  insert into public.account_transfers (
    user_id, from_account_id, to_account_id, amount, commission_amount,
    expense_id, transfer_date, transfer_time, description
  )
  values (
    v_user_id, p_from_account_id, p_to_account_id, p_amount, p_commission_amount,
    v_expense_id, p_transfer_date, p_transfer_time, p_description
  )
  returning id into v_transfer_id;

  return v_transfer_id;
end;
$$;
grant execute on function public._account_transfer_insert(uuid, uuid, numeric, numeric, date, text, time) to authenticated;

create function public.create_account_transfer(
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount numeric,
  p_commission_amount numeric,
  p_transfer_date date default (now() at time zone 'utc')::date,
  p_description text default null,
  p_transfer_time time default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
begin
  return public._account_transfer_insert(
    p_from_account_id, p_to_account_id, p_amount, p_commission_amount,
    p_transfer_date, p_description, p_transfer_time
  );
end;
$$;
grant execute on function public.create_account_transfer(uuid, uuid, numeric, numeric, date, text, time) to authenticated;

create function public.update_account_transfer(
  p_transfer_id uuid,
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount numeric,
  p_commission_amount numeric,
  p_transfer_date date,
  p_description text,
  p_transfer_time time default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_new_id uuid;
begin
  perform public._account_transfer_delete(p_transfer_id);
  v_new_id := public._account_transfer_insert(
    p_from_account_id, p_to_account_id, p_amount, p_commission_amount,
    p_transfer_date, p_description, p_transfer_time
  );
  return v_new_id;
end;
$$;
grant execute on function public.update_account_transfer(uuid, uuid, uuid, numeric, numeric, date, text, time) to authenticated;
