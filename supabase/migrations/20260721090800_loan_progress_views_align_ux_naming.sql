-- =============================================================================
-- loan_progress_views_align_ux_naming
-- -----------------------------------------------------------------------------
-- Fast-follow de nomenclatura: docs/features/loans-ux.md (ui-ux-designer,
-- escrito en paralelo a este esquema) ya usa nombres concretos de vista/
-- columna en decenas de referencias a lo largo de todo el documento
-- (`loan_debtor_balances`, `paid_count`, `total_count`, `remaining_amount`,
-- `next_installment_number/amount/due_date`, `balance_remaining`), marcados
-- explícitamente como "ilustrativo -- a confirmar con supabase-backend-
-- expert" (sección 1.2). Esta migración es esa confirmación: en vez de
-- pedirle al frontend/diseño que reescriban el documento entero para
-- adoptar los nombres provisorios de 20260721090600
-- (`installments_paid/total`, `amount_pending`, `next_due_*`,
-- `loan_debtor_progress`/`remaining`), se alinea el esquema a los nombres
-- que el doc de UX ya fijó -- es más barato de cambiar acá (recrear 3
-- vistas) que en un documento de 1390 líneas ya escrito.
--
-- Excepciones deliberadas, donde SÍ se conserva el nombre ya elegido en vez
-- de adoptar el ilustrativo del doc de UX (documentado para que quede
-- explícito, no un descuido):
--   - `monthly_installment_amount`/`amount_owed`: son columnas de TABLA
--     (loans/loan_debtors), no de vista -- ya fijadas por el encargo
--     original de este esquema (20260721090000/20260721090200) con esos
--     nombres exactos, no las que el doc de UX ilustraba
--     (`monthly_payment`/`amount`). Las vistas de esta migración las
--     exponen tal cual, sin alias -- el doc de UX debe actualizar esas 2
--     referencias puntuales de columna de TABLA (no de vista) a los nombres
--     reales.
--   - `estimated_end_date`/`user_id` en ambas vistas: no estaban en el
--     boceto ilustrativo del doc de UX, pero SÍ estaban en el encargo
--     original de este esquema (derivar fecha de fin, y exponer user_id
--     para que el frontend no necesite un segundo join) -- se conservan
--     como columnas adicionales, sin conflicto con lo que el doc de UX
--     necesita.
--   - `last_payment_amount` en loan_debtor_balances: no estaba en el
--     boceto del doc de UX (que solo pedía `last_payment_date`), pero SÍ lo
--     pedía el encargo original de este esquema -- se mantiene como columna
--     adicional.
--
-- loans_summary (vista propia, no ilustrada por el doc de UX -- ver
-- 20260721090600) se recrea con los mismos nombres de columna que ya tenía,
-- solo actualizando sus referencias internas a las columnas renombradas de
-- loan_progress/loan_debtor_balances. El doc de UX (sección 2.1) anticipa
-- sumar `loan_debtor_balances.balance_remaining` en cliente para el total
-- global -- loans_summary sigue disponible como alternativa ya resuelta
-- server-side si se prefiere no sumar en cliente, es aditiva, no reemplaza
-- esa opción.
--
-- CASCADE: loans_summary depende de loan_progress y de la vista renombrada,
-- así que hay que dropearla primero (o con cascade) antes de poder recrear
-- las otras dos con columnas distintas -- CREATE OR REPLACE VIEW no permite
-- renombrar/quitar columnas existentes, solo agregar al final.
-- =============================================================================

drop view if exists public.loans_summary;
drop view if exists public.loan_debtor_progress;
drop view if exists public.loan_progress;

-- -----------------------------------------------------------------------------
-- 1) loan_progress -- mismos datos que 20260721090600, columnas renombradas
--    para alinear con docs/features/loans-ux.md sección 1.2.
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
  l.term_months as total_count,
  coalesce(agg.paid_count, 0) as paid_count,
  coalesce(agg.paid_amount, 0) as paid_amount,
  l.total_amount - coalesce(agg.paid_amount, 0) as remaining_amount,
  nxt.installment_number as next_installment_number,
  nxt.amount as next_installment_amount,
  nxt.due_date as next_installment_due_date,
  coalesce(ovr.has_overdue, false) as has_overdue,
  coalesce(agg.paid_count, 0) = l.term_months as is_completed
