-- =============================================================================
-- create_loan_function
-- -----------------------------------------------------------------------------
-- Crear un préstamo implica 2 escrituras dependientes: la cabecera (loans) +
-- TODO su cronograma de cuotas (loan_installments, term_months filas de una
-- sola vez -- a diferencia de fixed_expense_instances, que se generan
-- perezosamente mes a mes, acá start_date/term_months ya determinan el
-- cronograma completo por adelantado). Mismo motivo/patrón que create_debt /
-- create_live_match / create_bet_slip: el cliente no puede armar esto de
-- forma optimista sin ya tener el loan_id real que devuelve el servidor, y
-- si el segundo paso (generar cuotas) fallara a mitad de camino dejaría una
-- cabecera huérfana con un cronograma incompleto -- por eso va todo en una
-- única función plpgsql (atómica: cualquier excepción hace rollback
-- completo, no queda ninguna fila).
--
-- SECURITY INVOKER (no DEFINER): respeta el RLS y las policies insert_own de
-- quien llama, igual que create_debt/pay_fixed_expense_instance. No se
-- revalida ownership a mano de ninguna FK acá porque no hay ninguna FK hacia
-- un recurso ajeno en este flujo (loans no referencia nada más que
-- auth.uid()).
--
-- Criterio de redondeo (ver también el comentario extendido en
-- 20260721090100_loan_installments_init.sql, que es la fuente de verdad):
-- v_base_amount = floor((p_total_amount / p_term_months) * 100) / 100 (el
-- monto de cuota "parejo", truncado a 2 decimales hacia abajo, nunca
-- redondeado hacia arriba, para no arriesgar que la suma de las primeras
-- term_months-1 cuotas exceda a total_amount). Cada cuota 1..(term_months-1)
-- recibe exactamente v_base_amount. La ÚLTIMA cuota (installment_number =
-- term_months) recibe el resto exacto: total_amount menos la suma ya
-- asignada -- así la suma total SIEMPRE cuadra contra total_amount, sin
-- importar si divide exacto o no, y sin importar lo que declaró el usuario
-- en monthly_installment_amount (que no se usa para este cálculo, es solo
-- informativo).
--
-- due_date de la cuota N = start_date + (N - 1) meses (make_interval,
-- aritmética de calendario real de Postgres -- respeta meses de distinta
-- longitud y no acumula error de "30 días fijos").
--
-- Decisión de diseño explícita, respondida al Product Owner: NO existe una
-- RPC equivalente para "marcar cuota como pagada" ni para "registrar un pago
-- de una persona deudora" -- ver el razonamiento completo en el mensaje de
-- cierre de este encargo (resumen: ninguna de esas dos operaciones tiene un
-- efecto de lado en OTRA tabla que proteger con atomicidad server-side, a
-- diferencia de pay_fixed_expense_instance que sí genera un expenses real
-- dependiente). Ambas quedan como UPDATE/INSERT directos del cliente,
-- respaldados por RLS (loans_rls.sql) y los triggers de ownership ya
-- existentes.
-- =============================================================================

create function public.create_loan(
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
  v_base_amount numeric(12, 2);
  v_running_total numeric(12, 2) := 0;
  v_installment_amount numeric(12, 2);
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

  v_base_amount := floor((p_total_amount / p_term_months) * 100) / 100;

  for i in 1..p_term_months loop
    if i < p_term_months then
      v_installment_amount := v_base_amount;
    else
      -- Última cuota: absorbe el resto exacto para que la suma total cuadre
      -- contra total_amount sin importar el redondeo de las anteriores.
      v_installment_amount := p_total_amount - v_running_total;
    end if;

    insert into public.loan_installments (user_id, loan_id, installment_number, amount, due_date)
    values (
      v_user_id,
      v_loan_id,
      i,
      v_installment_amount,
      (p_start_date + make_interval(months => i - 1))::date
    );

    v_running_total := v_running_total + v_installment_amount;
  end loop;

  return v_loan_id;
end;
$$;

comment on function public.create_loan is 'Crea un préstamo (cabecera loans + su cronograma completo de loan_installments) de forma atómica. Genera TODAS las cuotas de una sola vez (no lazy, a diferencia de fixed_expenses). Ver criterio de redondeo en el comentario de esta migración: la última cuota absorbe el resto exacto, la suma de todas las cuotas siempre es igual a total_amount. SECURITY INVOKER: respeta el RLS de quien llama.';

grant execute on function public.create_loan(text, numeric, numeric, date, integer, text) to authenticated;
