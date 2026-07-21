-- =============================================================================
-- loan_progress_views
-- -----------------------------------------------------------------------------
-- Estado SIEMPRE derivado de la feature "Préstamos", nunca cacheado -- mismo
-- criterio ya establecido por debt_balances / bet_slip_summary /
-- fixed_expenses_summary. 3 vistas nuevas, todas `security_invoker = true`
-- (heredan el RLS de quien consulta, nunca exponen datos de otro usuario):
--
--   1) loan_progress: 1 fila por préstamo -- cuotas pagadas/total, monto
--      pagado/pendiente, próxima cuota pendiente (número/monto/fecha),
--      has_overdue (¿hay alguna cuota pending con due_date ya pasado?) e
--      is_completed. El frontend nunca debería sumar loan_installments a
--      mano para ninguno de estos números.
--   2) loan_debtor_progress: 1 fila por loan_debtor -- monto recibido
--      (suma de loan_debtor_payments), remaining, último pago
--      (fecha/monto).
--   3) loans_summary: 1 fila por usuario autenticado, agregando las dos
--      vistas anteriores -- pensada para el dashboard de lista de
--      "Préstamos" (ej. "tenés 3 préstamos activos, con $X pendiente de
--      pagar y $Y pendiente de cobrar de tus deudores"). Se expone esta
--      vista aunque no haya certeza absoluta de la forma final que va a
--      consumir el frontend -- se prefiere pecar de exponer un agregado ya
--      resuelto server-side de más, antes que forzar al cliente a sumar
--      listas completas (mismo criterio ya aplicado en
--      fixed_expenses_summary).
--
-- estimated_end_date se deriva literal como start_date + term_months meses
-- (make_interval), tal cual lo especificó el encargo -- ojo que esto cae UN
-- MES DESPUÉS del due_date real de la última cuota (due_date de la cuota
-- term_months = start_date + (term_months - 1) meses, ver create_loan): es
-- una fecha de fin "de colchón", no literalmente el día del último pago. Si
-- a futuro se prefiere exactamente el due_date de la última cuota, ya está
-- disponible sin cálculo aparte consultando loan_installments filtrado por
-- installment_number = term_months.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) loan_progress -- 1 fila por préstamo.
-- -----------------------------------------------------------------------------
create view public.loan_progress
with (security_invoker = true)
as
select
  l.id as loan_id,
  l.user_id,
  l.name,
  l.description,
  l.total_amount,
  l.monthly_installment_amount,
  l.start_date,
  l.term_months,
  (l.start_date + make_interval(months => l.term_months))::date as estimated_end_date,
  l.term_months as installments_total,
  coalesce(agg.installments_paid, 0) as installments_paid,
  coalesce(agg.amount_paid, 0) as amount_paid,
  l.total_amount - coalesce(agg.amount_paid, 0) as amount_pending,
  nxt.installment_number as next_due_installment_number,
  nxt.amount as next_due_amount,
  nxt.due_date as next_due_date,
  coalesce(ovr.has_overdue, false) as has_overdue,
  coalesce(agg.installments_paid, 0) = l.term_months as is_completed
from public.loans l
left join lateral (
  select
    count(*) filter (where li.status = 'paid') as installments_paid,
    sum(li.amount) filter (where li.status = 'paid') as amount_paid
  from public.loan_installments li
  where li.loan_id = l.id
) agg on true
left join lateral (
  select li.installment_number, li.amount, li.due_date
  from public.loan_installments li
  where li.loan_id = l.id and li.status = 'pending'
  order by li.installment_number
  limit 1
) nxt on true
left join lateral (
  select true as has_overdue
  from public.loan_installments li
  where li.loan_id = l.id
    and li.status = 'pending'
    and li.due_date < (now() at time zone 'utc')::date
  limit 1
) ovr on true;

