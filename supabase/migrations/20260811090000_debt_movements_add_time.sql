-- Hora opcional en movimientos de deuda (igual que expense_time). Informativa.
alter table public.debt_movements add column movement_time time null;
comment on column public.debt_movements.movement_time is 'Hora opcional del movimiento (sin zona horaria), informativa. NULL = sin hora.';

drop function public.create_debt(uuid, text, numeric, uuid, date, text);

create function public.create_debt(
  p_person_id uuid,
  p_direction text,
  p_amount numeric,
  p_account_id uuid default null,
  p_movement_date date default (now() at time zone 'utc')::date,
  p_description text default null,
  p_movement_time time default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_debt_id uuid;
begin
  if v_user_id is null then
    raise exception 'create_debt requiere un usuario autenticado';
  end if;
  if p_amount <= 0 then
    raise exception 'El monto inicial de una deuda debe ser positivo (amount > 0), recibido %', p_amount;
  end if;

  insert into public.debts (user_id, person_id, direction, description)
  values (v_user_id, p_person_id, p_direction, p_description)
  returning id into v_debt_id;

  insert into public.debt_movements (user_id, debt_id, account_id, amount, movement_date, movement_time)
  values (v_user_id, v_debt_id, p_account_id, p_amount, p_movement_date, p_movement_time);

  return v_debt_id;
end;
$$;
grant execute on function public.create_debt(uuid, text, numeric, uuid, date, text, time) to authenticated;
