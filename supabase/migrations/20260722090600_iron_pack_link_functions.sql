-- =============================================================================
-- iron_pack_link_functions
-- -----------------------------------------------------------------------------
-- Funciones no-optimistas para el vínculo opcional opt-in de iron_packs a
-- expenses reales (docs/features/iron-ux.md secciones 1.6, 2.4-2.6). Una
-- compra de cajetilla SIN vínculo (linked_expense_id NULL) es un insert/
-- update/delete simple y optimista de una sola tabla -- no necesita ninguna
-- función acá, ya cubierto por las policies *_own de iron_packs
-- (20260722090200).
--
-- Helper: public._iron_pack_tobacco_category_id() -- resuelve la categoría
-- default "Tabaco" POR NOMBRE (nunca por id hardcodeado, mismo criterio
-- exacto que "Comisiones bancarias"/"Ajuste de saldo"), reusado por
-- create_iron_pack_linked y la rama de update_iron_pack que activa el
-- vínculo, para no duplicar esta resolución + su mensaje de error dos
-- veces.
--
-- create_iron_pack_linked: inserta el expense real (categoría "Tabaco") +
-- la fila de iron_packs con linked_expense_id ya resuelto, en una sola
-- transacción -- no optimista, mismo motivo que create_debt/
-- pay_fixed_expense_instance (el cliente no puede fabricar de antemano el
-- id real del expense).
--
-- update_iron_pack: maneja los 3 casos posibles de la sección 2.6 sin que
-- el cliente tenga que orquestar llamadas separadas, y SIEMPRE preserva el
-- id de iron_packs (a diferencia de update_account_transfer, que borra y
-- recrea -- acá no hay ninguna asimetría monto-vs-comisión que lo
-- justifique: un único monto, un único expense posible):
--   1. Vínculo sin cambios y sigue vinculada: actualiza el expense YA
--      EXISTENTE en el lugar (mismo expense_id, nunca se recrea) + los
--      campos de iron_packs.
--   2. Vínculo sin cambios y nunca estuvo vinculada: update simple de
--      iron_packs, sin tocar expenses.
--   3. Se activa el vínculo en la edición (antes no vinculada, ahora sí):
--      crea el expense nuevo (mismo helper de categoría) y deja
--      linked_expense_id resuelto.
--   4. Se desactiva el vínculo en la edición (antes vinculada, ahora no):
--      borra el expense existente y pone linked_expense_id = NULL.
--
-- A diferencia de delete_account_transfer/update_account_transfer (que son
-- permisivos: si el id no existe o no es del usuario, simplemente no hacen
-- nada), update_iron_pack LANZA EXCEPCIÓN si p_pack_id no existe o no
-- pertenece al usuario autenticado -- necesita conocer el estado ANTERIOR
-- real (¿estaba vinculada o no?) para elegir la rama correcta, así que no
-- hay una interpretación segura de "no encontrado" distinta de fallar
-- fuerte (mismo criterio que pay_fixed_expense_instance sobre una
-- instancia inexistente).
--
-- delete_iron_pack SÍ seguir el patrón permisivo de _account_transfer_delete
-- (si p_pack_id no existe o no es del usuario, RLS oculta la fila,
-- v_expense_id queda NULL, y el delete final no afecta ninguna fila -- no
-- se lanza excepción): borrar es una operación que no necesita conocer
-- ningún estado adicional para decidir qué hacer.
--
-- SECURITY INVOKER en las 4 (helper incluido): ninguna necesita bypassear
-- RLS -- las policies *_own de iron_packs/expenses ya alcanzan, igual que
-- create_debt/create_account_transfer.
-- =============================================================================

create function public._iron_pack_tobacco_category_id()
returns uuid
language sql
stable
security invoker
set search_path = public
as $$
  select id
  from public.categories
  where user_id is null and lower(name) = lower('Tabaco')
  limit 1;
$$;

comment on function public._iron_pack_tobacco_category_id is 'Helper interno: resuelve el id de la categoría default "Tabaco" por nombre (nunca hardcodeado). Reusado por create_iron_pack_linked y update_iron_pack.';

grant execute on function public._iron_pack_tobacco_category_id() to authenticated;

