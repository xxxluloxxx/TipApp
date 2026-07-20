-- =============================================================================
-- create_account_transfer_function
-- -----------------------------------------------------------------------------
-- Crear una transferencia entre cuentas implica hasta 2 inserts dependientes:
-- (a) si p_commission_amount > 0, una fila real en expenses (la comisión,
-- categoría "Comisiones bancarias") y (b) la fila de account_transfers, cuyo
-- expense_id necesita el id real generado en (a). Mismo motivo/patrón que
-- create_debt / pay_fixed_expense_instance: el cliente no puede insertar
-- optimistamente sin ya tener ese expense_id real que devuelve el servidor,
-- así que ambos inserts van en una única función plpgsql (atómica: si
-- cualquiera falla, rollback completo, nunca queda una transferencia sin su
-- expense de comisión ni un expense de comisión huérfano sin transferencia).
--
-- SECURITY INVOKER (no DEFINER): respeta el RLS y las policies insert_own de
-- quien llama. No se revalida a mano from_account_id/to_account_id/
-- expense_id: el trigger account_transfers_validate_owner_trigger (y, para
-- el expense de comisión, expenses_validate_owner_trigger) ya los refuerzan
-- en el propio insert, mismo criterio documentado en create_debt/
-- pay_fixed_expense_instance para no duplicar chequeos de ownership.
--
-- p_from_account_id <> p_to_account_id se valida acá TAMBIÉN (defensa en
-- profundidad, no solo el check constraint account_transfers_distinct_accounts
-- de la tabla) para devolver un mensaje de error claro antes de intentar
-- ningún insert, en vez de depender del texto genérico de un constraint
-- violation.
--
-- La categoría "Comisiones bancarias" se resuelve por nombre (categoría
-- default, user_id is null, sembrada en
-- 20260720090900_categories_bank_commissions.sql) en vez de hardcodear su
-- uuid: evita depender de un id fijo que no existe todavía al escribir esta
-- migración en un entorno donde el seed pudiera correr en otro orden, y es
-- coherente con category_is_accessible (que tampoco asume ids fijos).
-- =============================================================================

create function public.create_account_transfer(
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount numeric,
  p_commission_amount numeric,
  p_transfer_date date default (now() at time zone 'utc')::date,
  p_description text default null
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
    raise exception 'create_account_transfer requiere un usuario autenticado';
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

    insert into public.expenses (user_id, category_id, account_id, amount, expense_date, description)
    values (
      v_user_id,
      v_commission_category_id,
      p_from_account_id,
      p_commission_amount,
      p_transfer_date,
      'Comisión transferencia'
    )
    returning id into v_expense_id;
  end if;

  insert into public.account_transfers (
    user_id, from_account_id, to_account_id, amount, commission_amount,
    expense_id, transfer_date, description
  )
  values (
    v_user_id, p_from_account_id, p_to_account_id, p_amount, p_commission_amount,
    v_expense_id, p_transfer_date, p_description
  )
  returning id into v_transfer_id;

  return v_transfer_id;
end;
$$;

comment on function public.create_account_transfer is 'Crea una transferencia entre 2 cuentas propias del usuario de forma atómica: si p_commission_amount > 0, primero inserta la comisión como expense real (categoría "Comisiones bancarias"), y recién después la fila de account_transfers con ese expense_id -- evita que el cliente haga 2 inserts secuenciales y deje una transferencia sin su comisión, o una comisión huérfana, si el segundo insert falla. El monto transferido (p_amount) NUNCA genera fila en expenses/incomes, ver comment on table account_transfers. SECURITY INVOKER: respeta el RLS y las policies insert_own de quien llama.';

grant execute on function public.create_account_transfer(uuid, uuid, numeric, numeric, date, text) to authenticated;
