-- =============================================================================
-- loan_installments_init
-- -----------------------------------------------------------------------------
-- Cronograma de cuotas de un préstamo (public.loans). A diferencia de
-- fixed_expense_instances (generadas de forma LAZY, una por mes a medida que
-- transcurre), acá TODAS las cuotas del préstamo se generan de una sola vez,
-- de forma atómica, al crear el préstamo -- ver create_loan en
-- 20260721090500_create_loan_function.sql. No hay generación diferida:
-- start_date/term_months ya determinan el cronograma completo por
-- adelantado, no hace falta esperar a que "llegue" el mes de cada cuota.
--
-- Criterio de redondeo (documentado acá porque es la fuente de verdad del
-- invariante "la suma de las cuotas siempre cuadra exacto contra
-- loans.total_amount"): si total_amount no divide exacto por term_months,
-- las cuotas 1..(term_months-1) llevan floor(total_amount / term_months)
-- redondeado a 2 decimales, y la ÚLTIMA cuota (installment_number =
-- term_months) absorbe el resto exacto (total_amount menos la suma de las
-- anteriores). Esto es INDEPENDIENTE de loans.monthly_installment_amount
-- (que es solo el valor de referencia que declaró el usuario, puede no
-- coincidir con total_amount/term_months si lo redondeó a mano) -- el
-- cronograma real siempre prioriza que la suma total sea exacta, nunca el
-- valor declarado. Ver create_loan para la implementación de este cálculo.
--
-- Columnas created_at/updated_at agregadas más allá de la lista mínima del
-- encargo (id/loan_id/user_id/installment_number/amount/due_date/status/
-- paid_at): es el mismo patrón de columnas de auditoría que TODAS las demás
-- tablas de este esquema (incluida fixed_expense_instances, su análogo más
-- cercano) -- omitirlas acá habría sido la excepción, no la regla.
-- =============================================================================

create table public.loan_installments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  loan_id uuid not null references public.loans (id) on delete cascade,
  installment_number integer not null check (installment_number > 0),
  amount numeric(12, 2) not null check (amount > 0),
  due_date date not null,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loan_installments_unique_number unique (loan_id, installment_number)
);

comment on table public.loan_installments is 'Cuota individual del cronograma de un préstamo, generada en bloque (todas juntas) por create_loan. loan_id ON DELETE CASCADE: borrar el préstamo completo se lleva su cronograma entero, es una operación intencional del usuario (mismo criterio que debt_movements respecto de debts).';
comment on column public.loan_installments.amount is 'Monto de esta cuota puntual. Ver criterio de redondeo al inicio de este archivo: la suma de todas las amount de un mismo loan_id siempre es exactamente igual a loans.total_amount, con la última cuota absorbiendo el resto de la división.';
comment on column public.loan_installments.status is 'pending -> todavía no pagada. paid -> el usuario la marcó como pagada manualmente (update directo desde el cliente, ver decisión en 20260721090500_create_loan_function.sql / respuesta al Product Owner: no hace falta una RPC de pago porque, a diferencia de pay_fixed_expense_instance, acá NO se genera ningún efecto de lado en otra tabla -- es un simple cambio de estado propio, ya protegido por RLS).';
comment on column public.loan_installments.paid_at is 'Timestamp de cuándo se marcó pagada. Sin invariante de BD que lo ate a status (a diferencia de fixed_expense_instances, que sí necesita ese invariante porque ahí "paid" implica un expense_id externo real) -- el frontend es responsable de setear/limpiar paid_at junto con status en el mismo update.';

create trigger loan_installments_set_updated_at
before update on public.loan_installments
for each row
execute function public.set_updated_at();

-- Refuerza a nivel de datos que loan_id pertenezca al mismo usuario dueño de
-- la cuota (mismo patrón que debt_movements_validate_owner). Acotado a
-- insert/update de (loan_id, user_id) -- igual que debt_movements -- para no
-- disparar en cada update de status/paid_at que hace el cliente al marcar
-- una cuota como pagada.
create function public.loan_installments_validate_owner()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.loans l
    where l.id = new.loan_id and l.user_id = new.user_id
  ) then
    raise exception 'loan_id % no pertenece al usuario %', new.loan_id, new.user_id;
  end if;

  return new;
end;
$$;

create trigger loan_installments_validate_owner_trigger
before insert or update of loan_id, user_id on public.loan_installments
for each row
execute function public.loan_installments_validate_owner();

create index loan_installments_user_id_idx on public.loan_installments (user_id);
create index loan_installments_loan_id_idx on public.loan_installments (loan_id);
create index loan_installments_status_idx on public.loan_installments (status);
create index loan_installments_due_date_idx on public.loan_installments (due_date);
