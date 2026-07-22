-- =============================================================================
-- close_pending_half_local_datetime
-- -----------------------------------------------------------------------------
-- Fix: close_pending_half (20260722090400_close_discard_pending_half_functions.sql)
-- calculaba la fecha/hora de la segunda mitad con v_now := now() y la
-- truncaba a UTC internamente, sin que el cliente pudiera pasar su hora
-- local. Para un usuario en un huso horario distinto de UTC, la hora
-- guardada para "cerré la mitad pendiente" queda corrida respecto a la hora
-- real en la que tocó el botón -- justo lo que docs/features/iron-ux.md
-- sección 1.1 pide evitar.
--
-- Se reemplaza la función para seguir el mismo patrón ya establecido en
-- pay_fixed_expense_instance (20260720090400) y create_debt: la fecha/hora
-- se recibe como parámetros opcionales p_smoked_date/p_smoked_time, y el
-- cliente SIEMPRE los pasa calculados en el navegador
-- (todayDateInputValue()/nowTimeInputValue() de src/lib/date.ts). El default
-- (now() at time zone 'utc') es fallback solo para invocación SQL directa,
-- no la ruta esperada en producción.
--
-- discard_pending_half NO tiene este problema: no inserta ninguna fila ni
-- fecha/hora nueva, solo actualiza status de la fila existente a
-- 'descartada' -- confirmado leyendo su definición, no requiere cambios.
-- =============================================================================

-- CREATE OR REPLACE no alcanza acá: cambia la lista de parámetros
-- (close_pending_half(uuid) -> close_pending_half(uuid, date, time)), y para
-- Postgres eso es una signature distinta (crearía un overload nuevo en vez
-- de reemplazar), dejando la función vieja de 1 parámetro activa y ganando
-- cualquier llamada con exactamente 1 argumento por match exacto de tipos.
drop function if exists public.close_pending_half(uuid);

create function public.close_pending_half(
  p_cigarette_id uuid,
  p_smoked_date date default (now() at time zone 'utc')::date,
  p_smoked_time time default (now() at time zone 'utc')::time
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_kind text;
  v_status text;
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
    p_smoked_date, p_smoked_time,
    p_cigarette_id
  )
  returning id into v_new_id;

  update public.iron_cigarettes
  set status = 'completo'
  where id = p_cigarette_id;

  return v_new_id;
end;
$$;

comment on function public.close_pending_half is 'Cierra la mitad pendiente p_cigarette_id: inserta la fila nueva de la segunda mitad (con fecha/hora p_smoked_date/p_smoked_time -- el cliente pasa su hora local, el default UTC es solo fallback para invocación SQL directa) y marca la fila original como completo, en una única transacción implícita. Devuelve el id de la fila nueva. Lanza excepción si p_cigarette_id no existe, no pertenece al usuario autenticado, o no está en mitad_pendiente. SECURITY INVOKER.';

grant execute on function public.close_pending_half(uuid, date, time) to authenticated;
