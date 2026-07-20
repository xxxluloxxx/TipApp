-- =============================================================================
-- account_transfer_edit_delete_functions
-- -----------------------------------------------------------------------------
-- Segunda ronda (pedido por ui-ux-designer/Product Owner tras revisar
-- docs/features/account-transfers-ux.md sección 4.3): editar/borrar una
-- transferencia existente es tan multi-efecto como crearla (hay que
-- reversar los deltas de las DOS cuentas + la fila de comisión vieja -que
-- puede no existir- antes de aplicar los nuevos), así que necesita el
-- mismo tratamiento atómico no-optimista que create_account_transfer.
--
-- Diseño elegido para evitar triplicar la lógica de validación/inserción en
-- 3 lugares (create/update/delete):
--   - public._account_transfer_insert(...): TODO el cuerpo que antes vivía
--     inline en create_account_transfer (validaciones + insert opcional de
--     la comisión en expenses + insert de account_transfers). Prefijo `_`
--     por convención (no está pensada como punto de entrada principal),
--     pero NO es privada en el sentido de Postgres -- ver nota de permisos
--     más abajo.
--   - public._account_transfer_delete(...): borra el expense de comisión
--     (si existe) y la fila de account_transfers.
--   - create_account_transfer pasa a ser un wrapper de una línea sobre
--     _account_transfer_insert (mismo comportamiento externo, sin ningún
--     cambio de firma ni de contrato para el frontend).
--   - delete_account_transfer es un wrapper de una línea sobre
--     _account_transfer_delete.
--   - update_account_transfer: NO reversa deltas a mano. Hace
--     _account_transfer_delete(p_transfer_id) seguido de
--     _account_transfer_insert(...) con los valores nuevos, ambos dentro de
--     la misma transacción implícita de esta función. Se prefiere este
--     enfoque "borrar + recrear" sobre un UPDATE literal de la fila porque
--     reusa exactamente la misma lógica ya probada de create (sin
--     reimplementar el cálculo de deltas ni la resolución de la categoría
--     de comisión una tercera vez) -- exactamente lo que sugirió el pedido.
--
--     Contrato importante para vue-frontend-expert: update_account_transfer
--     devuelve un id NUEVO, distinto de p_transfer_id (la fila vieja se
--     borra, se inserta una nueva). El frontend NO puede asumir que el id
--     de una transferencia es estable a través de una edición -- debe
--     tratar el resultado de esta RPC como "la transferencia vieja ya no
--     existe, esta es la que la reemplaza" (actualizar cualquier referencia
--     local, key de lista, etc. con el id devuelto). Se documenta acá en
--     mayúscula porque es la única función de edición del proyecto que NO
--     preserva el id de la fila editada (a diferencia de
--     update/deleteMovement de debts, que sí actualizan la fila en su
--     lugar).
--
-- SECURITY INVOKER en las 4 (helpers incluidos): ninguna necesita bypassear
-- RLS. delete_account_transfer/_account_transfer_delete NO revalidan
-- ownership a mano -- las policies delete_own/select_own de
-- account_transfers/expenses ya lo garantizan: si p_transfer_id no existe o
-- no es del usuario que llama, el select inicial no encuentra la fila
-- (RLS la oculta), v_expense_id queda NULL, y los deletes subsiguientes
-- afectan 0 filas -- no se lanza excepción, simplemente no borra nada,
-- exactamente el comportamiento pedido.
--
-- Nota de permisos: _account_transfer_insert/_account_transfer_delete
-- están en el mismo schema public y son SECURITY INVOKER, así que cuando
-- create_account_transfer/update_account_transfer (llamadas por el rol
-- `authenticated`) las invocan internamente, Postgres sigue evaluando los
-- permisos con ese mismo rol invocador -- por eso también necesitan su
-- propio `grant execute ... to authenticated`, aunque no sean la puerta de
-- entrada pensada para el frontend (que debe seguir usando
-- create/update/delete_account_transfer, no los helpers con `_`).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: inserta la comisión (si aplica) + la fila de account_transfers.
-- Mismo cuerpo que la versión anterior de create_account_transfer
-- (20260720091300), sin cambios de comportamiento -- solo se extrajo para
-- que update_account_transfer pueda reusarla sin duplicar código.
-- -----------------------------------------------------------------------------
create function public._account_transfer_insert(
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount numeric,
  p_commission_amount numeric,
  p_transfer_date date,
  p_description text
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

comment on function public._account_transfer_insert is 'Helper interno (no es la puerta de entrada pensada para el frontend): inserta la comisión real en expenses (si p_commission_amount > 0) y la fila de account_transfers. Compartido por create_account_transfer y update_account_transfer para no duplicar esta lógica. SECURITY INVOKER: respeta RLS, requiere grant execute a authenticated igual que cualquier función invocada por ese rol.';

grant execute on function public._account_transfer_insert(uuid, uuid, numeric, numeric, date, text) to authenticated;

-- -----------------------------------------------------------------------------
-- create_account_transfer: ahora un wrapper de una línea. Sin cambios de
-- firma/comportamiento respecto de 20260720091300 -- create or replace
-- reemplaza el cuerpo, no la interfaz pública.
-- -----------------------------------------------------------------------------
create or replace function public.create_account_transfer(
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
begin
  return public._account_transfer_insert(
    p_from_account_id, p_to_account_id, p_amount, p_commission_amount, p_transfer_date, p_description
  );
end;
$$;

comment on function public.create_account_transfer is 'Crea una transferencia entre 2 cuentas propias del usuario de forma atómica (ver public._account_transfer_insert para el detalle). El monto transferido (p_amount) NUNCA genera fila en expenses/incomes, ver comment on table account_transfers. SECURITY INVOKER: respeta el RLS y las policies insert_own de quien llama.';

-- -----------------------------------------------------------------------------
-- Helper: borra el expense de comisión (si existe) y la fila de
-- account_transfers. Sin revalidar ownership a mano: el select inicial y
-- ambos deletes ya están sujetos a las policies select_own/delete_own de
-- account_transfers/expenses -- si la fila no es del usuario que llama,
-- el select no la encuentra (RLS la oculta) y los deletes no afectan
-- ninguna fila.
-- -----------------------------------------------------------------------------
create function public._account_transfer_delete(p_transfer_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_expense_id uuid;
begin
  select expense_id into v_expense_id
  from public.account_transfers
  where id = p_transfer_id;

  if v_expense_id is not null then
    delete from public.expenses where id = v_expense_id;
  end if;

  delete from public.account_transfers where id = p_transfer_id;
end;
$$;

comment on function public._account_transfer_delete is 'Helper interno: borra el expense de comisión (si expense_id no es NULL) y la fila de account_transfers. Compartido por delete_account_transfer y update_account_transfer. Si p_transfer_id no existe o no pertenece al usuario que llama, RLS oculta la fila y la función no borra nada (no lanza excepción). SECURITY INVOKER.';

grant execute on function public._account_transfer_delete(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- delete_account_transfer: puerta de entrada pública para borrar una
-- transferencia completa (comisión + fila). No idempotente en el sentido
-- de "avisar" -- si se llama sobre un id que no existe o no es del usuario,
-- simplemente no hace nada (0 filas afectadas), no lanza excepción (mismo
-- criterio pedido: no complicarlo con un chequeo `found`/`raise` extra).
-- -----------------------------------------------------------------------------
create function public.delete_account_transfer(p_transfer_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform public._account_transfer_delete(p_transfer_id);
end;
$$;

comment on function public.delete_account_transfer is 'Borra una transferencia completa: primero su expense de comisión (si existe), después la fila de account_transfers, en una sola transacción implícita. Si p_transfer_id no existe o no pertenece al usuario autenticado, no borra nada (RLS ya lo impide, sin necesidad de revalidar a mano) -- no lanza excepción. SECURITY INVOKER.';

grant execute on function public.delete_account_transfer(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- update_account_transfer: borra la transferencia vieja (comisión + fila)
-- y crea una nueva con los valores editados, en una única transacción
-- implícita. Ver el comentario largo al inicio de esta migración para la
-- justificación completa de "borrar + recrear con id nuevo" en vez de un
-- UPDATE in-place, y el contrato resultante (el id CAMBIA) que
-- vue-frontend-expert debe conocer.
-- -----------------------------------------------------------------------------
create function public.update_account_transfer(
  p_transfer_id uuid,
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount numeric,
  p_commission_amount numeric,
  p_transfer_date date,
  p_description text
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
    p_from_account_id, p_to_account_id, p_amount, p_commission_amount, p_transfer_date, p_description
  );

  return v_new_id;
end;
$$;

comment on function public.update_account_transfer is 'Edita una transferencia existente borrando la vieja (comisión + fila) y creando una nueva con los valores editados, en una única transacción implícita -- evita reimplementar el cálculo de deltas/resolución de categoría de comisión una tercera vez. DEVUELVE UN ID NUEVO, distinto de p_transfer_id: el frontend debe tratar la transferencia vieja como reemplazada, no editada in-place. Si p_transfer_id no existe o no pertenece al usuario, el borrado no afecta nada y la función igual crea la transferencia nueva con los valores recibidos (no falla por "nada que borrar"). SECURITY INVOKER.';

grant execute on function public.update_account_transfer(uuid, uuid, uuid, numeric, numeric, date, text) to authenticated;
