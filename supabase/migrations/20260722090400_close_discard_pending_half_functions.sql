-- =============================================================================
-- close_discard_pending_half_functions
-- -----------------------------------------------------------------------------
-- Las únicas 2 operaciones de iron_cigarettes que tocan más de una fila a la
-- vez (docs/features/iron-ux.md sección 1.4). Registrar un entero o abrir
-- una mitad nueva son inserts simples de una sola tabla -- optimistas desde
-- el cliente, sin necesitar ninguna función acá (el índice único parcial
-- iron_cigarettes_one_pending_half ya garantiza el invariante de "máximo
-- una mitad_pendiente" a nivel de base de datos para esos inserts).
--
-- close_pending_half: inserta la fila NUEVA que representa la segunda mitad
-- (kind='mitad', status='completo', smoked_date/smoked_time = ahora,
-- closes_cigarette_id = la fila original) y actualiza la fila original a
-- status='completo', ambas cosas en la misma transacción implícita.
-- Devuelve el id de la fila nueva.
--
-- discard_pending_half: misma validación, solo actualiza la fila original a
-- status='descartada' (no crea fila nueva).
--
-- Ambas son SECURITY INVOKER (respetan RLS/policies iron_cigarettes_*_own) y
-- validan explícitamente ownership + kind + status antes de actuar (no
-- optimistas desde el cliente, mismo motivo que pay_fixed_expense_instance:
-- el cliente necesita el resultado real -- el id de la fila nueva, en el
-- caso de close_pending_half -- antes de refrescar su estado local).
--
-- No son idempotentes: llamarlas sobre una fila que no es 'mitad'/
-- 'mitad_pendiente' (ya cerrada, ya descartada, o un entero) lanza
-- excepción -- mismo criterio que pay_fixed_expense_instance sobre una
-- instancia ya pagada, para no arriesgar un doble-cierre silencioso (dos
-- filas nuevas para la misma mitad) ante un doble-tap o un reintento tardío
-- del cliente.
-- =============================================================================

create function public.close_pending_half(p_cigarette_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_kind text;
  v_status text;
  v_now timestamptz := now();
  v_new_id uuid;
begin
  if v_user_id is null then
    raise exception 'close_pending_half requiere un usuario autenticado';
  end if;

  select kind, status
  into v_kind, v_status
  from public.iron_cigarettes
  where id = p_cigarette_id
    and user_id = v_user_id;

  if not found then
    raise exception 'iron_cigarette % no encontrado o no pertenece al usuario', p_cigarette_id;
  end if;

  if v_kind <> 'mitad' or v_status <> 'mitad_pendiente' then
    raise exception 'iron_cigarette % no es una mitad pendiente (kind=%, status=%)', p_cigarette_id, v_kind, v_status;
  end if;

  insert into public.iron_cigarettes (user_id, kind, status, smoked_date, smoked_time, closes_cigarette_id)
  values (
    v_user_id, 'mitad', 'completo',
    (v_now at time zone 'utc')::date, (v_now at time zone 'utc')::time,
    p_cigarette_id
  )
  returning id into v_new_id;

  update public.iron_cigarettes
  set status = 'completo'
  where id = p_cigarette_id;

  return v_new_id;
end;
$$;

comment on function public.close_pending_half is 'Cierra la mitad pendiente p_cigarette_id: inserta la fila nueva de la segunda mitad (con su propia fecha/hora real, que puede caer en otro día) y marca la fila original como completo, en una única transacción implícita. Devuelve el id de la fila nueva. Lanza excepción si p_cigarette_id no existe, no pertenece al usuario autenticado, o no está en mitad_pendiente. SECURITY INVOKER.';

grant execute on function public.close_pending_half(uuid) to authenticated;

create function public.discard_pending_half(p_cigarette_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_kind text;
  v_status text;
begin
  if v_user_id is null then
    raise exception 'discard_pending_half requiere un usuario autenticado';
  end if;

  select kind, status
  into v_kind, v_status
  from public.iron_cigarettes
  where id = p_cigarette_id
    and user_id = v_user_id;

  if not found then
    raise exception 'iron_cigarette % no encontrado o no pertenece al usuario', p_cigarette_id;
  end if;

  if v_kind <> 'mitad' or v_status <> 'mitad_pendiente' then
    raise exception 'iron_cigarette % no es una mitad pendiente (kind=%, status=%)', p_cigarette_id, v_kind, v_status;
  end if;

  update public.iron_cigarettes
  set status = 'descartada'
  where id = p_cigarette_id;
end;
$$;

comment on function public.discard_pending_half is 'Descarta la mitad pendiente p_cigarette_id (status -> descartada), sin crear ninguna fila nueva. Sigue contando como 0.5 cigarrillo fumado en las agregaciones. Lanza excepción si p_cigarette_id no existe, no pertenece al usuario autenticado, o no está en mitad_pendiente. SECURITY INVOKER.';

grant execute on function public.discard_pending_half(uuid) to authenticated;
