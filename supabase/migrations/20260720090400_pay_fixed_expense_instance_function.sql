-- =============================================================================
-- pay_fixed_expense_instance_function
-- -----------------------------------------------------------------------------
-- Marcar una instancia de gasto fijo como pagada: a diferencia de Deudas
-- (que ajusta el saldo de una cuenta sin dejar ninguna fila visible), acá el
-- pago DEBE materializarse como una fila real de expenses (con su cuenta y
-- categoría) para que aparezca en Transacciones/Estadísticas/dona de
-- categorías sin ningún trabajo extra del frontend — es, literalmente, un
-- gasto más. Por eso esta función hace 2 escrituras dependientes (insert en
-- expenses + update de la instancia) en una única transacción implícita,
-- mismo motivo/patrón que create_debt: el cliente no puede insertar
-- optimistamente sin ya tener el expense_id real que devuelve el servidor.
--
-- SECURITY INVOKER (no DEFINER): respeta el RLS y las policies insert_own/
-- update_own de quien llama. No se revalida a mano la pertenencia de
-- p_account_id: el trigger expenses_validate_owner_trigger (ya existente
-- sobre expenses) la refuerza en el propio insert, mismo criterio que
-- create_debt documenta explícitamente para no duplicar chequeos.
--
-- Decisiones de comportamiento:
--   - Instancia ya 'paid': ERROR (no idempotente). Se prefiere fallar fuerte
--     antes que silenciosamente no hacer nada o, peor, generar un SEGUNDO
--     expense duplicado para el mismo mes — esta función no tiene forma de
--     saber si un reintento del cliente es intencional ("pagar de nuevo") o
--     un doble-click accidental, y la operación tiene un efecto de lado real
--     (una fila de expenses) que no conviene arriesgar a duplicar. Si a
--     futuro se quiere permitir "despagar" una instancia para volver a
--     pagarla, es una función aparte (unpay_fixed_expense_instance), fuera
--     de alcance de este encargo.
--   - p_amount NULL -> usa fixed_expenses.amount de la plantilla (permite
--     ajustar el monto real del mes, ej. luz/gas variable, sin tocar la
--     plantilla).
--   - p_description NULL -> usa fixed_expenses.name como descripción del
--     expense generado (para que la fila en Transacciones tenga un texto
--     útil en vez de quedar vacía).
--   - p_expense_date default: (now() at time zone 'utc')::date, no
--     current_date — mismo criterio ya usado en expenses.expense_date/
--     debts_movement_date (evita depender del timezone de sesión del
--     servidor Postgres).
-- =============================================================================

create function public.pay_fixed_expense_instance(
  p_instance_id uuid,
  p_account_id uuid,
  p_amount numeric default null,
  p_expense_date date default (now() at time zone 'utc')::date,
  p_description text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_fixed_expense_id uuid;
  v_status text;
  v_existing_expense_id uuid;
  v_category_id uuid;
  v_template_amount numeric(12, 2);
  v_name text;
  v_amount numeric(12, 2);
  v_description text;
  v_expense_id uuid;
begin
  if v_user_id is null then
    raise exception 'pay_fixed_expense_instance requiere un usuario autenticado';
  end if;

  select fei.fixed_expense_id, fei.status, fei.expense_id,
         fe.category_id, fe.amount, fe.name
  into v_fixed_expense_id, v_status, v_existing_expense_id,
       v_category_id, v_template_amount, v_name
  from public.fixed_expense_instances fei
  join public.fixed_expenses fe on fe.id = fei.fixed_expense_id
  where fei.id = p_instance_id
    and fei.user_id = v_user_id;

  if not found then
    raise exception 'fixed_expense_instance % no encontrada o no pertenece al usuario', p_instance_id;
  end if;

  if v_status = 'paid' then
    raise exception 'La instancia % ya está pagada (expense_id %); no se puede volver a pagar', p_instance_id, v_existing_expense_id;
  end if;

  if p_amount is not null and p_amount <= 0 then
    raise exception 'El monto del pago debe ser positivo (amount > 0), recibido %', p_amount;
  end if;

  v_amount := coalesce(p_amount, v_template_amount);
  v_description := coalesce(p_description, v_name);

  insert into public.expenses (user_id, category_id, account_id, amount, expense_date, description)
  values (v_user_id, v_category_id, p_account_id, v_amount, p_expense_date, v_description)
  returning id into v_expense_id;

  update public.fixed_expense_instances
  set status = 'paid',
      expense_id = v_expense_id,
      paid_at = now()
  where id = p_instance_id;

  return v_expense_id;
end;
$$;

comment on function public.pay_fixed_expense_instance is 'Marca una fixed_expense_instance como pagada, generando una fila REAL de expenses (con su cuenta y categoría de la plantilla) de forma atómica. NO idempotente: llamar sobre una instancia ya paid lanza excepción (ver comentario de diseño). SECURITY INVOKER: respeta RLS, la validación de account_id/category_id la hace expenses_validate_owner_trigger en el propio insert.';

grant execute on function public.pay_fixed_expense_instance(uuid, uuid, numeric, date, text) to authenticated;
