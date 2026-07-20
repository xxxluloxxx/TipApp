-- =============================================================================
-- ensure_current_fixed_expense_instances_function
-- -----------------------------------------------------------------------------
-- Generación LAZY de instancias mensuales (ver comentario de diseño en
-- 20260720090100_fixed_expense_instances_init.sql): crea, para el usuario
-- autenticado, la fixed_expense_instances 'pending' del período actual de
-- cada fixed_expenses activa que todavía no la tenga. Pensada para que el
-- frontend la invoque al entrar a la sección de "Gastos fijos" (o al
-- refrescar el dashboard), antes de leer fixed_expense_instances_current /
-- fixed_expenses_summary — esas vistas solo reflejan filas que ya existen,
-- no sintetizan instancias virtuales al vuelo.
--
-- Idempotente por diseño: "on conflict (fixed_expense_id, period) do
-- nothing" contra la unique constraint ya existente, así que llamarla
-- repetidas veces (cada vez que se entra a la pantalla) es seguro y barato,
-- sin necesitar un chequeo previo de "¿ya existe?" en el cliente.
--
-- SECURITY INVOKER (no DEFINER, mismo criterio que create_debt/
-- create_live_match): respeta las policies insert_own de
-- fixed_expense_instances y select_own de fixed_expenses del usuario que
-- llama, sin bypass de RLS.
-- =============================================================================

create function public.ensure_current_fixed_expense_instances()
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_period date := date_trunc('month', (now() at time zone 'utc'))::date;
begin
  if v_user_id is null then
    raise exception 'ensure_current_fixed_expense_instances requiere un usuario autenticado';
  end if;

  insert into public.fixed_expense_instances (user_id, fixed_expense_id, period, status)
  select fe.user_id, fe.id, v_period, 'pending'
  from public.fixed_expenses fe
  where fe.user_id = v_user_id
    and fe.is_active
  on conflict (fixed_expense_id, period) do nothing;
end;
$$;

comment on function public.ensure_current_fixed_expense_instances is 'Crea (lazy, idempotente) las fixed_expense_instances pending del período actual para las plantillas activas del usuario que todavía no la tengan. Llamar antes de leer fixed_expense_instances_current/fixed_expenses_summary. SECURITY INVOKER: respeta RLS, sin bypass.';

grant execute on function public.ensure_current_fixed_expense_instances() to authenticated;
