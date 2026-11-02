-- =============================================================================
-- loan_installments_use_monthly_amount
-- -----------------------------------------------------------------------------
-- Antes create_loan repartía total_amount / term_months e ignoraba la cuota
-- mensual: eso solo servía para préstamos sin intereses. Ahora el cronograma
-- se arma con la cuota que el usuario indica (monthly_installment_amount) para
-- las term_months cuotas, sin calcular nada a partir del total. Cada cuota
-- puede editarse después de forma individual (update sobre loan_installments).
-- total_amount pasa a ser informativo (monto prestado).
--
-- loan_progress.remaining_amount se deriva de las cuotas pendientes reales, ya
-- no de total_amount - pagado (que dejó de coincidir con el cronograma).
-- =============================================================================

create or replace function public.create_loan(
  p_name text,
  p_total_amount numeric,
  p_monthly_installment_amount numeric,
  p_start_date date,
  p_term_months integer,
  p_description text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_loan_id uuid;
  i integer;
begin
  if v_user_id is null then
    raise exception 'create_loan requiere un usuario autenticado';
  end if;

  if p_total_amount <= 0 then
    raise exception 'total_amount debe ser positivo, recibido %', p_total_amount;
  end if;

  if p_monthly_installment_amount <= 0 then
    raise exception 'monthly_installment_amount debe ser positivo, recibido %', p_monthly_installment_amount;
  end if;

  if p_term_months <= 0 then
    raise exception 'term_months debe ser positivo, recibido %', p_term_months;
  end if;

  insert into public.loans (
    user_id, name, description, total_amount,
    monthly_installment_amount, start_date, term_months
  )
  values (
    v_user_id, p_name, p_description, p_total_amount,
    p_monthly_installment_amount, p_start_date, p_term_months
  )
  returning id into v_loan_id;

  for i in 1..p_term_months loop
    insert into public.loan_installments (user_id, loan_id, installment_number, amount, due_date)
    values (
      v_user_id,
      v_loan_id,
      i,
      p_monthly_installment_amount,
      (p_start_date + make_interval(months => i - 1))::date
    );
  end loop;

  return v_loan_id;
end;
$$;

create or replace view public.loan_progress
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
  coalesce(agg.pending_amount, 0) as remaining_amount,
  nxt.installment_number as next_installment_number,
  nxt.amount as next_installment_amount,
  nxt.due_date as next_installment_due_date,
  coalesce(ovr.has_overdue, false) as has_overdue,
  coalesce(agg.paid_count, 0) = l.term_months as is_completed
from public.loans l
left join lateral (
  select
    count(*) filter (where li.status = 'paid') as paid_count,
    sum(li.amount) filter (where li.status = 'paid') as paid_amount,
    sum(li.amount) filter (where li.status = 'pending') as pending_amount
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

-- Corrige los cronogramas ya generados con el reparto viejo (total / plazo):
-- las cuotas pendientes pasan a la cuota mensual del préstamo.
update public.loan_installments li
set amount = l.monthly_installment_amount
from public.loans l
where l.id = li.loan_id
  and li.status = 'pending'
  and li.amount <> l.monthly_installment_amount;
