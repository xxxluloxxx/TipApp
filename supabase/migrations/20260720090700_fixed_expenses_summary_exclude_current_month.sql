-- =============================================================================
-- fixed_expenses_summary_exclude_current_month
-- -----------------------------------------------------------------------------
-- Corrige trailing_avg_monthly de fixed_expenses_summary
-- (20260720090600_fixed_expenses_summary_view.sql): el doc de UX
-- (docs/features/fixed-expenses-ux.md, sección 3.4 "Card 3 — Promedio
-- mensual") especifica que el mes en curso NUNCA debe entrar en este
-- promedio ("todavía está a mitad de camino y distorsionaría el promedio
-- hacia abajo"), pero la condición original
-- (`fei.period >= cp.period - interval '5 months' and fei.period <= cp.period`)
-- sí lo incluía si ya tenía algún pago cargado.
--
-- Ventana corregida: 6 meses calendario ANTERIORES al actual, sin incluirlo
-- (`>= cp.period - interval '6 months' and < cp.period`) — con
-- current_period = 2026-07-01 eso es [2026-01-01, 2026-07-01), es decir
-- enero a junio, 6 meses completos. El denominador sigue siendo
-- months_with_data real (cuántos de esos 6 meses tienen al menos un pago),
-- no un 6 fijo — eso ya estaba bien y no se toca.
--
-- create or replace view en vez de tocar la migración ya aplicada
-- (20260720090600): las migraciones ya pusheadas al remoto no se editan
-- retroactivamente, se corrige hacia adelante con una nueva. Mismo shape de
-- columnas, no requiere regenerar tipos.
-- =============================================================================

create or replace view public.fixed_expenses_summary
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
    and fei.period >= cp.period - interval '6 months'
    and fei.period < cp.period
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

comment on view public.fixed_expenses_summary is 'Una fila por usuario autenticado con los agregados del dashboard de Gastos fijos del período actual: planned_count/paid_count (instancias ya creadas, ver ensure_current_fixed_expense_instances), total_amount (mezcla monto real de instancias pagadas + monto de plantilla de las pendientes, proyección del mes), paid_amount (solo la porción ya confirmada), trailing_avg_monthly (promedio de gasto pagado en los 6 meses calendario ANTERIORES al actual, sin incluirlo — ver docs/features/fixed-expenses-ux.md sección 3.4 —, NULL si no hay historial pagado en esa ventana). security_invoker=true: hereda el RLS de quien consulta.';

grant select on public.fixed_expenses_summary to authenticated;