-- -----------------------------------------------------------------------------
-- create_iron_pack_linked: alta de una cajetilla YA vinculada desde el
-- primer momento.
-- -----------------------------------------------------------------------------
create function public.create_iron_pack_linked(
  p_cost numeric,
  p_purchased_date date,
  p_purchased_time time,
  p_account_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_category_id uuid;
  v_expense_id uuid;
  v_pack_id uuid;
begin
  if v_user_id is null then
    raise exception 'create_iron_pack_linked requiere un usuario autenticado';
  end if;

  if p_cost <= 0 then
    raise exception 'El costo de la cajetilla debe ser positivo (cost > 0), recibido %', p_cost;
  end if;

  if p_account_id is null then
    raise exception 'p_account_id es obligatorio para una compra vinculada';
  end if;

  v_category_id := public._iron_pack_tobacco_category_id();
  if v_category_id is null then
    raise exception 'No se encontró la categoría default "Tabaco"';
  end if;

  insert into public.expenses (user_id, category_id, account_id, amount, expense_date, expense_time, description)
  values (v_user_id, v_category_id, p_account_id, p_cost, p_purchased_date, p_purchased_time, 'Compra de cajetilla')
  returning id into v_expense_id;

  insert into public.iron_packs (user_id, cost, purchased_date, purchased_time, linked_expense_id)
  values (v_user_id, p_cost, p_purchased_date, p_purchased_time, v_expense_id)
  returning id into v_pack_id;

  return v_pack_id;
end;
$$;

comment on function public.create_iron_pack_linked is 'Crea una compra de cajetilla vinculada: inserta el expense real (categoría "Tabaco") + la fila de iron_packs con linked_expense_id ya resuelto, en una única transacción implícita. SECURITY INVOKER: respeta RLS y las policies insert_own de quien llama.';

grant execute on function public.create_iron_pack_linked(numeric, date, time, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- update_iron_pack: edición que cubre los 3 casos de la sección 2.6.
-- p_link=true + p_account_id=NULL es un error (cuenta obligatoria mientras
-- el vínculo está/queda activo). p_account_id se ignora si p_link=false.
-- -----------------------------------------------------------------------------
create function public.update_iron_pack(
  p_pack_id uuid,
  p_cost numeric,
  p_purchased_date date,
  p_purchased_time time,
  p_link boolean,
  p_account_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_old_expense_id uuid;
  v_was_linked boolean;
  v_category_id uuid;
  v_new_expense_id uuid;
begin
  if v_user_id is null then
    raise exception 'update_iron_pack requiere un usuario autenticado';
  end if;

  if p_cost <= 0 then
    raise exception 'El costo de la cajetilla debe ser positivo (cost > 0), recibido %', p_cost;
  end if;

  if p_link and p_account_id is null then
    raise exception 'p_account_id es obligatorio mientras el vínculo está activo';
  end if;

  select linked_expense_id
  into v_old_expense_id
  from public.iron_packs
  where id = p_pack_id
    and user_id = v_user_id;

  if not found then
    raise exception 'iron_pack % no encontrado o no pertenece al usuario', p_pack_id;
  end if;

  v_was_linked := v_old_expense_id is not null;

  if v_was_linked and p_link then
    -- Caso 1: seguía vinculada -- actualiza el expense YA EXISTENTE en el
    -- lugar (nunca se recrea, a diferencia de update_account_transfer).
    update public.expenses
    set amount = p_cost,
        expense_date = p_purchased_date,
        expense_time = p_purchased_time,
        account_id = p_account_id
    where id = v_old_expense_id;

  elsif (not v_was_linked) and p_link then
    -- Caso 2: se activa el vínculo en esta edición -- crea el expense nuevo.
    v_category_id := public._iron_pack_tobacco_category_id();
    if v_category_id is null then
      raise exception 'No se encontró la categoría default "Tabaco"';
    end if;

    insert into public.expenses (user_id, category_id, account_id, amount, expense_date, expense_time, description)
    values (v_user_id, v_category_id, p_account_id, p_cost, p_purchased_date, p_purchased_time, 'Compra de cajetilla')
    returning id into v_new_expense_id;

  elsif v_was_linked and (not p_link) then
    -- Caso 3: se desactiva el vínculo en esta edición -- borra el expense
    -- existente.
    delete from public.expenses where id = v_old_expense_id;
  end if;
  -- Caso implícito (not v_was_linked and not p_link): nunca estuvo
  -- vinculada y sigue sin estarlo -- no toca expenses, solo actualiza
  -- iron_packs abajo. El doc (sección 2.6) espera que este caso se resuelva
  -- de forma optimista en el cliente sin llamar a esta función, pero se
  -- soporta igual acá por robustez/idempotencia si el cliente la llama de
  -- todos modos.

  update public.iron_packs
  set cost = p_cost,
      purchased_date = p_purchased_date,
      purchased_time = p_purchased_time,
      linked_expense_id = case
        when v_was_linked and p_link then v_old_expense_id
        when (not v_was_linked) and p_link then v_new_expense_id
        when v_was_linked and (not p_link) then null
        else linked_expense_id
      end
  where id = p_pack_id;

  return p_pack_id;
end;
$$;

comment on function public.update_iron_pack is 'Edita una compra de cajetilla existente, resolviendo los 3 casos de vínculo (sin cambios/se activa/se desactiva) en una única transacción implícita. SIEMPRE preserva el id de iron_packs; preserva también el id del expense existente cuando el vínculo sigue activo (a diferencia de update_account_transfer, que recrea). Lanza excepción si p_pack_id no existe o no pertenece al usuario autenticado (necesita el estado anterior real para elegir la rama). SECURITY INVOKER.';

grant execute on function public.update_iron_pack(uuid, numeric, date, time, boolean, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- delete_iron_pack: borrado con cascada explícita del expense vinculado
-- (mismo criterio que delete_account_transfer/_account_transfer_delete).
-- Permisivo: si p_pack_id no existe o no pertenece al usuario, RLS oculta
-- la fila y esta función no borra nada (no lanza excepción).
-- -----------------------------------------------------------------------------
create function public.delete_iron_pack(p_pack_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_expense_id uuid;
begin
  select linked_expense_id into v_expense_id
  from public.iron_packs
  where id = p_pack_id;

  if v_expense_id is not null then
    delete from public.expenses where id = v_expense_id;
  end if;

  delete from public.iron_packs where id = p_pack_id;
end;
$$;

comment on function public.delete_iron_pack is 'Borra una compra de cajetilla completa: si tiene linked_expense_id, borra primero ese expense, después la fila de iron_packs, en una sola transacción implícita -- cascada explícita ("borrar la compra en Iron significa que esto nunca pasó"). Si p_pack_id no existe o no pertenece al usuario autenticado, no borra nada (RLS ya lo impide) -- no lanza excepción. SECURITY INVOKER.';

grant execute on function public.delete_iron_pack(uuid) to authenticated;
