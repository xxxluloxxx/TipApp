-- =============================================================================
-- fixed_expense_instances_skipped_status
-- -----------------------------------------------------------------------------
-- Tercer estado de instancia: 'skipped' ("Omitido"), contrato cerrado por
-- ui-ux-designer en docs/features/fixed-expenses-ux.md sección 14. El
-- usuario decide, a propósito, no pagar el gasto fijo ESTE mes puntual (ej.
-- "salteo el internet un mes") sin cancelar la plantilla/suscripción en sí
-- (eso ya existe: fixed_expenses.is_active, que afecta TODOS los meses
-- futuros — mecanismo intacto, no tocado por esta migración) y sin generar
-- ninguna fila en expenses (a diferencia de "Marcar como pagado").
--
-- Por qué 'skipped' no rompe el invariante existente
-- (fixed_expense_instances_paid_requires_expense: (status = 'paid') =
-- (expense_id is not null), 20260720090100_fixed_expense_instances_init.sql):
-- esa constraint solo vincula 'paid' con expense_id NOT NULL; no dice nada
-- sobre 'pending'/'skipped', ambos con expense_id NULL. No hace falta
-- tocarla — sigue siendo verdadera para cualquier fila 'skipped' (status <>
-- 'paid', así que el lado izquierdo de la igualdad es false, y expense_id es
-- null, así que el lado derecho también es false: false = false, ok).
--
-- Por qué fixed_expense_instances_before_write() NO necesita cambios:
-- su único efecto secundario (forzar status='pending'/paid_at=null) se
-- dispara solo cuando expense_id pasa de NOT NULL a NULL en un UPDATE
-- (tg_op = 'UPDATE' and new.expense_id is null and old.expense_id is not
-- null). Una instancia 'skipped' nunca tiene expense_id seteado en ninguna
-- transición relevante:
--   - pending -> skipped: expense_id ya era null, sigue null. No dispara la
--     condición (old.expense_id is not null es false).
--   - skipped -> pending ("Reactivar este mes"): mismo caso, expense_id
--     null en ambos lados.
--   - paid -> * : ese camino ya existe hoy (revertir un pago) y sigue
--     yendo a 'pending' como siempre: no hay ninguna transición documentada
--     ni pedida por diseño de 'paid' directo a 'skipped' (la 14.3 solo
--     ofrece el toggle pending<->skipped en filas activas no pagadas), así
--     que no hace falta contemplarla.
-- El toggle pending<->skipped es un simple `update ... set status = ...`
-- del cliente (sección 14.3, "mismo mecanismo ya usado por toggleActive"),
-- sin RPC nueva.
--
-- RLS: no requiere cambios. Las policies de fixed_expense_instances
-- (20260720090200_fixed_expenses_rls.sql) son coarse-grained por fila
-- (user_id = auth.uid()), no restringen columnas — el mismo update_own ya
-- cubre escribir status='skipped'. Confirmado leyendo esa migración antes
-- de escribir esta.
-- =============================================================================

alter table public.fixed_expense_instances
  drop constraint fixed_expense_instances_status_check;

alter table public.fixed_expense_instances
  add constraint fixed_expense_instances_status_check
  check (status in ('pending', 'paid', 'skipped'));

comment on column public.fixed_expense_instances.status is 'pending: sin resolver todavía. paid: pagada, requiere expense_id resuelto (ver constraint de invariante). skipped: el usuario decidió a propósito no pagar el gasto fijo ESTE mes puntual, sin generar ningún expense y sin afectar la plantilla (fixed_expenses.is_active) ni los meses futuros — reversible a pending con un update directo (ver docs/features/fixed-expenses-ux.md sección 14).';

-- -----------------------------------------------------------------------------
-- fixed_expenses_summary: excluir 'skipped' de total_amount (no es un monto
-- que vaya a gastarse, no debe inflar la proyección del mes) y agregar
-- omitted_count (conteo server-side de instancias omitidas del período
-- actual, sección 14.4 — "segunda línea condicional" + resolvedCount de la
-- barra de progreso, ambos cálculos de cliente sobre este número nuevo).
-- planned_count sigue siendo count(*) sin cambios (confirmado por diseño:
-- una instancia omitida SIGUE contando como "planeada"). paid_count/
-- paid_amount/trailing_avg_monthly: sin cambios, ya filtran por status =
-- 'paid' o joinean contra expenses, una fila 'skipped' (expense_id null)
-- queda excluida por construcción.
--
-- create or replace view sobre la última versión ya aplicada
-- (20260720090700_fixed_expenses_summary_exclude_current_month.sql), mismo
-- criterio del proyecto: las migraciones ya pusheadas no se editan
-- retroactivamente.
--
-- Ojo de implementación (no documentado en el doc de diseño, hallazgo de
-- esta migración): Postgres solo permite que `create or replace view`
-- AGREGUE columnas al final de la lista existente, nunca las inserte en
-- medio — intentar poner omitted_count entre paid_count y total_amount
-- falla con "cannot change name of view column total_amount to
-- omitted_count" porque desplaza la posición de todas las columnas
-- siguientes. Por eso omitted_count va al final del select, después de
-- trailing_avg_monthly, aunque conceptualmente esté más cerca de
-- paid_count/total_amount.
-- -----------------------------------------------------------------------------

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
    count(*) filter (where fei.status = 'skipped') as omitted_count,
    coalesce(sum(coalesce(e.amount, fe.amount)) filter (where fei.status <> 'skipped'), 0) as total_amount,
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
  end as trailing_avg_monthly,
  cc.omitted_count
from current_cur cc
cross join trailing_window t;

comment on view public.fixed_expenses_summary is 'Una fila por usuario autenticado con los agregados del dashboard de Gastos fijos del período actual: planned_count (count(*) de instancias del período, incluye omitidas — fueron planificadas igual), paid_count, omitted_count (instancias status=''skipped'' del período, ver docs/features/fixed-expenses-ux.md sección 14), total_amount (mezcla monto real de instancias pagadas + monto de plantilla de las pendientes, EXCLUYE las omitidas por completo, proyección del mes), paid_amount (solo la porción ya confirmada), trailing_avg_monthly (promedio de gasto pagado en los 6 meses calendario ANTERIORES al actual, sin incluirlo, NULL si no hay historial pagado en esa ventana). security_invoker=true: hereda el RLS de quien consulta.';

grant select on public.fixed_expenses_summary to authenticated;
