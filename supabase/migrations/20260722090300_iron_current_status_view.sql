-- =============================================================================
-- iron_current_status_view
-- -----------------------------------------------------------------------------
-- Vista que expone si el usuario autenticado tiene una mitad pendiente ahora
-- mismo (docs/features/iron-ux.md sección 1.3). Gracias al índice único
-- parcial iron_cigarettes_one_pending_half (20260722090000), esta vista
-- devuelve 0 o 1 fila por usuario, nunca más.
--
-- security_invoker = true (mismo criterio que account_balances/
-- debt_balances): corre con el RLS del usuario que consulta, no del owner
-- de la vista -- un usuario autenticado que hace
-- `select * from iron_current_status` solo puede ver su propia fila (si
-- existe), nunca la de otro usuario, sin necesitar ningún filtro por
-- user_id adentro de esta vista (la policy iron_cigarettes_select_own ya lo
-- garantiza).
-- =============================================================================

create view public.iron_current_status
with (security_invoker = true)
as
select
  c.id as pending_id,
  c.user_id,
  c.smoked_date as pending_since_date,
  c.smoked_time as pending_since_time
from public.iron_cigarettes c
where c.kind = 'mitad' and c.status = 'mitad_pendiente';

comment on view public.iron_current_status is 'Expone la mitad pendiente actual del usuario autenticado (0 o 1 fila, nunca más -- ver iron_cigarettes_one_pending_half). security_invoker=true: nunca expone la mitad pendiente de otro usuario.';

grant select on public.iron_current_status to authenticated;
