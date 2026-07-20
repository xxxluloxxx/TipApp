-- =============================================================================
-- fixed_expense_instances_current_view
-- -----------------------------------------------------------------------------
-- Una fila por fixed_expenses ACTIVA que ya tiene su fixed_expense_instances
-- del período actual (creada por ensure_current_fixed_expense_instances —
-- esta vista no sintetiza filas virtuales para plantillas sin instancia
-- todavía, ver comentario de esa función), con categoría ya resuelta y, si
-- está pagada, el monto/cuenta reales del expense generado. Mismo principio
-- "estado siempre derivado, nunca cacheado" que account_balances/
-- debt_balances/bet_slip_summary: el store de Pinia del frontend solo lee
-- columnas ya resueltas acá, no reconstruye nada.
--
-- Reuso doble: además de alimentar la tabla del dashboard, el frontend filtra
-- esta misma vista por status = 'pending' ordenando por payment_day para
-- armar "Próximos pagos" — no hace falta una vista separada solo para eso.
--
-- security_invoker = true (mismo patrón que el resto de las vistas del
-- proyecto): corre con el RLS de quien consulta, heredado de
-- fixed_expenses/fixed_expense_instances/categories/expenses.
-- =============================================================================

create view public.fixed_expense_instances_current
with (security_invoker = true)
as
select
  fei.id as instance_id,
  fe.user_id,
  fe.id as fixed_expense_id,
  fe.name as fixed_expense_name,
  fe.amount as template_amount,
  fe.payment_day,
  fe.notes as fixed_expense_notes,
  fe.category_id,
  c.name as category_name,
  c.color as category_color,
  c.icon as category_icon,
  fei.period,
  fei.status,
  fei.expense_id,
  fei.paid_at,
  e.amount as paid_amount,
  e.account_id as paid_account_id,
  e.expense_date as paid_expense_date
from public.fixed_expenses fe
join public.fixed_expense_instances fei
  on fei.fixed_expense_id = fe.id
  and fei.period = date_trunc('month', (now() at time zone 'utc'))::date
left join public.categories c on c.id = fe.category_id
left join public.expenses e on e.id = fei.expense_id
where fe.is_active;

comment on view public.fixed_expense_instances_current is 'Instancia del período actual por cada fixed_expenses activa (solo instancias que ya existen — no sintetiza pendientes virtuales, ver ensure_current_fixed_expense_instances), con categoría y, si está pagada, el expense real ya resueltos. Filtrar por status=''pending'' ordenando por payment_day para "Próximos pagos". security_invoker=true: hereda el RLS de quien consulta.';

grant select on public.fixed_expense_instances_current to authenticated;
