-- =============================================================================
-- monthly_expense_income_totals_view
-- -----------------------------------------------------------------------------
-- Serie de 6 meses (mes actual + 5 anteriores) con el total de ingresos y
-- gastos de cada mes, para el gráfico de barras "Ingresos vs gastos" del
-- dashboard ampliado de Reportes (pantalla nueva, NO ReportsView.vue).
--
-- Por qué una vista y no 6 round-trips desde el cliente (patrón que sí usa
-- ReportsView.vue para comparar 1 mes vs. el anterior): acá la ventana es 6x
-- más ancha, así que el mismo patrón de "traer filas con .limit(1000) y
-- sumar en cliente" (válido para 1 mes, ver CLAUDE.md) tiene más chance real
-- de tocar el cap en una cuenta con mucho movimiento y devolver un total
-- silenciosamente incompleto. Agregar por mes en Postgres evita ese riesgo y
-- resuelve el gráfico en una sola query en vez de 6-12.
--
-- Devuelve SIEMPRE 6 filas (una por mes del rango), incluso para meses sin
-- ningún movimiento (expense_total/income_total en 0) — necesario para que
-- el gráfico de barras tenga el eje de meses completo sin huecos. Se arma
-- con generate_series (no depende de ninguna tabla con RLS), y recién los
-- LEFT JOIN contra las subqueries agregadas de expenses/incomes heredan el
-- RLS del usuario que consulta (mismo mecanismo de security_invoker que
-- account_balances/debt_balances/fixed_expenses_summary): un usuario
-- autenticado que hace `select * from monthly_expense_income_totals` solo ve
-- sus propios montos, nunca los de otro usuario.
--
-- Ventana fija de 6 meses (sin parámetro): sigue el mismo criterio ya usado
-- en fixed_expenses_summary (trailing de 6 meses hardcodeado) en vez de una
-- función rpc con parámetro — el pedido de producto es específicamente
-- "últimos 6 meses", no un rango arbitrario (eso lo cubre Comparación
-- mensual con 2 queries directas mes a mes, mismo patrón que ReportsView).
-- =============================================================================

create view public.monthly_expense_income_totals
with (security_invoker = true)
as
with months as (
  select generate_series(
    date_trunc('month', (now() at time zone 'utc')) - interval '5 months',
    date_trunc('month', (now() at time zone 'utc')),
    interval '1 month'
  )::date as month_start
),
expense_totals as (
  select date_trunc('month', expense_date)::date as month_start, sum(amount) as total
  from public.expenses
  group by 1
),
income_totals as (
  select date_trunc('month', income_date)::date as month_start, sum(amount) as total
  from public.incomes
  group by 1
)
select
  auth.uid() as user_id,
  m.month_start,
  coalesce(e.total, 0) as expense_total,
  coalesce(i.total, 0) as income_total
from months m
left join expense_totals e on e.month_start = m.month_start
left join income_totals i on i.month_start = m.month_start
order by m.month_start;

comment on view public.monthly_expense_income_totals is 'Serie de 6 meses (mes actual + 5 anteriores) con total de ingresos y gastos por mes, para el gráfico de barras del dashboard de Reportes ampliado. Siempre 6 filas (0 para meses sin movimientos). security_invoker=true: hereda el RLS de quien consulta, nunca expone montos de otro usuario. Alcance idéntico a los totales generales de ReportsView.vue: solo expenses/incomes, sin card_expenses.';

grant select on public.monthly_expense_income_totals to authenticated;