comment on view public.loan_progress is 'Progreso derivado de un préstamo: cuotas pagadas/total, montos pagado/pendiente, próxima cuota pendiente (installment_number/amount/due_date, NULL si ya no quedan pendientes), has_overdue (existe alguna cuota pending con due_date < hoy), is_completed (todas las cuotas pagadas). security_invoker=true. "Atrasado" en el frontend se deriva de has_overdue (más, si se quiere, next_due_date < hoy) -- no hay una columna de estado textual materializada acá, mismo criterio que debt_balances con Pendiente/Saldada.';

grant select on public.loan_progress to authenticated;

-- -----------------------------------------------------------------------------
-- 2) loan_debtor_progress -- 1 fila por loan_debtor.
-- -----------------------------------------------------------------------------
create view public.loan_debtor_progress
with (security_invoker = true)
as
select
  ld.id as loan_debtor_id,
  ld.user_id,
  ld.loan_id,
  ld.debt_person_id,
  ld.amount_owed,
  coalesce(tot.amount_received, 0) as amount_received,
  ld.amount_owed - coalesce(tot.amount_received, 0) as remaining,
  last.payment_date as last_payment_date,
  last.amount as last_payment_amount
from public.loan_debtors ld
left join lateral (
  select coalesce(sum(ldp.amount), 0) as amount_received
  from public.loan_debtor_payments ldp
  where ldp.loan_debtor_id = ld.id
) tot on true
left join lateral (
  select ldp.payment_date, ldp.amount
  from public.loan_debtor_payments ldp
  where ldp.loan_debtor_id = ld.id
  order by ldp.payment_date desc, ldp.created_at desc
  limit 1
) last on true;

comment on view public.loan_debtor_progress is 'Progreso derivado de un loan_debtor: amount_received (sum de loan_debtor_payments), remaining = amount_owed - amount_received, y el último pago (fecha/monto, NULL si nunca pagó nada). security_invoker=true. Sin columna de estado "Saldado" materializada -- se deriva de remaining <= 0 en el frontend, mismo criterio que debt_balances.';

grant select on public.loan_debtor_progress to authenticated;

-- -----------------------------------------------------------------------------
-- 3) loans_summary -- 1 fila por usuario autenticado (dashboard de lista).
-- -----------------------------------------------------------------------------
create view public.loans_summary
with (security_invoker = true)
as
with loans_agg as (
  select
    count(*) as loans_count,
    count(*) filter (where lp.installments_paid < lp.installments_total) as active_loans_count,
    coalesce(sum(l.total_amount), 0) as total_borrowed,
    coalesce(sum(lp.amount_paid), 0) as total_paid,
    coalesce(sum(lp.amount_pending), 0) as total_pending,
    coalesce(bool_or(lp.has_overdue), false) as has_any_overdue
  from public.loans l
  join public.loan_progress lp on lp.loan_id = l.id
),
debtors_agg as (
  select
    coalesce(sum(amount_owed), 0) as total_receivable,
    coalesce(sum(amount_received), 0) as total_received
  from public.loan_debtor_progress
)
select
  auth.uid() as user_id,
  la.loans_count,
  la.active_loans_count,
  la.total_borrowed,
  la.total_paid,
  la.total_pending,
  la.has_any_overdue,
  da.total_receivable,
  da.total_received,
  da.total_receivable - da.total_received as total_receivable_remaining
from loans_agg la
cross join debtors_agg da;

comment on view public.loans_summary is 'Una única fila por usuario autenticado con los agregados de TODOS sus préstamos y TODOS sus loan_debtors, para el dashboard de lista de Préstamos: loans_count/active_loans_count (con cuotas pendientes), total_borrowed/total_paid/total_pending (lado "lo que debo yo"), has_any_overdue, total_receivable/total_received/total_receivable_remaining (lado "lo que me deben mis deudores de préstamo"). Siempre devuelve exactamente 1 fila (agregados sin group by colapsan a 1 fila incluso sin ningún loans/loan_debtors), mismo mecanismo que fixed_expenses_summary. security_invoker=true.';

grant select on public.loans_summary to authenticated;
