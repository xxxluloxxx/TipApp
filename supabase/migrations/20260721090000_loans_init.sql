-- =============================================================================
-- loans_init
-- -----------------------------------------------------------------------------
-- Feature nueva y AISLADA "Préstamos" (isla propia, deliberadamente separada
-- de "Deudas/Préstamos" = debts/debt_movements/debt_balances más arriba en
-- el historial de este esquema). Modela un préstamo formal que el usuario
-- tomó (ej. de un banco/financiera): un monto total a devolver en cuotas
-- mensuales fijas a lo largo de un plazo. Distinto de `debts` en forma y en
-- propósito: `debts` es un saldo corriente libre por contraparte+dirección
-- (subís/bajás sin cuotas ni plazo); `loans` es un cronograma de cuotas fijo
-- generado de una sola vez al crear el préstamo (ver loan_installments +
-- create_loan más abajo, en otras migraciones).
--
-- Aislamiento total del resto del dominio financiero, por decisión EXPLÍCITA
-- del Product Owner: ninguna operación de esta feature (crear el préstamo,
-- marcar una cuota como pagada, registrar un pago recibido de una persona)
-- genera jamás una fila en expenses/incomes, ni toca account_balances. A
-- diferencia de fixed_expenses (donde pagar SÍ genera un expense real) o de
-- debt_movements vinculado a cuenta (que SÍ ajusta account_balances), acá no
-- hay ningún efecto de caja modelado -- es un registro/tracking de cuotas y
-- de cobros a terceros, nada más. Por eso loan_installments/
-- loan_debtor_payments NO tienen ninguna FK hacia accounts.
--
-- estimated end date: NO se guarda como columna (evita que quede
-- desincronizada si alguna vez se edita start_date/term_months) -- se deriva
-- siempre como start_date + term_months meses, expuesto ya resuelto en la
-- vista loan_progress (otra migración) para que el frontend nunca tenga que
-- rehacer la aritmética de fechas.
-- =============================================================================

create table public.loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  description text,
  total_amount numeric(12, 2) not null check (total_amount > 0),
  monthly_installment_amount numeric(12, 2) not null check (monthly_installment_amount > 0),
  start_date date not null,
  term_months integer not null check (term_months > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.loans is 'Cabecera de un préstamo formal tomado por el usuario (ej. préstamo personal/bancario), con cronograma de cuotas fijo. Feature "Préstamos", aislada por completo de expenses/incomes/account_balances y de debts/debt_movements (deudas informales 1:1) -- ver comentario extendido al inicio de este archivo.';
comment on column public.loans.description is 'Nota libre opcional del préstamo (ej. "Descuento por nómina"). Texto libre sin estructura, no un campo nuevo de dominio.';
comment on column public.loans.total_amount is 'Monto total a devolver del préstamo. La suma exacta de todas sus loan_installments.amount siempre cuadra contra este valor (ver criterio de redondeo documentado en 20260721090100_loan_installments_init.sql), incluso si monthly_installment_amount no lo divide exacto.';
comment on column public.loans.monthly_installment_amount is 'Monto de cuota mensual declarado/de referencia por el usuario al cargar el préstamo. Puramente informativo: puede no coincidir exactamente con total_amount/term_months si el usuario lo redondeó a mano -- las loan_installments reales generadas por create_loan son las que garantizan que la suma cuadre contra total_amount, no esta columna.';
comment on column public.loans.start_date is 'Fecha de la primera cuota (installment_number = 1). La fecha de fin estimada se DERIVA como start_date + term_months meses -- no se guarda como columna, ver loan_progress.';
comment on column public.loans.term_months is 'Plazo del préstamo en meses = cantidad total de loan_installments generadas por create_loan.';

create trigger loans_set_updated_at
before update on public.loans
for each row
execute function public.set_updated_at();

create index loans_user_id_idx on public.loans (user_id);
