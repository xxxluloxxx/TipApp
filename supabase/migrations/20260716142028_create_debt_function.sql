-- =============================================================================
-- create_debt_function
-- -----------------------------------------------------------------------------
-- Crear una deuda nueva implica 2 inserts dependientes: la cabecera (debts) +
-- su primer movimiento (debt_movements, con amount > 0 obligatoriamente — no
-- se puede "crear" una deuda con un movimiento negativo). Esto no puede
-- quedar como dos inserts independientes del cliente (riesgo de cabecera
-- huérfana sin movimiento si el segundo insert falla): se resuelve con esta
-- función rpc, que hace ambos inserts en una única transacción implícita
-- (una función plpgsql es atómica: si cualquier insert falla, toda la
-- función hace rollback, no queda ninguna fila creada).
--
-- SECURITY INVOKER (no DEFINER): corre con los permisos y el RLS de quien
-- llama, igual que la vista account_balances/debt_balances. No hay ninguna
-- razón para bypassear RLS acá (a diferencia de handle_new_user, que
-- necesita tocar auth.users) — el invoker ya cumple las policies
-- *_insert_own de debts/debt_movements, y los triggers
-- debts_validate_owner_trigger / debt_movements_validate_owner_trigger ya
-- refuerzan a nivel de datos que person_id/account_id pertenezcan al mismo
-- usuario. No hace falta duplicar ningún chequeo de ownership manual en el
-- body.
--
-- p_description se guarda en debts.description (el label corto del hilo de
-- deuda, ej. "Préstamo personal"). El primer debt_movement queda con su
-- propia description en NULL: es el movimiento inicial, su nota ya está
-- cubierta por la del hilo: si en el futuro hace falta una nota distinta
-- para el movimiento inicial, se puede actualizar aparte con un update
-- normal sobre debt_movements (cubierto por las mismas policies).
-- =============================================================================

create function public.create_debt(
  p_person_id uuid,
  p_direction text,
  p_amount numeric,
  p_account_id uuid default null,
  p_movement_date date default (now() at time zone 'utc')::date,
  p_description text default null
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

  insert into public.debt_movements (user_id, debt_id, account_id, amount, movement_date)
  values (v_user_id, v_debt_id, p_account_id, p_amount, p_movement_date);

  return v_debt_id;
end;
$$;

comment on function public.create_debt is 'Crea una deuda nueva (cabecera debts + primer debt_movement con amount > 0) de forma atómica, evitando que el cliente haga 2 inserts secuenciales y deje una cabecera huérfana si el segundo falla. SECURITY INVOKER: respeta el RLS y las policies insert_own de quien llama, no bypassea nada.';

grant execute on function public.create_debt(uuid, text, numeric, uuid, date, text) to authenticated;
