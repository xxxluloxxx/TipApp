-- =============================================================================
-- fixed_expenses_summary_view
-- -----------------------------------------------------------------------------
-- Una única fila por usuario autenticado con los agregados para las cards
-- del dashboard de "Gastos fijos": total del mes (proyectado + real mezclado,
-- ver más abajo), cuántas pagadas de cuántas planeadas, y un promedio
-- mensual trailing de 6 meses. Todo resuelto server-side — mismo principio
-- "estado siempre derivado" que el resto del esquema.
--
-- Siempre devuelve exactamente 1 fila (incluso sin ningún fixed_expenses
-- activo ni historial pagado, con counts en 0 y trailing_avg_monthly NULL):
-- se arma sobre 2 CTEs que agregan SIN group by (auth.uid() column
-- literal), así que cada CTE colapsa a 1 fila pase lo que pase, y el cross
-- join final entre ambas también da 1 fila. Se prefiere esto a un
-- "left join contra una lista de usuarios" porque no existe tal lista
-- accesible desde una vista security_invoker sin bypassear RLS.
--
-- total_amount mezcla intencionalmente monto real (si ya se pagó esa
-- instancia del mes) y monto de plantilla (si todavía está pendiente): es la
-- proyección de "cuánto vas a gastar en gastos fijos este mes" que tiene
-- sentido mostrar de entrada, no una promesa de "esto ya se gastó" — para
-- eso está paid_amount aparte (solo la porción ya confirmada). Requiere que
-- ensure_current_fixed_expense_instances ya se haya llamado en esta sesión
-- (mismo prerequisito que fixed_expense_instances_current): una plantilla
-- activa sin instancia creada todavía para el período actual no se cuenta
-- en planned_count/total_amount hasta que exista la fila.
--
-- Ventana trailing de 6 meses (mes actual + 5 anteriores) elegida como
-- balance razonable entre "suficiente historial para que el promedio no sea
-- ruido de 1-2 meses" y "no diluir con datos muy viejos si el usuario
-- cambió sus gastos fijos" — sin ninguna razón más fuerte que esa, ajustable
-- a futuro si se pide otra ventana.
--
-- security_invoker = true, mismo patrón que el resto de las vistas.
-- =============================================================================

create view public.fixed_expenses_summary
with (security_invoker = true)
as
with current_period as (
  select date_trunc('month', (now() at time zone 'utc'))::date as period
),
current_cur as (
  select
    count(*) as planned_count,
    count(*) filter (where fei.status = 'paid') as paid_count,
    coalesce(sum(coalesce(e.amount, fe.amount)), 0) as total_amount,
    coalesce(sum(e.amount) filter (where fei.status = 'paid'), 0) as paid_amount
  from public.fixed_expenses fe
  cross join current_period cp
  left join public.fixed_expense_instances fei
    on fei.fixed_expense_id = fe.id
    and fei.period = cp.period
  left join public.expenses e on e.id = fei.expense_id
  where fe.is_active
),
trailing_window as (
  select
    sum(e.amount) as total_paid,
    count(distinct fei.period) as months_with_data
  from public.fixed_expense_instances fei
  join public.expenses e on e.id = fei.expense_id
  cross join current_period cp
  where fei.status = 'paid'
    and fei.period >= cp.period - interval '5 months'
    and fei.period <= cp.period
)
select
  auth.uid() as user_id,
  (select period from current_period) as current_period,
  cc.planned_count,
  cc.paid_count,
  cc.total_amount,
  cc.paid_amount,
  case
    when t.months_with_data > 0 then round(t.total_paid / t.months_with_data, 2)
    else null
  end as trailing_avg_monthly
from current_cur cc
cross join trailing_window t;

comment on view public.fixed_expenses_summary is 'Una fila por usuario autenticado con los agregados del dashboard de Gastos fijos del período actual: planned_count/paid_count (instancias ya creadas, ver ensure_current_fixed_expense_instances), total_amount (mezcla monto real de instancias pagadas + monto de plantilla de las pendientes, proyección del mes), paid_amount (solo la porción ya confirmada), trailing_avg_monthly (promedio de gasto pagado en los últimos 6 meses calendario incluyendo el actual, NULL si no hay historial pagado en esa ventana). security_invoker=true: hereda el RLS de quien consulta.';

grant select on public.fixed_expenses_summary to authenticated;