from public.loans l
left join lateral (
  select
    count(*) filter (where li.status = 'paid') as paid_count,
    sum(li.amount) filter (where li.status = 'paid') as paid_amount
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

comment on view public.loan_progress is 'Progreso derivado de un préstamo (columnas alineadas a docs/features/loans-ux.md sección 1.2): paid_count/total_count, paid_amount/remaining_amount, next_installment_number/amount/due_date (NULL si no quedan pendientes), has_overdue (existe alguna cuota pending con due_date < hoy), is_completed. security_invoker=true. "Atrasado" en el frontend se deriva de has_overdue -- sin columna de estado textual materializada, mismo criterio que debt_balances.';

grant select on public.loan_progress to authenticated;

-- -----------------------------------------------------------------------------
-- 2) loan_debtor_balances (antes loan_debtor_progress) -- mismos datos,
--    nombre y columnas alineados a docs/features/loans-ux.md sección 1.2.
-- -----------------------------------------------------------------------------
create view public.loan_debtor_balances
with (security_invoker = true)
as
select
  ld.id as loan_debtor_id,
  ld.user_id,
  ld.loan_id,
  ld.debt_person_id,
  ld.amount_owed,
  coalesce(tot.amount_received, 0) as amount_received,
  ld.amount_owed - coalesce(tot.amount_received, 0) as balance_remaining,
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

comment on view public.loan_debtor_balances is 'Progreso derivado de un loan_debtor (columnas alineadas a docs/features/loans-ux.md sección 1.2): amount_received (sum de loan_debtor_payments), balance_remaining = amount_owed - amount_received, último pago (fecha/monto, NULL si nunca pagó nada). security_invoker=true. Cardinalidad chica (una fila por persona-préstamo) -- seguro traerla completa y agregar en cliente si se prefiere no usar loans_summary (ver comentario de esa vista).';

grant select on public.loan_debtor_balances to authenticated;

-- -----------------------------------------------------------------------------
-- 3) loans_summary -- mismas columnas que 20260721090600, referencias
--    internas actualizadas a los nombres nuevos de las 2 vistas de arriba.
-- -----------------------------------------------------------------------------
create view public.loans_summary
with (security_invoker = true)
as
with loans_agg as (
  select
    count(*) as loans_count,
    count(*) filter (where lp.paid_count < lp.total_count) as active_loans_count,
    coalesce(sum(l.total_amount), 0) as total_borrowed,
    coalesce(sum(lp.paid_amount), 0) as total_paid,
    coalesce(sum(lp.remaining_amount), 0) as total_pending,
    coalesce(bool_or(lp.has_overdue), false) as has_any_overdue
  from public.loans l
  join public.loan_progress lp on lp.loan_id = l.id
),
debtors_agg as (
  select
    coalesce(sum(amount_owed), 0) as total_receivable,
    coalesce(sum(amount_received), 0) as total_received
  from public.loan_debtor_balances
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

comment on view public.loans_summary is 'Una única fila por usuario autenticado con los agregados de TODOS sus préstamos y TODOS sus loan_debtors, para el dashboard de lista de Préstamos. total_receivable_remaining = agregado GLOBAL (todos los préstamos, activos e historial) -- coincide con la resolución de la ambigüedad de docs/features/loans-ux.md sección 2.1 ("Total que debo recibir" es un agregado global, no por préstamo). Alternativa ya resuelta server-side a sumar loan_debtor_balances.balance_remaining en cliente (esa vista sigue disponible igual, ambos caminos son válidos). Siempre devuelve exactamente 1 fila. security_invoker=true.';

grant select on public.loans_summary to authenticated;
