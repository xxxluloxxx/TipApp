-- =============================================================================
-- iron_undo_close_half_function
-- -----------------------------------------------------------------------------
-- Ajuste post-lanzamiento de Iron (docs/features/iron-ux.md sección 12.3.3.c
-- / 12.4). Permite deshacer, desde el Historial, el cierre de un par de
-- mitades: el usuario elimina la fila que CERRÓ la mitad original (la que
-- tiene closes_cigarette_id no nulo apuntando a ella) y la original vuelve
-- automáticamente a status='mitad_pendiente', como si nunca se hubiera
-- cerrado.
--
-- undo_close_half: borra la fila p_closing_id y actualiza la fila original
-- (la que closes_cigarette_id señala) a status='mitad_pendiente', en la
-- misma transacción implícita -- mismo criterio que close_pending_half/
-- discard_pending_half (20260722090400): SECURITY INVOKER (respeta RLS/
-- policies iron_cigarettes_*_own; el doc de diseño trae un snippet
-- ilustrativo con SECURITY DEFINER, pero eso es un error respecto al patrón
-- ya establecido por las dos funciones hermanas del mismo módulo -- no hay
-- ninguna razón técnica acá para apartarse, esta función no necesita ver
-- filas de otros usuarios), valida ownership + kind + status +
-- closes_cigarette_id de la fila p_closing_id antes de actuar, no
-- optimista (mismo motivo que sus hermanas: el resultado -- si el revert
-- pisa el índice único de "máx. 1 pendiente" -- lo decide el servidor).
--
-- No es idempotente: llamarla sobre una fila que no es una mitad que cerró
-- un par (kind<>'mitad', status<>'completo', o closes_cigarette_id null)
-- lanza excepción -- mismo criterio que las funciones hermanas.
--
-- Caso borde (12.3.3.c): si el usuario ya tiene OTRA fila mitad_pendiente
-- distinta en danza en el momento de este revert, el UPDATE de reversión
-- choca contra el índice único parcial iron_cigarettes_one_pending_half
-- (20260722090000) y Postgres levanta un unique_violation (23505). Se
-- captura ese unique_violation puntual y se relanza como una excepción
-- propia cuyo MENSAJE es exactamente el string 'IRON_PENDING_HALF_CONFLICT'
-- (sin texto adicional antes/después) -- contrato exacto que
-- vue-frontend-expert debe matchear contra el mensaje de error que
-- PostgREST devuelve (p.ej. `error.message === 'IRON_PENDING_HALF_CONFLICT'`
-- o `.includes(...)`, cualquiera de las dos formas es seguro porque el
-- mensaje no lleva nada más) para mostrar el copy de 12.3.3.c ("No pudimos
-- deshacer este cierre: ya tenés otra mitad pendiente abierta. Cerrala o
-- descartala primero e intentá de nuevo.") en vez de un error genérico.
-- Cualquier otro error (red, fila no encontrada, etc.) sigue el patrón
-- genérico de "Reintentar" ya establecido en el resto del proyecto.
-- =============================================================================

create function public.undo_close_half(p_closing_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_kind text;
  v_status text;
  v_original_id uuid;
begin
  if v_user_id is null then
    raise exception 'undo_close_half requiere un usuario autenticado';
  end if;

  select kind, status, closes_cigarette_id
  into v_kind, v_status, v_original_id
  from public.iron_cigarettes
  where id = p_closing_id
    and user_id = v_user_id;

  if not found then
    raise exception 'iron_cigarette % no encontrado o no pertenece al usuario', p_closing_id;
  end if;

  if v_kind <> 'mitad' or v_status <> 'completo' or v_original_id is null then
    raise exception 'iron_cigarette % no es la mitad que cerró un par (kind=%, status=%, closes_cigarette_id=%)',
      p_closing_id, v_kind, v_status, v_original_id;
  end if;

  delete from public.iron_cigarettes where id = p_closing_id;

  begin
    update public.iron_cigarettes
    set status = 'mitad_pendiente'
    where id = v_original_id;
  exception
    when unique_violation then
      -- Contrato exacto con el cliente: el MENSAJE de esta excepción es el
      -- string 'IRON_PENDING_HALF_CONFLICT' sin nada más (ver comentario de
      -- cabecera). No cambiar este texto sin avisar a vue-frontend-expert.
      raise exception 'IRON_PENDING_HALF_CONFLICT';
  end;
end;
$$;

comment on function public.undo_close_half is 'Deshace el cierre de un par de mitades: borra p_closing_id (la mitad que cerró la original) y revierte la fila original que closes_cigarette_id señala a status=mitad_pendiente, en una única transacción implícita. Devuelve void. Lanza excepción si p_closing_id no existe, no pertenece al usuario autenticado, o no es una mitad completo con closes_cigarette_id no nulo. Si el revert choca contra el índice único parcial iron_cigarettes_one_pending_half (el usuario ya tiene otra mitad_pendiente en danza), lanza una excepción cuyo mensaje es exactamente el string IRON_PENDING_HALF_CONFLICT, para que el cliente la distinga de un error genérico. SECURITY INVOKER.';

grant execute on function public.undo_close_half(uuid) to authenticated;
